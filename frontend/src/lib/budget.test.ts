import { describe, expect, it } from "vitest";
import { barWidth, budgetLeft, budgetMargin, budgetRatio, budgetTone, categoryTargets, parseTarget } from "./budget";

describe("budget helpers", () => {
  it("balances the targets against the income", () => {
    expect(budgetMargin(3370, 2385.1, 300)).toBe(684.9);
    expect(budgetMargin(2000, 2100, null)).toBe(-100);
    const cats = [
      { name: "Épargne", parent_id: null, budget_target: 300 },
      { name: "Logement", parent_id: null, budget_target: 1500 },
      { name: "Courses", parent_id: 7, budget_target: 450.5 },
      { name: "Bar", parent_id: 7, budget_target: null },
    ];
    expect(categoryTargets(cats)).toEqual({ spending: 1950.5, savings: 300 });
    expect(categoryTargets(cats.slice(1))).toEqual({
      spending: 1950.5,
      savings: null,
    });
  });

  it("computes the spent ratio, ignoring net refunds and missing targets", () => {
    expect(budgetRatio(45, 90)).toBe(0.5);
    expect(budgetRatio(-10, 90)).toBe(0);
    expect(budgetRatio(10, 0)).toBe(0);
  });

  it("bands the ratio into ok / warn / over", () => {
    expect(budgetTone(0.5)).toBe("ok");
    expect(budgetTone(0.9)).toBe("warn");
    expect(budgetTone(1)).toBe("warn");
    expect(budgetTone(1.01)).toBe("over");
  });

  it("caps the bar at 100 %", () => {
    expect(barWidth(0.456)).toBe(45.6);
    expect(barWidth(1.7)).toBe(100);
  });

  it("reports the room left or the overrun", () => {
    expect(budgetLeft(63.82, 50)).toBe(-13.82);
    expect(budgetLeft(0.1 + 0.2, 1)).toBe(0.7);
  });

  it("parses typed targets", () => {
    expect(parseTarget("")).toBeNull();
    expect(parseTarget("  ")).toBeNull();
    expect(parseTarget("12,50")).toBe(12.5);
    expect(parseTarget("1 200 €")).toBe(1200);
    expect(parseTarget("0")).toBeNaN();
    expect(parseTarget("abc")).toBeNaN();
  });
});
