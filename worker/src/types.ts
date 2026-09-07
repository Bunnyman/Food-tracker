export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  ANTHROPIC_API_KEY?: string;
  CLAUDE_MODEL?: string;
  TZ?: string;
}

/** Калорії та БЖВ — і для цілей, і для сум за день. */
export interface Macros {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}

export const ZERO: Macros = { kcal: 0, protein: 0, fat: 0, carbs: 0 };

export function add(a: Macros, b: Macros): Macros {
  return { kcal: a.kcal + b.kcal, protein: a.protein + b.protein, fat: a.fat + b.fat, carbs: a.carbs + b.carbs };
}

export function scale(m: Macros, factor: number): Macros {
  return { kcal: m.kcal * factor, protein: m.protein * factor, fat: m.fat * factor, carbs: m.carbs * factor };
}

export function isZero(m: Macros): boolean {
  return !m.kcal && !m.protein && !m.fat && !m.carbs;
}

export interface Product {
  id: number;
  userId: number;
  name: string;
  per100g: Macros;
  portionG: number;
  source: string;
}

export function forGrams(p: Product, grams: number): Macros {
  return scale(p.per100g, grams / 100);
}

export interface Entry {
  id: number;
  userId: number;
  productId: number | null;
  productName: string;
  grams: number;
  macros: Macros;
  day: string;
  eatenAt: string;
}

/** Стан діалогу (аналог FSM), зберігається в D1. */
export type DialogState =
  | { name: "goal" }
  | { name: "add_name" }
  | { name: "add_confirm"; product: PendingProduct }
  | { name: "add_manual"; product: PendingProduct }
  | { name: "add_portion"; product: PendingProduct }
  | { name: "edit_portion"; productId: number };

export interface PendingProduct {
  name: string;
  per100g: Macros | null;
  portionG: number;
  source: string;
}
