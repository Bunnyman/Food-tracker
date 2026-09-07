import { Bot, type Context, GrammyError, InlineKeyboard, type Transformer } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import type { Database } from "./db";
import type { LookupResult, NutritionService } from "./nutrition";
import type { DialogState, PendingProduct } from "./types";
import {
  BTN_ADD, BTN_GOAL, BTN_HELP, BTN_PRODUCTS, BTN_TODAY, BTN_UNDO,
  confirmDeleteKeyboard, confirmLookupKeyboard, mainMenu, manualOnlyKeyboard,
  portionKeyboard, productKeyboard, productsKeyboard, todayKeyboard,
} from "./keyboards";
import {
  ASK_MANUAL, ASK_NAME, GOAL_PROMPT, HELP, SOURCE_LABEL, WELCOME,
  dayKey, dayLabel, daySummary, escapeHtml, fmtNum, goalText, macrosLine,
  parseGrams, parseMacros, parseNumbers, productCard,
} from "./texts";

export interface Services {
  db: Database;
  nutrition: NutritionService;
  timeZone: string;
}

export const COMMANDS = [
  { command: "today", description: "Ліміт на сьогодні та список продуктів" },
  { command: "add", description: "Додати страву/продукт" },
  { command: "goal", description: "Задати ціль по ккал та БЖВ" },
  { command: "products", description: "Мої продукти" },
  { command: "eat", description: "Записати: /eat назва грами" },
  { command: "undo", description: "Відмінити останній запис" },
  { command: "help", description: "Допомога" },
  { command: "cancel", description: "Скасувати поточну дію" },
];

/** Додає parse_mode=HTML до всіх текстових повідомлень. */
const htmlParseMode: Transformer = (prev, method, payload, signal) => {
  if (method === "sendMessage" || method === "editMessageText") {
    return prev(method, { parse_mode: "HTML", ...payload } as typeof payload, signal);
  }
  return prev(method, payload, signal);
};

export interface BotOptions {
  botInfo?: UserFromGetMe;
  /** Підміна fetch для тестів. */
  fetch?: typeof fetch;
}

