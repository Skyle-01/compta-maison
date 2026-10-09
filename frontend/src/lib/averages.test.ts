import { describe, expect, it } from "vitest";
import type { AverageNode, CategoryAverages } from "./api";
import {
  averageGap,
  averageNet,
  gapTone,
  monthNet,
  ownTarget,
  periodSummary,
  visibleAverageNodes,
} from "./averages";

const node = (name: string, over: Partial<AverageNode> = {}): AverageNode => ({
  id: name.length,
  name,
  expenses: 0,
  income: 0,
  month_expenses: 0,
  month_income: 0,
  target: null,
  children: [],
  ...over,
});

const averages = (over: Partial<CategoryAverages>): CategoryAverages => ({
  months: 6,
  first_month: "2026-03",
  last_month: "2026-08",
  current_month: "2026-09",
  month: "2026-09",
  totals: { income: 0, expenses: 0, epargne: 0, desepargne: 0, reste: 0 },
  groups: [],
  uncategorized: { expenses: 0, income: 0, month_expenses: 0, month_income: 0 },
  offset: { value: 0, month_value: 0 },
  savings: [],
  ...over,
});

describe("averages helpers", () => {
  it("tells an own target from a Σ of the children's", () => {
    const n = (target: number | null, children: AverageNode[] = []): AverageNode => ({
      id: 1,
      name: "n",
      expenses: 0,
      income: 0,
      month_expenses: null,
      month_income: null,
      target,
      children,
    });
    expect(ownTarget(n(100))).toBe(true); // a leaf's
    expect(ownTarget(n(300, [n(null), n(null)]))).toBe(true); // set on the group itself
    expect(ownTarget(n(100, [n(100), n(null)]))).toBe(false); // its children's sum
    expect(ownTarget(n(null))).toBe(false);
  });

  it("computes the gap to the average, none without a month", () => {
    expect(averageGap(120.1, 100.05)).toBe(20.05);
    expect(averageGap(80, 100)).toBe(-20);
    expect(averageGap(null, 100)).toBeNull();
  });

  it("colours a gap by whether up is good", () => {
    expect(gapTone(20, false)).toBe("bad"); // spending above the average
    expect(gapTone(-20, false)).toBe("good");
    expect(gapTone(20, true)).toBe("good"); // income above the average
    expect(gapTone(0.001, true)).toBe("flat");
  });

  it("keeps the nodes with money or a target, recursively", () => {
    const tree = [
      node("Vie courante", {
        expenses: 300,
        children: [node("Courses", { expenses: 300 }), node("Vide"), node("Visé", { target: 50 })],
      }),
      node("Dormant", { children: [node("Vide")] }),
      node("Nouveau", { month_expenses: 12, month_income: null }),
    ];
    const visible = visibleAverageNodes(tree);
    expect(visible.map((n) => n.name)).toEqual(["Vie courante", "Nouveau"]);
    expect(visible[0].children.map((n) => n.name)).toEqual(["Courses", "Visé"]);
  });

  it("summarises the period, flagging a short one", () => {
    expect(periodSummary(averages({}), "6")).toBe("sur 6 mois (mars 2026 – août 2026)");
    expect(periodSummary(averages({}), "12")).toBe("sur 6 mois seulement (mars 2026 – août 2026)");
    expect(periodSummary(averages({}), "all")).toBe("sur 6 mois (mars 2026 – août 2026)");
    expect(periodSummary(averages({ months: 1, first_month: "2026-08" }), "3")).toBe(
      "sur 1 mois seulement (août 2026)",
    );
    expect(periodSummary(averages({ months: 0, first_month: null, last_month: null }), "3")).toBeNull();
  });

  it("signs a row: income positive, spending negative", () => {
    expect(averageNet(450.1, 0)).toBe(-450.1);
    expect(averageNet(0, 2500)).toBe(2500);
    expect(averageNet(30.1, 10.05)).toBe(-20.05); // Non classé, gross on both sides
    expect(monthNet(-12, null)).toBe(12); // a refund month on a spending category
    expect(monthNet(null, 300)).toBe(300);
    expect(monthNet(null, null)).toBeNull();
  });
});
