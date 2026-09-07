/**
 * Автоматичне визначення калорій та БЖВ.
 * Порядок: Claude (якщо є ANTHROPIC_API_KEY) → Open Food Facts → null (ручне введення).
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Macros } from "./types";

export interface LookupResult {
  name: string;
  per100g: Macros;
  portionG: number;
  source: string;
  note: string;
}

export interface NutritionProvider {
  lookup(query: string): Promise<LookupResult | null>;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

const NutritionEstimate = z.object({
  found: z.boolean().describe("false, якщо це не їжа або оцінити неможливо"),
  name: z.string().describe("Нормалізована назва українською"),
  kcal_per_100g: z.number(),
  protein_per_100g: z.number(),
  fat_per_100g: z.number(),
  carbs_per_100g: z.number(),
  typical_portion_g: z.number().describe("Типова порція в грамах"),
  note: z.string().describe("Коротке уточнення (яка саме страва малась на увазі), може бути порожнім"),
});

const SYSTEM_PROMPT =
  "Ти — дієтолог і довідник поживної цінності. Користувач надсилає назву страви або продукту " +
  "(зазвичай українською, може бути російською чи англійською). Поверни середні довідникові значення " +
  "калорійності та БЖВ на 100 г їстівної частини у готовому до вживання вигляді (якщо не вказано інше: " +
  "крупи та макарони — варені, м'ясо — приготоване). Для напоїв — на 100 мл. Якщо назва містить вагу або " +
  "об'єм (наприклад «кола 0.5»), все одно рахуй на 100 г/мл, а typical_portion_g став рівним зазначеній " +
  "кількості. Якщо це не їжа або назва беззмістовна — found=false і нулі. Назву у name подавай " +
  "українською, коротко, без зайвих слів.";

export class ClaudeProvider implements NutritionProvider {
  private readonly client: Anthropic;
  constructor(apiKey: string, private readonly model: string) {
    this.client = new Anthropic({ apiKey, timeout: 45_000, maxRetries: 1 });
  }

  async lookup(query: string): Promise<LookupResult | null> {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      output_config: { effort: "low", format: zodOutputFormat(NutritionEstimate) },
      messages: [{ role: "user", content: query }],
    });
    if (response.stop_reason === "refusal") {
      console.warn("Claude відмовив у запиті", query);
      return null;
    }
    const est = response.parsed_output;
    if (!est || !est.found) return null;
    return {
      name: est.name.trim() || query.trim(),
      per100g: {
        kcal: round1(Math.max(0, est.kcal_per_100g)),
        protein: round1(Math.max(0, est.protein_per_100g)),
        fat: round1(Math.max(0, est.fat_per_100g)),
        carbs: round1(Math.max(0, est.carbs_per_100g)),
      },
      portionG: est.typical_portion_g > 0 ? est.typical_portion_g : 100,
      source: "claude",
      note: est.note.trim(),
    };
  }
}

interface OffProduct {
  product_name?: string;
  product_name_uk?: string;
  serving_quantity?: string | number;
  nutriments?: Record<string, unknown>;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Вибирає перший продукт Open Food Facts, у якого є калорійність на 100 г. */
export function parseOffResponse(data: { products?: OffProduct[] }, query: string): LookupResult | null {
  for (const prod of data.products ?? []) {
    const n = prod.nutriments ?? {};
    let kcal = num(n["energy-kcal_100g"]);
    if (kcal === null) {
      const kj = num(n["energy_100g"]);
      if (kj === null) continue;
      kcal = kj / 4.184;
    }
    const name = (prod.product_name_uk || prod.product_name || query).trim();
    const portion = num(prod.serving_quantity);
    return {
      name,
      per100g: {
        kcal: round1(kcal),
        protein: round1(num(n["proteins_100g"]) ?? 0),
        fat: round1(num(n["fat_100g"]) ?? 0),
        carbs: round1(num(n["carbohydrates_100g"]) ?? 0),
      },
      portionG: portion && portion > 0 ? portion : 100,
      source: "openfoodfacts",
      note: "",
    };
  }
  return null;
}

export class OpenFoodFactsProvider implements NutritionProvider {
  async lookup(query: string): Promise<LookupResult | null> {
    const url =
      "https://world.openfoodfacts.org/cgi/search.pl?search_simple=1&action=process&json=1&page_size=10" +
      "&fields=product_name,product_name_uk,nutriments,serving_quantity&search_terms=" +
      encodeURIComponent(query);
    const resp = await fetch(url, {
      headers: { "User-Agent": "FoodTrackerTelegramBot/1.0 (github.com/bunnyman/food-tracker)" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      console.warn("Open Food Facts відповів", resp.status);
      return null;
    }
    return parseOffResponse((await resp.json()) as { products?: OffProduct[] }, query);
  }
}

export class NutritionService {
  constructor(private readonly providers: NutritionProvider[]) {}

  static fromEnv(apiKey: string | undefined, model: string): NutritionService {
    const providers: NutritionProvider[] = [];
    if (apiKey) providers.push(new ClaudeProvider(apiKey, model));
    else console.warn("ANTHROPIC_API_KEY не задано — використовується лише Open Food Facts");
    providers.push(new OpenFoodFactsProvider());
    return new NutritionService(providers);
  }

  get providerCount(): number {
    return this.providers.length;
  }

  async lookup(query: string): Promise<LookupResult | null> {
    for (const provider of this.providers) {
      try {
        const result = await provider.lookup(query);
        if (result) return result;
      } catch (err) {
        console.error("Помилка провайдера", provider.constructor.name, err);
      }
    }
    return null;
  }
}