export function createBot(token: string, services: Services, options: BotOptions = {}): Bot {
  const { db, nutrition, timeZone } = services;
  const bot = new Bot(token, { botInfo: options.botInfo, client: options.fetch ? { fetch: options.fetch } : undefined });
  bot.api.config.use(htmlParseMode);

  const uid = (ctx: Context) => ctx.from!.id;
  const now = () => new Date();

  // ---------- сьогодні ----------

  async function renderToday(userId: number) {
    const day = dayKey(now(), timeZone);
    const [goal, totals, entries, products] = await Promise.all([
      db.getGoal(userId), db.dayTotals(userId, day), db.listEntries(userId, day), db.listProducts(userId),
    ]);
    return { text: daySummary(dayLabel(now(), timeZone), goal, totals, entries), keyboard: todayKeyboard(products) };
  }

  async function sendToday(ctx: Context) {
    const { text, keyboard } = await renderToday(uid(ctx));
    await ctx.reply(text, { reply_markup: keyboard });
  }

  async function editToday(ctx: Context) {
    const { text, keyboard } = await renderToday(uid(ctx));
    try {
      await ctx.editMessageText(text, { reply_markup: keyboard });
    } catch (err) {
      if (!(err instanceof GrammyError && err.description.includes("message is not modified"))) throw err;
    }
  }

  async function undo(userId: number): Promise<string> {
    const entry = await db.deleteLastEntry(userId, dayKey(now(), timeZone));
    if (!entry) return "Сьогодні ще немає записів.";
    return `Видалено: ${entry.productName} ${fmtNum(entry.grams)} г (${fmtNum(entry.macros.kcal)} ккал)`;
  }

  // ---------- ціль ----------

  async function askGoal(ctx: Context) {
    const current = await db.getGoal(uid(ctx));
    await db.setState(uid(ctx), { name: "goal" });
    await ctx.reply((current ? goalText(current) + "\n\n" : "") + GOAL_PROMPT);
  }

  async function saveGoal(ctx: Context, text: string): Promise<boolean> {
    const goal = parseMacros(text);
    if (!goal || goal.kcal <= 0 || goal.protein < 0 || goal.fat < 0 || goal.carbs < 0) {
      await ctx.reply("Не зрозумів. Потрібно 1 або 4 числа, наприклад <code>2000 150 60 200</code>.");
      return false;
    }
    await db.setGoal(uid(ctx), goal);
    await db.clearState(uid(ctx));
    await ctx.reply("Збережено!\n" + goalText(goal), { reply_markup: mainMenu() });
    return true;
  }

  // ---------- додавання продукту ----------

  async function startAdd(ctx: Context) {
    await db.setState(uid(ctx), { name: "add_name" });
    await ctx.reply(ASK_NAME);
  }

  async function lookupAndAsk(ctx: Context, rawQuery: string) {
    const query = rawQuery.trim();
    if (query.length < 2 || query.length > 100) {
      await db.setState(uid(ctx), { name: "add_name" });
      await ctx.reply("Назва має бути від 2 до 100 символів. Спробуйте ще раз.");
      return;
    }
    // 1) Продукт з такою назвою вже є — API не потрібен.
    const existing = await db.findProduct(uid(ctx), query);
    if (existing && existing.name.toLowerCase() === query.toLowerCase()) {
      await db.clearState(uid(ctx));
      await ctx.reply("Цей продукт уже є у вашому списку:\n" + productCard(existing), {
        reply_markup: productKeyboard(existing),
      });
      return;
    }
    const waiting = await ctx.reply(`🔎 Шукаю «${escapeHtml(query)}»…`);
    // 2) Кеш: однаковий запит (від будь-кого) не викликає API повторно.
    let result = await db.getCachedLookup<LookupResult>(query);
    if (!result) {
      result = await nutrition.lookup(query);
      if (result) await db.setCachedLookup(query, result);
    }
    const edit = (text: string, reply_markup: InlineKeyboard) =>
      ctx.api.editMessageText(waiting.chat.id, waiting.message_id, text, { reply_markup });
    if (!result) {
      const product: PendingProduct = { name: query, per100g: null, portionG: 100, source: "manual" };
      await db.setState(uid(ctx), { name: "add_confirm", product });
      await edit(`Не вдалося автоматично знайти «${escapeHtml(query)}». Можете ввести значення вручну.`, manualOnlyKeyboard());
      return;
    }
    const product: PendingProduct = { name: result.name, per100g: result.per100g, portionG: result.portionG, source: result.source };
    await db.setState(uid(ctx), { name: "add_confirm", product });
    const note = result.note ? `\n<i>${escapeHtml(result.note)}</i>` : "";
    await edit(
      `<b>${escapeHtml(result.name)}</b>${note}\nНа 100 г: ${macrosLine(result.per100g)}\n` +
        `Джерело: ${SOURCE_LABEL[result.source] ?? result.source}\n\nЗберегти?`,
      confirmLookupKeyboard(),
    );
  }

  async function askPortion(ctx: Context, product: PendingProduct) {
    await db.setState(uid(ctx), { name: "add_portion", product });
    await ctx.reply(
      `Яку порцію записувати одним натисканням у «Сьогодні»?\nОберіть або введіть грами (типова порція: ${fmtNum(product.portionG)} г).`,
      { reply_markup: portionKeyboard(product.portionG) },
    );
  }

  async function finishAdd(ctx: Context, pending: PendingProduct, grams: number) {
    await db.clearState(uid(ctx));
    if (!pending.per100g) throw new Error("pending product without macros");
    const product = await db.addProduct(uid(ctx), pending.name, pending.per100g, grams, pending.source);
    await ctx.reply("✅ Додано до списку:\n" + productCard(product) + "\n\nВідкрийте 📅 Сьогодні, щоб записати.", {
      reply_markup: mainMenu(),
    });
  }

  // ---------- список продуктів ----------

  async function productsList(ctx: Context, edit: boolean) {
    const products = await db.listProducts(uid(ctx));
    const text = products.length
      ? `📋 <b>Мої продукти</b> (${products.length})\nНатисніть, щоб переглянути або змінити.`
      : "Список порожній. Додайте перший продукт.";
    const opts = { reply_markup: productsKeyboard(products) };
    if (edit) await ctx.editMessageText(text, opts);
    else await ctx.reply(text, opts);
  }

  const stale = (ctx: Context) =>
    ctx.answerCallbackQuery({ text: "Ця дія вже неактуальна. Почніть заново: ➕ Додати продукт", show_alert: true });

  // ---------- команди та кнопки меню (скидають стан діалогу) ----------

  bot.command("start", async (ctx) => {
    await db.clearState(uid(ctx));
    await db.ensureUser(uid(ctx));
    await ctx.reply(WELCOME, { reply_markup: mainMenu() });
  });

  const help = async (ctx: Context) => {
    await ctx.reply(HELP, { reply_markup: mainMenu() });
  };
  bot.command("help", help);
  bot.hears(BTN_HELP, help);

  bot.command("cancel", async (ctx) => {
    const had = await db.getState(uid(ctx));
    await db.clearState(uid(ctx));
    await ctx.reply(had ? "Скасовано." : "Немає активної дії.", { reply_markup: mainMenu() });
  });

  bot.command("goal", async (ctx) => {
    await db.clearState(uid(ctx));
    if (ctx.match.trim()) await saveGoal(ctx, ctx.match);
    else await askGoal(ctx);
  });
  bot.hears(BTN_GOAL, async (ctx) => {
    await db.clearState(uid(ctx));
    await askGoal(ctx);
  });

  const today = async (ctx: Context) => {
    await db.clearState(uid(ctx));
    await db.ensureUser(uid(ctx));
    await sendToday(ctx);
  };
  bot.command("today", today);
  bot.hears(BTN_TODAY, today);

  const undoCmd = async (ctx: Context) => {
    await db.clearState(uid(ctx));
    await ctx.reply(await undo(uid(ctx)));
    await sendToday(ctx);
  };
  bot.command("undo", undoCmd);
  bot.hears(BTN_UNDO, undoCmd);

  bot.command("add", async (ctx) => {
    await db.clearState(uid(ctx));
    if (ctx.match.trim()) await lookupAndAsk(ctx, ctx.match);
    else await startAdd(ctx);
  });
  bot.hears(BTN_ADD, async (ctx) => {
    await db.clearState(uid(ctx));
    await startAdd(ctx);
  });

  const products = async (ctx: Context) => {
    await db.clearState(uid(ctx));
    await productsList(ctx, false);
  };
  bot.command("products", products);
  bot.hears(BTN_PRODUCTS, products);

  bot.command("eat", async (ctx) => {
    await db.clearState(uid(ctx));
    const args = ctx.match.trim();
    if (!args) {
      await ctx.reply("Формат: <code>/eat назва грами</code>, наприклад <code>/eat гречка 150</code>.", { reply_markup: mainMenu() });
      return;
    }
    let name = args;
    let grams: number | null = null;
    const m = args.match(/^(.*\S)\s+(\d+(?:[.,]\d+)?)$/);
    if (m) {
      name = m[1];
      grams = parseNumbers(m[2])[0];
    }
    const product = await db.findProduct(uid(ctx), name);
    if (!product) {
      await ctx.reply(`Продукт «${escapeHtml(name)}» не знайдено у вашому списку. Додайте його: /add ${escapeHtml(name)}`);
      return;
    }
    const entry = await db.addEntry(uid(ctx), product, grams && grams > 0 ? grams : product.portionG, dayKey(now(), timeZone), now());
    await ctx.reply(`Записано: <b>${escapeHtml(product.name)}</b> ${fmtNum(entry.grams)} г — ${macrosLine(entry.macros)}`);
    await sendToday(ctx);
  });

  // ---------- inline-кнопки ----------

  bot.callbackQuery("today:refresh", async (ctx) => {
    await editToday(ctx);
    await ctx.answerCallbackQuery({ text: "Оновлено" });
  });

  bot.callbackQuery("today:undo", async (ctx) => {
    const text = await undo(uid(ctx));
    await editToday(ctx);
    await ctx.answerCallbackQuery({ text });
  });

  bot.callbackQuery(/^eat:(\d+)$/, async (ctx) => {
    const product = await db.getProduct(uid(ctx), Number(ctx.match[1]));
    if (!product) {
      await ctx.answerCallbackQuery({ text: "Продукт не знайдено", show_alert: true });
      await editToday(ctx);
      return;
    }
    const entry = await db.addEntry(uid(ctx), product, product.portionG, dayKey(now(), timeZone), now());
    await editToday(ctx);
    await ctx.answerCallbackQuery({ text: `+ ${product.name} ${fmtNum(entry.grams)} г (${fmtNum(entry.macros.kcal)} ккал)` });
  });

  bot.callbackQuery("add:start", async (ctx) => {
    await ctx.answerCallbackQuery();
    await db.clearState(uid(ctx));
    await startAdd(ctx);
  });

  bot.callbackQuery("add:cancel", async (ctx) => {
    const state = await db.getState(uid(ctx));
    if (state?.name !== "add_confirm") return stale(ctx);
    await db.clearState(uid(ctx));
    await ctx.editMessageText("Скасовано.");
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("add:manual", async (ctx) => {
    const state = await db.getState(uid(ctx));
    if (state?.name !== "add_confirm") return stale(ctx);
    await db.setState(uid(ctx), { name: "add_manual", product: state.product });
    await ctx.editMessageText(ASK_MANUAL);
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("add:save", async (ctx) => {
    const state = await db.getState(uid(ctx));
    if (state?.name !== "add_confirm" || !state.product.per100g) return stale(ctx);
    await ctx.answerCallbackQuery();
    await askPortion(ctx, state.product);
  });

  bot.callbackQuery(/^portion:(.+)$/, async (ctx) => {
    const state = await db.getState(uid(ctx));
    const grams = parseFloat(ctx.match[1]);
    if (state?.name !== "add_portion" || !(grams > 0)) return stale(ctx);
    await ctx.answerCallbackQuery();
    await finishAdd(ctx, state.product, grams);
  });

  bot.callbackQuery("prod:list", async (ctx) => {
    await db.clearState(uid(ctx));
    await productsList(ctx, true);
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^prod:(\d+)$/, async (ctx) => {
    const product = await db.getProduct(uid(ctx), Number(ctx.match[1]));
    if (!product) return ctx.answerCallbackQuery({ text: "Продукт не знайдено", show_alert: true });
    await ctx.editMessageText(productCard(product) + `\nДжерело: ${SOURCE_LABEL[product.source] ?? product.source}`, {
      reply_markup: productKeyboard(product),
    });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^prod_del:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const product = await db.getProduct(uid(ctx), id);
    if (!product) return ctx.answerCallbackQuery({ text: "Продукт не знайдено", show_alert: true });
    await ctx.editMessageText(`Видалити «${escapeHtml(product.name)}» зі списку? Записи в щоденнику збережуться.`, {
      reply_markup: confirmDeleteKeyboard(id),
    });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^prod_del_yes:(\d+)$/, async (ctx) => {
    const deleted = await db.deleteProduct(uid(ctx), Number(ctx.match[1]));
    await ctx.answerCallbackQuery({ text: deleted ? "Видалено" : "Продукт не знайдено" });
    await productsList(ctx, true);
  });

  bot.callbackQuery(/^prod_portion:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const product = await db.getProduct(uid(ctx), id);
    if (!product) return ctx.answerCallbackQuery({ text: "Продукт не знайдено", show_alert: true });
    await db.setState(uid(ctx), { name: "edit_portion", productId: id });
    await ctx.reply(`Нова порція для «${escapeHtml(product.name)}» у грамах (зараз ${fmtNum(product.portionG)} г):`);
    await ctx.answerCallbackQuery();
  });

  // ---------- довільний текст: залежить від стану діалогу ----------

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    const state: DialogState | null = await db.getState(uid(ctx));
    switch (state?.name) {
      case "goal":
        await saveGoal(ctx, text);
        return;
      case "add_name":
        await lookupAndAsk(ctx, text);
        return;
      case "add_manual": {
        const nums = parseNumbers(text);
        if (nums.length !== 4 || nums.some((n) => n < 0)) {
          await ctx.reply("Потрібно рівно 4 числа: <code>ккал білки жири вуглеводи</code>.");
          return;
        }
        const product: PendingProduct = {
          ...state.product,
          per100g: { kcal: nums[0], protein: nums[1], fat: nums[2], carbs: nums[3] },
          source: "manual",
        };
        await askPortion(ctx, product);
        return;
      }
      case "add_portion": {
        const grams = parseGrams(text);
        if (grams === null) {
          await ctx.reply("Введіть одне число — порцію в грамах, наприклад <code>150</code>.");
          return;
        }
        await finishAdd(ctx, state.product, grams);
        return;
      }
      case "edit_portion": {
        const grams = parseGrams(text);
        if (grams === null) {
          await ctx.reply("Введіть одне число — порцію в грамах.");
          return;
        }
        await db.clearState(uid(ctx));
        const ok = await db.setPortion(uid(ctx), state.productId, grams);
        const product = ok ? await db.getProduct(uid(ctx), state.productId) : null;
        if (!product) {
          await ctx.reply("Продукт не знайдено.", { reply_markup: mainMenu() });
          return;
        }
        await ctx.reply("Оновлено:\n" + productCard(product), { reply_markup: mainMenu() });
        return;
      }
      default:
        // Без стану: будь-який текст = назва продукту для додавання.
        await lookupAndAsk(ctx, text);
    }
  });

  bot.catch((err) => {
    console.error("Помилка обробки оновлення", err.error);
  });

  return bot;
}
