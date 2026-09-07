import { type Entry, type Macros, type Product, type DialogState, forGrams, isZero } from "./types";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     user_id INTEGER PRIMARY KEY,
     kcal_goal REAL NOT NULL DEFAULT 0,
     protein_goal REAL NOT NULL DEFAULT 0,
     fat_goal REAL NOT NULL DEFAULT 0,
     carbs_goal REAL NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS products (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id INTEGER NOT NULL,
     name TEXT NOT NULL,
     kcal REAL NOT NULL, protein REAL NOT NULL, fat REAL NOT NULL, carbs REAL NOT NULL,
     portion_g REAL NOT NULL DEFAULT 100,
     source TEXT NOT NULL DEFAULT 'manual',
     created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_products_user ON products(user_id)`,
  `CREATE TABLE IF NOT EXISTS entries (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id INTEGER NOT NULL,
     product_id INTEGER,
     product_name TEXT NOT NULL,
     grams REAL NOT NULL,
     kcal REAL NOT NULL, protein REAL NOT NULL, fat REAL NOT NULL, carbs REAL NOT NULL,
     day TEXT NOT NULL,
     eaten_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_entries_user_day ON entries(user_id, day)`,
  `CREATE TABLE IF NOT EXISTS states (
     user_id INTEGER PRIMARY KEY,
     state TEXT NOT NULL,
     updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS lookup_cache (
     query TEXT PRIMARY KEY,
     result TEXT NOT NULL,
     created_at TEXT NOT NULL)`,
];

/** Нормалізує запит для кешу: без регістру, зайвих пробілів і пунктуації по краях. */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ").replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, "");
}

interface ProductRow {
  id: number; user_id: number; name: string; kcal: number; protein: number; fat: number; carbs: number;
  portion_g: number; source: string;
}
interface EntryRow {
  id: number; user_id: number; product_id: number | null; product_name: string; grams: number;
  kcal: number; protein: number; fat: number; carbs: number; day: string; eaten_at: string;
}

const toProduct = (r: ProductRow): Product => ({
  id: r.id, userId: r.user_id, name: r.name,
  per100g: { kcal: r.kcal, protein: r.protein, fat: r.fat, carbs: r.carbs },
  portionG: r.portion_g, source: r.source,
});
const toEntry = (r: EntryRow): Entry => ({
  id: r.id, userId: r.user_id, productId: r.product_id, productName: r.product_name, grams: r.grams,
  macros: { kcal: r.kcal, protein: r.protein, fat: r.fat, carbs: r.carbs }, day: r.day, eatenAt: r.eaten_at,
});
const now = () => new Date().toISOString();

export class Database {
  constructor(private readonly d1: D1Database) {}

  async ensureSchema(): Promise<void> {
    await this.d1.batch(SCHEMA.map((sql) => this.d1.prepare(sql)));
  }

  // ---------- users / goals ----------

  async ensureUser(userId: number): Promise<void> {
    await this.d1.prepare("INSERT OR IGNORE INTO users(user_id, created_at) VALUES (?, ?)").bind(userId, now()).run();
  }

  async setGoal(userId: number, goal: Macros): Promise<void> {
    await this.ensureUser(userId);
    await this.d1
      .prepare("UPDATE users SET kcal_goal=?, protein_goal=?, fat_goal=?, carbs_goal=? WHERE user_id=?")
      .bind(goal.kcal, goal.protein, goal.fat, goal.carbs, userId)
      .run();
  }

  async getGoal(userId: number): Promise<Macros | null> {
    const row = await this.d1
      .prepare("SELECT kcal_goal k, protein_goal p, fat_goal f, carbs_goal c FROM users WHERE user_id=?")
      .bind(userId)
      .first<{ k: number; p: number; f: number; c: number }>();
    if (!row) return null;
    const goal = { kcal: row.k, protein: row.p, fat: row.f, carbs: row.c };
    return isZero(goal) ? null : goal;
  }

  // ---------- products ----------

  async addProduct(userId: number, name: string, per100g: Macros, portionG = 100, source = "manual"): Promise<Product> {
    await this.ensureUser(userId);
    const row = await this.d1
      .prepare(
        `INSERT INTO products(user_id, name, kcal, protein, fat, carbs, portion_g, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .bind(userId, name.trim(), per100g.kcal, per100g.protein, per100g.fat, per100g.carbs, portionG, source, now())
      .first<ProductRow>();
    if (!row) throw new Error("insert failed");
    return toProduct(row);
  }

  async listProducts(userId: number): Promise<Product[]> {
    const { results } = await this.d1
      .prepare("SELECT * FROM products WHERE user_id=? ORDER BY name COLLATE NOCASE")
      .bind(userId)
      .all<ProductRow>();
    return results.map(toProduct);
  }

  async getProduct(userId: number, productId: number): Promise<Product | null> {
    const row = await this.d1
      .prepare("SELECT * FROM products WHERE user_id=? AND id=?")
      .bind(userId, productId)
      .first<ProductRow>();
    return row ? toProduct(row) : null;
  }

  /** Пошук за назвою: спочатку точний збіг, потім за підрядком. */
  async findProduct(userId: number, query: string): Promise<Product | null> {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const products = await this.listProducts(userId);
    return (
      products.find((p) => p.name.toLowerCase() === q) ??
      products.find((p) => p.name.toLowerCase().includes(q)) ??
      null
    );
  }

  async deleteProduct(userId: number, productId: number): Promise<boolean> {
    const res = await this.d1.prepare("DELETE FROM products WHERE user_id=? AND id=?").bind(userId, productId).run();
    return (res.meta.changes ?? 0) > 0;
  }

  async setPortion(userId: number, productId: number, portionG: number): Promise<boolean> {
    const res = await this.d1
      .prepare("UPDATE products SET portion_g=? WHERE user_id=? AND id=?")
      .bind(portionG, userId, productId)
      .run();
    return (res.meta.changes ?? 0) > 0;
  }

  // ---------- diary ----------

  async addEntry(userId: number, product: Product, grams: number, day: string, eatenAt: Date): Promise<Entry> {
    const m = forGrams(product, grams);
    const row = await this.d1
      .prepare(
        `INSERT INTO entries(user_id, product_id, product_name, grams, kcal, protein, fat, carbs, day, eaten_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .bind(userId, product.id, product.name, grams, m.kcal, m.protein, m.fat, m.carbs, day, eatenAt.toISOString())
      .first<EntryRow>();
    if (!row) throw new Error("insert failed");
    return toEntry(row);
  }

  async listEntries(userId: number, day: string): Promise<Entry[]> {
    const { results } = await this.d1
      .prepare("SELECT * FROM entries WHERE user_id=? AND day=? ORDER BY eaten_at, id")
      .bind(userId, day)
      .all<EntryRow>();
    return results.map(toEntry);
  }

  async dayTotals(userId: number, day: string): Promise<Macros> {
    const row = await this.d1
      .prepare(
        `SELECT COALESCE(SUM(kcal),0) k, COALESCE(SUM(protein),0) p, COALESCE(SUM(fat),0) f, COALESCE(SUM(carbs),0) c
         FROM entries WHERE user_id=? AND day=?`,
      )
      .bind(userId, day)
      .first<{ k: number; p: number; f: number; c: number }>();
    return { kcal: row?.k ?? 0, protein: row?.p ?? 0, fat: row?.f ?? 0, carbs: row?.c ?? 0 };
  }

  async deleteLastEntry(userId: number, day: string): Promise<Entry | null> {
    const row = await this.d1
      .prepare("DELETE FROM entries WHERE id = (SELECT id FROM entries WHERE user_id=? AND day=? ORDER BY id DESC LIMIT 1) RETURNING *")
      .bind(userId, day)
      .first<EntryRow>();
    return row ? toEntry(row) : null;
  }

  // ---------- dialog state ----------

  async getState(userId: number): Promise<DialogState | null> {
    const row = await this.d1.prepare("SELECT state FROM states WHERE user_id=?").bind(userId).first<{ state: string }>();
    return row ? (JSON.parse(row.state) as DialogState) : null;
  }

  async setState(userId: number, state: DialogState): Promise<void> {
    await this.d1
      .prepare("INSERT OR REPLACE INTO states(user_id, state, updated_at) VALUES (?, ?, ?)")
      .bind(userId, JSON.stringify(state), now())
      .run();
  }

  async clearState(userId: number): Promise<void> {
    await this.d1.prepare("DELETE FROM states WHERE user_id=?").bind(userId).run();
  }

  // ---------- кеш пошуку БЖВ (спільний для всіх користувачів) ----------

  async getCachedLookup<T>(query: string): Promise<T | null> {
    const row = await this.d1
      .prepare("SELECT result FROM lookup_cache WHERE query=?")
      .bind(normalizeQuery(query))
      .first<{ result: string }>();
    return row ? (JSON.parse(row.result) as T) : null;
  }

  async setCachedLookup(query: string, result: unknown): Promise<void> {
    await this.d1
      .prepare("INSERT OR REPLACE INTO lookup_cache(query, result, created_at) VALUES (?, ?, ?)")
      .bind(normalizeQuery(query), JSON.stringify(result), now())
      .run();
  }
}
