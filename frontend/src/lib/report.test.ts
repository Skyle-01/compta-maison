import { describe, expect, it } from "vitest";
import type { AverageNode, BudgetSummary, CategoryAverages, MonthTotals, UncategorizedStats } from "./api";
import {
  attentionPoints,
  buildStatement,
  expenseBreakdown,
  reportLink,
  reportMonth,
  reportSummary,
  reportTitle,
  statementMonths,
} from "./report";

const node = (id: number, name: string, over: Partial<AverageNode> = {}): AverageNode => ({
  id,
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
  months: 12,
  first_month: "2025-09",
  last_month: "2026-08",
  current_month: "2026-09",
  month: "2026-08",
  totals: { income: 0, expenses: 0, epargne: 0, desepargne: 0, reste: 0 },
  groups: [],
  uncategorized: { expenses: 0, income: 0, month_expenses: 0, month_income: 0 },
  offset: { value: 0, month_value: 0 },
  savings: [],
  ...over,
});

const totals = (month: string, over: Partial<MonthTotals> = {}): MonthTotals => ({
  month,
  income: 0,
  expenses: 0,
  epargne: 0,
  desepargne: 0,
  reste: 0,
  ...over,
});

// Intl's fr-FR amounts use no-break spaces: compare them as plain spaces.
const plain = (s: string) => s.replace(/[  ]/g, " ");

const NO_UNCATEGORIZED: UncategorizedStats = { count: 0, credit: 0, debit: 0, difference: 0, balanced: true };
const NO_BUDGET: BudgetSummary = { months: 1, target: 0, actual: 0, untargeted: 0, groups: [] };

describe("report months", () => {
  const available = ["2026-09", "2026-08", "2026-07"]; // newest first, 2026-09 still filling

  it("defaults to the latest complete month, honours a known requested one", () => {
    expect(reportMonth(available, null)).toBe("2026-08");
    expect(reportMonth(available, "2026-07")).toBe("2026-07");
    expect(reportMonth(available, "2026-09")).toBe("2026-09");
    expect(reportMonth(available, "2020-01")).toBe("2026-08");
    expect(reportMonth(["2026-09"], null)).toBe("2026-09");
    expect(reportMonth([], null)).toBeNull();
  });

  it("links the dashboard's month, except every month or the month still filling", () => {
    expect(reportLink("2026-07", available)).toBe("/rapport?month=2026-07");
    expect(reportLink("2026-09", available)).toBe("/rapport");
    expect(reportLink("all", available)).toBe("/rapport");
  });

  it("lists the statement months oldest first, ending with the report month", () => {
    expect(statementMonths(available, "2026-08")).toEqual(["2026-07", "2026-08"]);
    expect(statementMonths(available, "2026-09", 2)).toEqual(["2026-08", "2026-09"]);
  });

  it("titles the report with the month", () => {
    expect(reportTitle("2026-08")).toBe("Comptes du foyer - août 2026");
  });
});

describe("buildStatement", () => {
  // Fixe holds the salary (income side) and the rent (spending side), as in the example taxonomy.
  const column = (month: string, salary: number, rent: number, food: number) =>
    averages({
      month,
      totals: { income: 2000, expenses: 1100, epargne: 200, desepargne: 0, reste: 700 },
      groups: [
        node(1, "Fixe", {
          expenses: 800,
          income: 2000,
          month_expenses: rent,
          month_income: salary,
          children: [
            node(11, "Salaire", { income: 2000, month_income: salary }),
            node(12, "Loyer", { expenses: 800, month_expenses: rent }),
          ],
        }),
        node(2, "Courses", { expenses: 300, month_expenses: food }),
        node(3, "Vide", {}),
      ],
      uncategorized: { expenses: 0, income: 0, month_expenses: month === "2026-08" ? 15 : 0, month_income: 0 },
      offset: { value: 10, month_value: 5 },
      savings: [
        { account_id: "LIVRET", name: "Livret", epargne: 250, desepargne: 50, month_epargne: 200, month_desepargne: 0 },
      ],
    });
  const history = [
    totals("2026-07", { income: 2005, expenses: 1105, epargne: 200, reste: 700 }),
    totals("2026-08", { income: 2105, expenses: 1170, epargne: 200, reste: 735 }),
  ];

  it("lists income by source, spending by top-level category, savings by account", () => {
    const s = buildStatement([column("2026-07", 2000, 800, 300), column("2026-08", 2100, 800, 350)], history);
    expect(s.months).toEqual(["2026-07", "2026-08"]);
    const [income, expenses, savings] = s.sections;
    expect(income.rows.map((r) => [r.label, r.values, r.average, Boolean(r.muted)])).toEqual([
      ["Salaire", [2000, 2100], 2000, false],
      ["Remboursements et compensations", [5, 5], 10, true],
    ]);
    expect(expenses.rows.map((r) => [r.label, r.values, r.average])).toEqual([
      ["Fixe", [800, 800], 800],
      ["Courses", [300, 350], 300],
      ["Non classé", [0, 15], 0],
      ["Remboursements et compensations", [5, 5], 10],
    ]);
    expect(savings.rows.map((r) => [r.label, r.values, r.average])).toEqual([["Livret", [200, 200], 200]]);
  });

  it("takes the totals from the months' cards and the window's averages", () => {
    const s = buildStatement([column("2026-07", 2000, 800, 300), column("2026-08", 2100, 800, 350)], history);
    expect(s.sections[0].total.values).toEqual([2005, 2105]);
    expect(s.sections[1].total).toMatchObject({ values: [1105, 1170], average: 1100 });
    expect(s.sections[2].total).toMatchObject({ values: [200, 200], average: 200 });
    expect(s.reste).toMatchObject({ label: "Reste", values: [700, 735], average: 700 });
  });

  it("has no average without a complete month and drops an empty savings section", () => {
    const only = averages({ months: 0, month: "2026-09", groups: [node(2, "Courses", { month_expenses: 40 })] });
    const s = buildStatement([only], [totals("2026-09", { expenses: 40, reste: -40 })]);
    expect(s.sections.map((x) => x.title)).toEqual(["Revenus", "Dépenses"]);
    expect(s.sections[1].rows).toEqual([{ key: "2", label: "Courses", values: [40], average: null }]);
    expect(s.reste.average).toBeNull();
  });
});

