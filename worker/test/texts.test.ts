import { describe, expect, it } from "vitest";
import { dayKey, dayLabel, daySummary, fmtNum, parseGrams, parseMacros, parseNumbers, productCard } from "../src/texts";
import { forGrams, type Product } from "../src/types";

describe("texts", () => {
  it("fmtNum", () => {
    expect(fmtNum(1234)).toBe("1234");
    expect(fmtNum(12.34)).toBe("12.3");
    expect(fmtNum(0.96)).toBe("1");
  });

  it("parses numbers with comma decimals", () => {
    expect(parseNumbers("110 4,2 1.1 21")).toEqual([110, 4.2, 1.1, 21]);
  });

  it("parseMacros", () => {
    expect(parseMacros("2000")).toEqual({ kcal: 2000, protein: 0, fat: 0, carbs: 0 });
    expect(parseMacros("2000 150 60 200")).toEqual({ kcal: 2000, protein: 150, fat: 60, carbs: 200 });
    expect(parseMacros("2000 150")).toBeNull();
    expect(parseMacros("abc")).toBeNull();
  });

  it("parseGrams", () => {
    expect(parseGrams("150 г")).toBe(150);
    expect(parseGrams("-5")).toBeNull();
    expect(parseGrams("1 2")).toBeNull();
  });

  it("scales product macros", () => {
    const p: Product = { id: 1, userId: 1, name: "Гречка", per100g: { kcal: 110, protein: 4, fat: 1, carbs: 21 }, portionG: 150, source: "claude" };
    expect(forGrams(p, 50)).toEqual({ kcal: 55, protein: 2, fat: 0.5, carbs: 10.5 });
    expect(productCard({ ...p, name: "<b>x</b>" })).toContain("&lt;b&gt;");
  });

  it("day summary shows remaining and overrun", () => {
    const text = daySummary(
      "Сьогодні, 7 вересня",
      { kcal: 2000, protein: 150, fat: 60, carbs: 200 },
      { kcal: 1500, protein: 160, fat: 20, carbs: 100 },
      [{ id: 1, userId: 1, productId: 1, productName: "Гречка", grams: 150, macros: { kcal: 165, protein: 6, fat: 1.5, carbs: 31.5 }, day: "d", eatenAt: "t" }],
    );
    expect(text).toContain("залишилось <b>500</b> ккал");
    expect(text).toContain("перевищено на <b>10</b> г");
    expect(text).toContain("1. Гречка — 150 г (165 ккал)");
    expect(daySummary("x", null, { kcal: 0, protein: 0, fat: 0, carbs: 0 }, [])).toContain("Ціль не задана");
  });

  it("day key respects time zone", () => {
    const d = new Date("2026-09-07T22:30:00Z"); // 01:30 наступного дня в Києві
    expect(dayKey(d, "UTC")).toBe("2026-09-07");
    expect(dayKey(d, "Europe/Kyiv")).toBe("2026-09-08");
    expect(dayLabel(d, "Europe/Kyiv")).toBe("Сьогодні, 8 вересня");
  });
});
