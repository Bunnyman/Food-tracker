import { InlineKeyboard, Keyboard } from "grammy";
import type { Product } from "./types";
import { fmtNum } from "./texts";

export const BTN_TODAY = "📅 Сьогодні";
export const BTN_ADD = "➕ Додати продукт";
export const BTN_GOAL = "🎯 Ціль";
export const BTN_PRODUCTS = "📋 Мої продукти";
export const BTN_UNDO = "↩️ Відмінити останнє";
export const BTN_HELP = "❓ Допомога";
export const MENU_BUTTONS = new Set([BTN_TODAY, BTN_ADD, BTN_GOAL, BTN_PRODUCTS, BTN_UNDO, BTN_HELP]);

export const QUICK_PORTIONS = [50, 100, 150, 200, 250, 300];

export function mainMenu(): Keyboard {
  return new Keyboard()
    .text(BTN_TODAY).text(BTN_ADD).row()
    .text(BTN_GOAL).text(BTN_PRODUCTS).row()
    .text(BTN_UNDO).text(BTN_HELP)
    .resized();
}

export function todayKeyboard(products: Product[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  products.forEach((p, i) => {
    kb.text(`${p.name} · ${fmtNum(p.portionG)} г`.slice(0, 60), `eat:${p.id}`);
    if (i % 2 === 1) kb.row();
  });
  if (products.length % 2 === 1) kb.row();
  if (!products.length) kb.text("➕ Додати перший продукт", "add:start").row();
  kb.text("🔄 Оновити", "today:refresh").text("↩️ Відмінити останнє", "today:undo");
  return kb;
}

export function confirmLookupKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Зберегти", "add:save").text("✏️ Ввести вручну", "add:manual").row()
    .text("❌ Скасувати", "add:cancel");
}

export function manualOnlyKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("✏️ Ввести вручну", "add:manual").text("❌ Скасувати", "add:cancel");
}

export function portionKeyboard(defaultG: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  QUICK_PORTIONS.forEach((g, i) => {
    kb.text(`${g} г`, `portion:${g}`);
    if (i === 2) kb.row();
  });
  kb.row().text(`Залишити ${fmtNum(defaultG)} г`, `portion:${defaultG}`);
  return kb;
}

export function productsKeyboard(products: Product[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const p of products) kb.text(`${p.name} · ${fmtNum(p.per100g.kcal)} ккал/100 г`, `prod:${p.id}`).row();
  kb.text("➕ Додати продукт", "add:start");
  return kb;
}

export function productKeyboard(p: Product): InlineKeyboard {
  return new InlineKeyboard()
    .text("🍽 З'їсти порцію", `eat:${p.id}`).row()
    .text("⚖️ Змінити порцію", `prod_portion:${p.id}`).text("🗑 Видалити", `prod_del:${p.id}`).row()
    .text("◀️ До списку", "prod:list");
}

export function confirmDeleteKeyboard(productId: number): InlineKeyboard {
  return new InlineKeyboard().text("🗑 Так, видалити", `prod_del_yes:${productId}`).text("◀️ Ні", `prod:${productId}`);
}