describe("expenseBreakdown", () => {
  it("lists the month's spending per group and leaf, largest first", () => {
    const avg = averages({
      groups: [
        node(1, "Variable", {
          expenses: 400,
          month_expenses: 500,
          target: 450,
          children: [
            node(11, "Courses", { expenses: 300, month_expenses: 320, target: 450 }),
            node(12, "Sortie", {
              expenses: 100,
              month_expenses: 180,
              children: [node(121, "Bar", { expenses: 100, month_expenses: 180 })],
            }),
            node(13, "Salaire", { income: 2000, month_income: 2000 }),
          ],
        }),
        node(2, "Impôts", { expenses: 100, month_expenses: 0 }),
        node(3, "Vide", {}),
      ],
    });
    const b = expenseBreakdown(avg);
    expect(b.map((g) => [g.name, g.month, g.average, g.target])).toEqual([
      ["Variable", 500, 400, 450],
      ["Impôts", 0, 100, null],
    ]);
    expect(b[0].leaves.map((l) => [l.name, l.month])).toEqual([
      ["Courses", 320],
      ["Sortie / Bar", 180],
    ]);
    expect(b[1].leaves).toEqual([]);
  });
});

describe("attentionPoints", () => {
  const breakdown = expenseBreakdown(
    averages({
      groups: [
        node(1, "Variable", {
          expenses: 1310,
          month_expenses: 1545,
          children: [
            node(11, "Courses", { expenses: 300, month_expenses: 420 }), // +120, 40 %: flagged
            node(12, "Essence", { expenses: 1000, month_expenses: 1100 }), // +100, only 10 %
            node(13, "Bar", { expenses: 10, month_expenses: 25 }), // +15 €: too small
          ],
        }),
      ],
    }),
  );

  it("flags overrun targets, large rises and uncategorised operations", () => {
    const budget: BudgetSummary = {
      ...NO_BUDGET,
      groups: [
        {
          id: 1,
          name: "Variable",
          target: 450,
          actual: 470,
          leaves: [
            { id: 11, name: "Courses", target: 350, actual: 420 },
            { id: 14, name: "Cadeaux", target: 100, actual: 50 },
          ],
        },
        { id: 5, name: "Santé", target: 50, actual: 50, leaves: [] },
      ],
    };
    expect(
      attentionPoints(breakdown, budget, { ...NO_UNCATEGORIZED, count: 2, debit: 30, credit: 0 }).map(plain),
    ).toEqual([
      "Objectif dépassé, Variable / Courses : 420,00 € pour 350,00 € prévus (+70,00 €).",
      "En hausse, Variable / Courses : 420,00 € contre 300,00 € en moyenne (+120,00 €).",
      "2 opérations pas encore classées (30,00 € de dépenses, 0,00 € de revenus) : comptées sous « Non classé ».",
    ]);
  });

  it("has nothing to say about a quiet month", () => {
    expect(attentionPoints([], NO_BUDGET, NO_UNCATEGORIZED)).toEqual([]);
  });
});

describe("reportSummary", () => {
  it("tells the month in one sentence, with the average leftover", () => {
    expect(
      plain(reportSummary("2026-08", { income: 2000, expenses: 1500, epargne: 300, desepargne: 0, reste: 200 }, 150)),
    ).toBe(
      "En août 2026, le foyer a gagné 2 000,00 € et dépensé 1 500,00 €. Il a mis 300,00 € de côté. Il reste 200,00 € (en moyenne 150,00 € par mois).",
    );
  });

  it("says what is missing in a deficit month, without an average", () => {
    expect(
      plain(reportSummary("2026-08", { income: 1000, expenses: 1500, epargne: 0, desepargne: 100, reste: -400 }, null)),
    ).toBe(
      "En août 2026, le foyer a gagné 1 000,00 € et dépensé 1 500,00 €. Il a puisé 100,00 € dans son épargne. Il manque 400,00 €.",
    );
  });
});
