import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { Database, normalizeQuery } from "../src/db";
import { resetTables } from "./helpers";

const M = (kcal: number, protein: number, fat: number, carbs: number) => ({ kcal, protein, fat, carbs });

describe("Database", () => {
  let db: Database;
  beforeEach(async () => {
    db = new Database(env.DB);
    await db.ensureSchema();
    await db.ensureSchema(); // ідемпотентно
    await resetTables(env.DB);
  });

  it("goal roundtrip and zero goal is null", async () => {
    expect(await db.getGoal(1)).toBeNull();
    await db.ensureUser(1);
    expect(await db.getGoal(1)).toBeNull();
    await db.setGoal(1, M(2000, 150, 60, 200));
    expect(await db.getGoal(1)).toEqual(M(2000, 150, 60, 200));
  });

  it("products are per user and searchable", async () => {
    const p = await db.addProduct(1, "Куряче філе", M(165, 31, 3.6, 0), 150, "claude");
    await db.addProduct(1, "Філе лосося", M(208, 20, 13, 0));
    expect(p.portionG).toBe(150);
    expect((await db.listProducts(1)).map((x) => x.name)).toEqual(["Куряче філе", "Філе лосося"]);
    expect(await db.listProducts(2)).toEqual([]);
    expect(await db.getProduct(2, p.id)).toBeNull();
    expect((await db.findProduct(1, "філе лосося"))?.name).toBe("Філе лосося");
    expect((await db.findProduct(1, "куряче"))?.name).toBe("Куряче філе");
    expect(await db.findProduct(1, "борщ")).toBeNull();
  });

  it("entries, totals, undo", async () => {
    const p = await db.addProduct(1, "Гречка", M(110, 4, 1, 21));
    const day = "2026-09-07";
    await db.addEntry(1, p, 150, day, new Date("2026-09-07T10:00:00Z"));
    await db.addEntry(1, p, 50, day, new Date("2026-09-07T11:00:00Z"));
    expect(await db.dayTotals(1, day)).toEqual(M(220, 8, 2, 42));
    expect(await db.dayTotals(1, "2026-09-08")).toEqual(M(0, 0, 0, 0));
    expect((await db.listEntries(1, day)).map((e) => e.grams)).toEqual([150, 50]);
    const removed = await db.deleteLastEntry(1, day);
    expect(removed?.grams).toBe(50);
    expect(await db.dayTotals(1, day)).toEqual(M(165, 6, 1.5, 31.5));
    expect(await db.deleteLastEntry(1, "2026-09-08")).toBeNull();
  });

  it("deleting a product keeps diary entries; portion update", async () => {
    const p = await db.addProduct(1, "Банан", M(89, 1.1, 0.3, 23));
    await db.addEntry(1, p, 120, "2026-09-07", new Date());
    expect(await db.setPortion(1, p.id, 250)).toBe(true);
    expect((await db.getProduct(1, p.id))?.portionG).toBe(250);
    expect(await db.setPortion(2, p.id, 100)).toBe(false);
    expect(await db.deleteProduct(1, p.id)).toBe(true);
    expect(await db.listProducts(1)).toEqual([]);
    expect((await db.listEntries(1, "2026-09-07"))[0].productName).toBe("Банан");
  });

  it("lookup cache is keyed by normalized query", async () => {
    expect(normalizeQuery("  Гречка   Варена. ")).toBe("гречка варена");
    expect(await db.getCachedLookup("гречка")).toBeNull();
    await db.setCachedLookup("Гречка ", { name: "Гречка варена", kcal: 110 });
    expect(await db.getCachedLookup("гречка")).toEqual({ name: "Гречка варена", kcal: 110 });
    expect(await db.getCachedLookup("  ГРЕЧКА")).toEqual({ name: "Гречка варена", kcal: 110 });
  });

  it("dialog state roundtrip", async () => {
    expect(await db.getState(1)).toBeNull();
    await db.setState(1, { name: "goal" });
    expect(await db.getState(1)).toEqual({ name: "goal" });
    await db.setState(1, { name: "edit_portion", productId: 7 });
    expect(await db.getState(1)).toEqual({ name: "edit_portion", productId: 7 });
    await db.clearState(1);
    expect(await db.getState(1)).toBeNull();
  });
});
