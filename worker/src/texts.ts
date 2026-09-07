/** Форматування повідомлень і розбір введеного користувачем тексту. */
import { type Entry, type Macros, type Product, forGrams } from "./types";

const NUMBER_RE = /[-+]?\d+(?:[.,]\d+)?/g;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 1234.0 → '1234', 12.34 → '12.3'. */
export function fmtNum(value: number): string {
  if (Math.abs(value - Math.round(value)) < 0.05) return String(Math.round(value));
  return value.toFixed(1);
}

export function parseNumbers(text: string): number[] {
  return (text.match(NUMBER_RE) ?? []).map((m) => parseFloat(m.replace(",", ".")));
}

/** '2000 150 60 200' або '2000' → Macros. null, якщо чисел не 1 і не 4. */
export function parseMacros(text: string): Macros | null {
  const nums = parseNumbers(text);
  if (nums.length === 1) return { kcal: nums[0], protein: 0, fat: 0, carbs: 0 };
  if (nums.length === 4) return { kcal: nums[0], protein: nums[1], fat: nums[2], carbs: nums[3] };
  return null;
}

export function parseGrams(text: string): number | null {
  const nums = parseNumbers(text);
  return nums.length === 1 && nums[0] > 0 ? nums[0] : null;
}

export function macrosLine(m: Macros): string {
  return `${fmtNum(m.kcal)} ккал · Б ${fmtNum(m.protein)} · Ж ${fmtNum(m.fat)} · В ${fmtNum(m.carbs)}`;
}

export function productCard(p: Product): string {
  return (
    `<b>${escapeHtml(p.name)}</b>\n` +
    `На 100 г: ${macrosLine(p.per100g)}\n` +
    `Порція: ${fmtNum(p.portionG)} г → ${macrosLine(forGrams(p, p.portionG))}`
  );
}

function bar(consumed: number, goal: number, width = 10): string {
  if (goal <= 0) return "";
  const filled = Math.round(Math.min(consumed / goal, 1) * width);
  return "▓".repeat(filled) + "░".repeat(width - filled);
}

function limitRow(label: string, consumed: number, goal: number, unit: string): string {
  const remaining = goal - consumed;
  const tail =
    remaining >= 0
      ? `залишилось <b>${fmtNum(remaining)}</b> ${unit}`
      : `перевищено на <b>${fmtNum(-remaining)}</b> ${unit}`;
  return `${label}: ${fmtNum(consumed)} / ${fmtNum(goal)} ${unit} — ${tail}\n${bar(consumed, goal)}`;
}

export function daySummary(dayLabel: string, goal: Macros | null, totals: Macros, entries: Entry[]): string {
  const lines = [`📅 <b>${escapeHtml(dayLabel)}</b>`, ""];
  if (!goal) {
    lines.push(`З'їдено: ${macrosLine(totals)}`);
    lines.push("Ціль не задана — натисніть 🎯 Ціль або /goal.");
  } else {
    lines.push(limitRow("🔥 Калорії", totals.kcal, goal.kcal, "ккал"));
    if (goal.protein > 0) lines.push(limitRow("🥩 Білки", totals.protein, goal.protein, "г"));
    if (goal.fat > 0) lines.push(limitRow("🥑 Жири", totals.fat, goal.fat, "г"));
    if (goal.carbs > 0) lines.push(limitRow("🍞 Вуглеводи", totals.carbs, goal.carbs, "г"));
  }
  lines.push("");
  if (entries.length) {
    lines.push("<b>З'їдено сьогодні:</b>");
    entries.forEach((e, i) => {
      lines.push(`${i + 1}. ${escapeHtml(e.productName)} — ${fmtNum(e.grams)} г (${fmtNum(e.macros.kcal)} ккал)`);
    });
  } else {
    lines.push("Сьогодні ще нічого не записано.");
  }
  lines.push("", "Оберіть продукт нижче, щоб додати його в щоденник 👇");
  return lines.join("\n");
}

export function goalText(goal: Macros): string {
  return (
    `🎯 Ціль на день: <b>${fmtNum(goal.kcal)} ккал</b>\n` +
    `Білки ${fmtNum(goal.protein)} г · Жири ${fmtNum(goal.fat)} г · Вуглеводи ${fmtNum(goal.carbs)} г`
  );
}

const MONTHS = ["січня", "лютого", "березня", "квітня", "травня", "червня", "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"];

/** 'YYYY-MM-DD' у заданому часовому поясі. */
export function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function dayLabel(date: Date, timeZone: string): string {
  const [, month, day] = dayKey(date, timeZone).split("-").map(Number);
  return `Сьогодні, ${day} ${MONTHS[month - 1]}`;
}

export const WELCOME =
  "Привіт! Я допоможу рахувати калорії та БЖВ.\n\n" +
  "1️⃣ Додайте свої страви та продукти — я сам підтягну калорії й БЖВ.\n" +
  "2️⃣ Задайте ціль на день.\n" +
  "3️⃣ Відкривайте «Сьогодні», тисніть на продукт — і ліміт перерахується.\n\n" +
  "Почніть із 🎯 Ціль або ➕ Додати продукт.";

export const HELP =
  "<b>Що вміє бот</b>\n\n" +
  "📅 <b>Сьогодні</b> або /today — ліміт на день, що вже з'їдено, і кнопки продуктів. " +
  "Натискання на продукт записує його порцію та перераховує ліміт.\n" +
  "➕ <b>Додати продукт</b> або /add &lt;назва&gt; — бот сам підтягне калорії та БЖВ, " +
  "ви підтвердите або введете вручну.\n" +
  "🎯 <b>Ціль</b> або /goal 2000 150 60 200 — ккал, білки, жири, вуглеводи (можна лише ккал: /goal 2000).\n" +
  "📋 <b>Мої продукти</b> або /products — список, видалення, зміна порції.\n" +
  "/eat &lt;назва&gt; &lt;грами&gt; — записати довільну кількість, наприклад <code>/eat гречка 150</code>.\n" +
  "↩️ <b>Відмінити</b> або /undo — прибрати останній запис за сьогодні.\n" +
  "/cancel — перервати поточну дію.";

export const GOAL_PROMPT =
  "Введіть ціль на день у форматі:\n<code>ккал білки жири вуглеводи</code>\n" +
  "Наприклад: <code>2000 150 60 200</code>\n\nМожна лише калорії: <code>2000</code>\n/cancel — скасувати";

export const ASK_NAME =
  "Напишіть назву страви або продукту, наприклад «гречка варена», «куряче філе», «борщ». " +
  "Я підтягну калорії та БЖВ.\n/cancel — скасувати";

export const ASK_MANUAL =
  "Введіть значення <b>на 100 г</b> у форматі:\n<code>ккал білки жири вуглеводи</code>\n" +
  "Наприклад: <code>110 4.2 1.1 21</code>";

export const SOURCE_LABEL: Record<string, string> = { claude: "Claude", openfoodfacts: "Open Food Facts", manual: "вручну" };
