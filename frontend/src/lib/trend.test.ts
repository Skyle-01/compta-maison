import { describe, expect, it } from "vitest";
import type { MonthTotals } from "./api";
import {
  MAX_TREND_TICKS,
  averageLabel,
  monthTick,
  resteAverage,
  resteAverageMonths,
  trendTicks,
  trendValueLabels,
} from "./trend";

const months = (n: number, reste: (i: number) => number = () => 100): MonthTotals[] =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(2025, i, 1);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return { month, income: 0, expenses: 0, epargne: 0, desepargne: 0, reste: reste(i) };
  });

describe("trend helpers", () => {
  it("formats a compact French month tick", () => {
    expect(monthTick("2026-07")).toBe("juil.");
    expect(monthTick("bogus")).toBe("bogus");
  });

  it("ticks every month of a short series", () => {
    const h = months(6);
    expect(trendTicks(h, h[5].month)).toEqual(h.map((m) => m.month));
  });

  it("thins a long series but keeps the last and the current month", () => {
    const h = months(20);
    const ticks = trendTicks(h, h[7].month);
    expect(ticks.length).toBeLessThanOrEqual(MAX_TREND_TICKS + 2);
    expect(ticks).toContain(h[0].month);
    expect(ticks).toContain(h[7].month);
    expect(ticks).toContain(h[19].month);
  });

  it("labels the current month, or the extremes when viewing every month", () => {
    const h = months(5, (i) => [300, -120, 50, 800, 10][i]);
    expect([...trendValueLabels(h, h[2].month)]).toEqual([h[2].month]);
    expect(trendValueLabels(h, "all")).toEqual(new Set([h[1].month, h[3].month]));
    expect(trendValueLabels([], "all").size).toBe(0);
  });

  it("averages the Reste of the complete months only", () => {
    const h = months(4, (i) => [100, 200, 300, -1000][i]);
    expect(resteAverage(h)).toBe(200);
  });

  it("keeps the last 12 complete months", () => {
    const h = months(20, (i) => (i < 7 ? 1000 : 10));
    expect(resteAverage(h)).toBe(10);
  });

  it("has no average without a complete month", () => {
    expect(resteAverage(months(1))).toBeNull();
    expect(resteAverage([])).toBeNull();
  });

  it("names the months the average spans", () => {
    expect(resteAverageMonths(months(20))).toBe(12);
    expect(resteAverageMonths(months(5))).toBe(4);
    expect(averageLabel(12)).toBe("moyenne des 12 derniers mois clos");
    expect(averageLabel(4)).toBe("moyenne des 4 mois clos");
    expect(averageLabel(1)).toBe("moyenne du seul mois clos");
  });
});
