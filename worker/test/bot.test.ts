import { env } from "cloudflare:test";
import type { Update } from "grammy/types";
import { beforeEach, describe, expect, it } from "vitest";
import { createBot } from "../src/bot";
import { Database } from "../src/db";
import { type LookupResult, NutritionService } from "../src/nutrition";
import { resetTables } from "./helpers";

const USER = { id: 42, is_bot: false, first_name: "Тест" };
const CHAT = { id: 42, type: "private" as const, first_name: "Тест" };
const BOT_INFO = {
  id: 1, is_bot: true as const, first_name: "FoodBot", username: "food_test_bot",
  can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false,
  can_connect_to_business: false, has_main_web_app: false, has_topics_enabled: false,
  allows_users_to_create_topics: false, can_manage_bots: false, supports_join_request_queries: false,
};

const providerCalls: string[] = [];
const fakeProvider = {
  async lookup(query: string): Promise<LookupResult | null> {
    providerCalls.push(query);
    if (query.toLowerCase().startsWith("гречка")) {
      return { name: "Гречка варена", per100g: { kcal: 110, protein: 4.2, fat: 1.1, carbs: 21 }, portionG: 150, source: "claude", note: "" };
    }
    return null;
  },
};

interface Call { method: string; payload: Record<string, unknown> }

function setup() {
  const db = new Database(env.DB);
  const calls: Call[] = [];
  let msgId = 100;
  // Фейковий Telegram Bot API на рівні fetch: усі трансформери grammY відпрацьовують як у продакшені.
  const fakeFetch: typeof fetch = async (input, init) => {
    const method = String(input).split("/").pop()!;
    const p = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ method, payload: p });
    let result: unknown = true;
    if (method === "sendMessage") result = { message_id: ++msgId, date: 0, chat: CHAT, text: p.text, reply_markup: p.reply_markup };
    if (method === "editMessageText") result = { message_id: p.message_id ?? 500, date: 0, chat: CHAT, text: p.text, reply_markup: p.reply_markup };
    return new Response(JSON.stringify({ ok: true, result }), { headers: { "content-type": "application/json" } });
  };
  const bot = createBot("1:TEST", { db, nutrition: new NutritionService([fakeProvider]), timeZone: "Europe/Kyiv" }, { botInfo: BOT_INFO, fetch: fakeFetch });
  let updateId = 0;
  const send = (text: string) => {
    const entities = text.startsWith("/") ? [{ type: "bot_command" as const, offset: 0, length: text.split(" ")[0].length }] : undefined;
    return bot.handleUpdate({ update_id: ++updateId, message: { message_id: updateId, date: 0, chat: CHAT, from: USER, text, entities } } as Update);
  };
  const click = (data: string) =>
    bot.handleUpdate({
      update_id: ++updateId,
      callback_query: { id: String(updateId), from: USER, chat_instance: "x", data, message: { message_id: 500, date: 0, chat: CHAT, text: "…" } },
    } as Update);
  const lastText = () => {
    const c = [...calls].reverse().find((x) => x.method === "sendMessage" || x.method === "editMessageText");
    if (!c) throw new Error("no messages sent");
    return String(c.payload.text);
  };
  const lastCallbackDatas = () => {
    const c = [...calls].reverse().find((x) => (x.method === "sendMessage" || x.method === "editMessageText") && x.payload.reply_markup);
    const markup = c?.payload.reply_markup as { inline_keyboard: { callback_data: string }[][] };
    return markup.inline_keyboard.flat().map((b) => b.callback_data);
  };
  return { db, calls, send, click, lastText, lastCallbackDatas };
}

