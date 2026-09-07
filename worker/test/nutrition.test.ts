import { describe, expect, it } from "vitest";
import { type LookupResult, NutritionService, parseOffResponse } from "../src/nutrition";

describe("nutrition", () => {
  it("parses Open Food Facts response", () => {
    const res = parseOffResponse(
      {
        products: [
          { product_name: "no data", nutriments: {} },
          {
            product_name: "Buckwheat", product_name_uk: "Гречка", serving_quantity: "150",
            nutriments: { "energy-kcal_100g": 343, proteins_100g: 13.3, fat_100g: 3.4, carbohydrates_100g: 71.5 },
          },
        ],
      },
      "гречка",
    );
    expect(res).toMatchObject({ name: "Гречка", portionG: 150, source: "openfoodfacts", per100g: { kcal: 343, protein: 13.3, fat: 3.4, carbs: 71.5 } });
    const kj = parseOffResponse({ products: [{ nutriments: { energy_100g: 418.4, proteins_100g: null } }] }, "щось");
    expect(kj).toMatchObject({ name: "щось", portionG: 100, per100g: { kcal: 100, protein: 0 } });
    expect(parseOffResponse({}, "x")).toBeNull();
  });

  it("falls back across providers", async () => {
    const found: LookupResult = { name: "x", per100g: { kcal: 1, protein: 2, fat: 3, carbs: 4 }, portionG: 100, source: "test", note: "" };
    const service = new NutritionService([
      { lookup: async () => { throw new Error("boom"); } },
      { lookup: async () => null },
      { lookup: async () => found },
    ]);
    expect(await service.lookup("банан")).toBe(found);
    expect(await new NutritionService([{ lookup: async () => null }]).lookup("x")).toBeNull();
    expect(NutritionService.fromEnv(undefined, "claude-opus-5").providerCount).toBe(1);
    expect(NutritionService.fromEnv("key", "claude-opus-5").providerCount).toBe(2);
  });
});