describe("bot flows", () => {
  beforeEach(async () => {
    await new Database(env.DB).ensureSchema();
    await resetTables(env.DB);
    providerCalls.length = 0;
  });

  it("full flow: goal, add via lookup, manual add, today, tap-to-log, undo, /eat", async () => {
    const { db, send, click, lastText, lastCallbackDatas } = setup();

    await send("/start");
    expect(lastText()).toContain("Привіт");

    await send("/goal 2000 150 60 200");
    expect(lastText()).toContain("Збережено");
    expect(await db.getGoal(USER.id)).toEqual({ kcal: 2000, protein: 150, fat: 60, carbs: 200 });

    await send("/add гречка");
    expect(lastText()).toContain("Гречка варена");
    await click("add:save");
    expect(lastText()).toContain("порцію");
    await click("portion:150");
    expect(lastText()).toContain("Додано до списку");
    const products = await db.listProducts(USER.id);
    expect(products).toHaveLength(1);
    expect(products[0].portionG).toBe(150);

    await send("➕ Додати продукт");
    await send("щось невідоме");
    expect(lastText()).toContain("Не вдалося");
    await click("add:manual");
    await send("100 10 5 2");
    await send("200");
    expect(lastText()).toContain("Додано до списку");
    expect(await db.listProducts(USER.id)).toHaveLength(2);

    await send("📅 Сьогодні");
    expect(lastText()).toContain("залишилось <b>2000</b> ккал");
    expect(lastCallbackDatas().filter((d) => d.startsWith("eat:"))).toHaveLength(2);

    await click(`eat:${products[0].id}`);
    expect(lastText()).toContain("залишилось <b>1835</b> ккал"); // 2000 - 110 * 1.5
    expect(lastText()).toContain("Гречка варена — 150 г");

    await click("today:undo");
    expect(lastText()).toContain("залишилось <b>2000</b> ккал");

    await send("/eat гречка 100");
    expect(lastText()).toContain("залишилось <b>1890</b> ккал");
  });

  it("menu button interrupts a dialog; kcal-only goal", async () => {
    const { db, send, lastText } = setup();
    await send("/goal");
    expect(lastText()).toContain("Введіть ціль");
    await send("📅 Сьогодні");
    expect(lastText()).toContain("Ціль не задана");
    await send("/goal");
    await send("1800");
    expect((await db.getGoal(USER.id))?.kcal).toBe(1800);
  });

  it("stale callback after state loss", async () => {
    const { calls, click } = setup();
    await click("add:save");
    const last = calls[calls.length - 1];
    expect(last.method).toBe("answerCallbackQuery");
    expect(String(last.payload.text)).toContain("неактуальна");
  });

  it("product delete flow", async () => {
    const { db, send, click, lastText, lastCallbackDatas } = setup();
    const p = await db.addProduct(USER.id, "Банан", { kcal: 89, protein: 1, fat: 0, carbs: 23 });
    await send("/products");
    expect(lastCallbackDatas()).toContain(`prod:${p.id}`);
    await click(`prod:${p.id}`);
    expect(lastText()).toContain("Банан");
    await click(`prod_del:${p.id}`);
    expect(lastText()).toContain("Видалити");
    await click(`prod_del_yes:${p.id}`);
    expect(await db.listProducts(USER.id)).toEqual([]);
    expect(lastText()).toContain("порожній");
  });

  it("nutrition API is called once per query: cache and existing-product shortcut", async () => {
    const { send, click, lastText } = setup();
    await send("/add гречка");
    expect(providerCalls).toEqual(["гречка"]);
    await click("add:cancel");

    // Той самий запит (інший регістр/пробіли) — з кешу, без виклику API.
    await send("/add  Гречка ");
    expect(lastText()).toContain("Гречка варена");
    expect(providerCalls).toEqual(["гречка"]);
    await click("add:save");
    await click("portion:150");
    expect(lastText()).toContain("Додано до списку");

    // Продукт уже в списку — одразу картка, без пошуку.
    await send("гречка варена");
    expect(lastText()).toContain("уже є у вашому списку");
    expect(providerCalls).toEqual(["гречка"]);

    // Запис у щоденник і "Сьогодні" API не використовують.
    await send("📅 Сьогодні");
    await click("today:refresh");
    await send("/eat гречка 100");
    expect(providerCalls).toEqual(["гречка"]);
  });

  it("free text starts a lookup and messages use HTML parse mode", async () => {
    const { calls, send, lastText } = setup();
    await send("гречка");
    expect(lastText()).toContain("Зберегти?");
    expect(calls.find((c) => c.method === "sendMessage")?.payload.parse_mode).toBe("HTML");
  });
});
