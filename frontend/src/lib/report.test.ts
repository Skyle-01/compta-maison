import { describe, expect, it } from "vitest";
import {
  type AverageNode,
  type CategoryAverages,
  type CategoryNode,
  type Dashboard,
  type MonthTotals,
} from "./api";
import {
  averageMonth,
  averageNote,
  breakdown,
  buildStatement,
  dayMonth,
  monthFigures,
  netOfRefunds,
  notable,
  partialInReport,
  partialNote,
  exportLink,
  reportCards,
  reportMonth,
  reportSummary,
  reportSummaryParts,
  reportTitle,
  splitNote,
  STATEMENT_MONTHS,
  statementMonths,
  treeLeaves,
  unclassifiedNote,
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

describe("report months", () => {
  const available = ["2026-09", "2026-08", "2026-07"]; // newest first, 2026-09 still filling

  it("defaults to the latest complete month, else the only one", () => {
    expect(reportMonth(available)).toBe("2026-08");
    expect(reportMonth(["2026-09"])).toBe("2026-09");
    expect(reportMonth([])).toBeNull();
  });

  it("links the dashboard's month, except the month still filling", () => {
    expect(exportLink("2026-07", available)).toBe("/export?month=2026-07");
    expect(exportLink("2026-09", available)).toBe("/export");
  });

  it("lists the statement months oldest first, ending with the report month", () => {
    expect(statementMonths(available, "2026-08")).toEqual(["2026-07", "2026-08"]);
    const many = ["2026-09", "2026-08", "2026-07", "2026-06", "2026-05", "2026-04", "2026-03", "2026-02"];
    expect(statementMonths(many, "2026-09")).toEqual(many.slice(0, STATEMENT_MONTHS).reverse());
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
    ]);
    expect(expenses.rows.map((r) => [r.label, r.values, r.average, Boolean(r.muted)])).toEqual([
      ["Fixe", [800, 800], 800, false],
      ["Courses", [300, 350], 300, false],
      ["Non classé", [0, 15], 0, true],
    ]);
    expect(savings.rows.map((r) => [r.label, r.values, r.average])).toEqual([["Livret", [200, 200], 200]]);
  });

  it("takes the totals from the months' cards net of refunds, so the rows add up to them", () => {
    const s = buildStatement([column("2026-07", 2000, 800, 300), column("2026-08", 2100, 800, 350)], history);
    // The cards less the month's offset (5), the averages less the window's (10).
    expect(s.sections[0].total).toMatchObject({ values: [2000, 2100], average: 1990 });
    expect(s.sections[1].total).toMatchObject({ values: [1100, 1165], average: 1090 });
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

describe("netOfRefunds", () => {
  it("takes the offset off both income and expenses, leaving the rest", () => {
    expect(netOfRefunds({ income: 2000.1, expenses: 1500.2, reste: 500 }, 0.1)).toEqual({
      income: 2000,
      expenses: 1500.1,
      reste: 500,
    });
  });
});

describe("breakdown", () => {
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
    const b = breakdown(avg, "expenses");
    // Variable's 450 is the Σ of its children's targets: only Courses' own target compares.
    expect(b.map((g) => [g.name, g.month, g.average, g.target])).toEqual([
      ["Variable", 500, 400, null],
      ["Impôts", 0, 100, null],
    ]);
    expect(b[0].leaves.map((l) => [l.name, l.month, l.target])).toEqual([
      ["Courses", 320, 450],
      ["Sortie / Bar", 180, null],
    ]);
    expect(b[1].leaves).toEqual([]);
  });

  it("lists the month's income the same way, without targets", () => {
    const avg = averages({
      groups: [
        node(1, "Fixe", {
          expenses: 800,
          income: 2000,
          month_expenses: 800,
          month_income: 2100,
          target: 900,
          children: [
            node(11, "Salaire", { income: 2000, month_income: 2100 }),
            node(12, "Loyer", { expenses: 800, month_expenses: 800, target: 900 }),
          ],
        }),
        node(2, "Courses", { expenses: 300, month_expenses: 300 }),
      ],
    });
    const b = breakdown(avg, "income");
    expect(b.map((g) => [g.name, g.month, g.average, g.target])).toEqual([["Fixe", 2100, 2000, null]]);
    expect(b[0].leaves.map((l) => [l.name, l.month, l.target])).toEqual([["Salaire", 2100, null]]);
  });
});

describe("notable", () => {
  it("flags spending over its target, whatever the average", () => {
    expect(notable(460, 500, false, 450)).toBe("bad");
    expect(notable(450, 500, false, 450)).toBeNull();
  });

  it("flags a gap of at least 20 € and 20 % of the average, by its tone", () => {
    expect(notable(130, 100, false)).toBe("bad");
    expect(notable(70, 100, false)).toBe("good");
    expect(notable(70, 100, true)).toBe("bad");
    expect(notable(115, 100, false)).toBeNull(); // 15 €: too small
    expect(notable(1100, 1000, false)).toBeNull(); // 10 %: too small
    expect(notable(25, 0, false)).toBe("bad"); // a new category
  });

  it("has nothing to compare with without an average", () => {
    expect(notable(500, null, false)).toBeNull();
  });

  it("on a month still filling, only highlights what is already above its average or target", () => {
    expect(notable(70, 100, false, null, true)).toBeNull(); // spending below its average: not news yet
    expect(notable(70, 100, true, null, true)).toBeNull(); // income below its average: not news yet
    expect(notable(130, 100, false, null, true)).toBe("bad");
    expect(notable(130, 100, true, null, true)).toBe("good");
    expect(notable(460, 500, false, 450, true)).toBe("bad");
  });
});

describe("breakdown on a month still filling", () => {
  const groups = [node(1, "Courses", { expenses: 300, month_expenses: 100 })];

  it("highlights nothing below the average, but the same amount on a complete month", () => {
    const filling = averages({ month: "2026-09", current_month: "2026-09", groups });
    const complete = averages({ month: "2026-08", current_month: "2026-09", groups });
    expect(breakdown(filling, "expenses")[0].tone).toBeNull();
    expect(breakdown(complete, "expenses")[0].tone).toBe("good");
  });
});

describe("reportCards", () => {
  it("lists the four cards, the savings amber and the reste red when negative", () => {
    const cards = reportCards({ income: 2000, expenses: 1500, epargne: 100, desepargne: 400, reste: -200 });
    expect(cards.map((c) => [c.label, c.value, c.tone, c.goodIsUp])).toEqual([
      ["Revenus", 2000, "good", true],
      ["Dépenses", 1500, "bad", false],
      ["Épargne", -300, "warn", true],
      ["Reste", -200, "bad", true],
    ]);
  });
});

describe("averageMonth", () => {
  // Salary 2000 under Fixe next to the rent, a refund offset of 10, 15 unclassed spending: the
  // Dépenses card (net) is Fixe 800 + Courses 300 + Non classé 15 = 1115.
  const avg = averages({
    totals: { income: 2010, expenses: 1125, epargne: 250, desepargne: 50, reste: 685 },
    groups: [
      node(1, "Fixe", {
        expenses: 800,
        income: 2000,
        children: [node(11, "Salaire", { income: 2000 }), node(12, "Loyer", { expenses: 800, target: 900 })],
      }),
      node(2, "Courses", { expenses: 300, target: 350 }),
      node(3, "Vide", {}),
    ],
    uncategorized: { expenses: 15, income: 0, month_expenses: 0, month_income: 0 },
    offset: { value: 10, month_value: 0 },
    savings: [
      { account_id: "LIVRET", name: "Livret", epargne: 250, desepargne: 50, month_epargne: 0, month_desepargne: 0 },
      { account_id: "VIDE", name: "Vide", epargne: 0, desepargne: 0, month_epargne: 0, month_desepargne: 0 },
    ],
  });

  it("ranks spending by average with the own target, and leaves a zero-average row out", () => {
    const m = averageMonth(avg, "12");
    expect(m?.period).toBe("sur 12 mois (septembre 2025 – août 2026)");
    expect(m?.spending.map((g) => [g.name, g.value, g.target])).toEqual([
      ["Fixe", 800, null],
      ["Courses", 300, 350],
    ]);
    expect(m?.spending[0].leaves.map((l) => [l.name, l.value, l.target])).toEqual([["Loyer", 800, 900]]);
    expect(m?.spendingUnclassified).toBe(15);
    expect(m?.incomeUnclassified).toBeNull();
    expect(m?.savings.map((l) => [l.name, l.value])).toEqual([["Livret", 200]]);
  });

  it("lists the income by group and as flat sources", () => {
    const m = averageMonth(avg, "12");
    expect(m?.income.map((g) => [g.name, g.value, g.leaves.map((l) => l.name)])).toEqual([["Fixe", 2000, ["Salaire"]]]);
    expect(m?.incomeSources.map((l) => [l.name, l.value])).toEqual([["Salaire", 2000]]);
  });

  it("reconciles: rows + Non classé = the cards, and Revenus - Dépenses - Épargne = Reste", () => {
    const m = averageMonth(avg, "12");
    if (!m) throw new Error("no average month");
    const [income, expenses, epargne, reste] = m.cards.map((c) => c.value);
    const sum = (lines: { value: number }[]) => lines.reduce((total, l) => total + l.value, 0);
    expect(sum(m.spending) + (m.spendingUnclassified ?? 0)).toBe(expenses);
    expect(sum(m.incomeSources) + (m.incomeUnclassified ?? 0)).toBe(income);
    expect(sum(m.savings)).toBe(epargne);
    expect(income - expenses - epargne).toBe(reste);
  });

  it("is null while no budget month is complete", () => {
    expect(averageMonth(averages({ months: 0, first_month: null, last_month: null }), "12")).toBeNull();
  });
});

describe("treeLeaves", () => {
  const tree = (name: string, debit: number, children: CategoryNode[] = []): CategoryNode => ({
    id: null,
    name,
    credit: 0,
    debit,
    balance: -debit,
    children,
  });

  it("lists the leaves with money below the root, in display order", () => {
    const root = tree("total", 130, [
      tree("Logement", 100, [tree("Prêt", 90), tree("Charges", 10), tree("Énergie", 0)]),
      tree("Vide", 0, [tree("Rien", 0)]),
      tree("uncategorised", 30),
    ]);
    expect(treeLeaves(root).map((n) => n.name)).toEqual(["Prêt", "Charges", "uncategorised"]);
  });

  it("shortens an operation's date to its day and month", () => {
    expect(dayMonth("2026-08-07")).toBe("07/08");
  });
});

describe("unclassifiedNote", () => {
  it("is silent when everything is classed", () => {
    expect(unclassifiedNote(0)).toBeNull();
  });

  it("warns in the singular and the plural", () => {
    expect(unclassifiedNote(1)).toBe(
      "1 opération du mois n'est pas encore classée : les catégories peuvent encore bouger.",
    );
    expect(unclassifiedNote(3)).toBe(
      "3 opérations du mois ne sont pas encore classées : les catégories peuvent encore bouger.",
    );
  });
});

describe("partialInReport", () => {
  it("keeps the report's months that are partial, in the given order", () => {
    expect(partialInReport(["2026-08", "2026-07", "2026-06"], ["2026-06", "2026-04"])).toEqual(["2026-06"]);
    expect(partialInReport(["2026-08"], [])).toEqual([]);
  });
});

describe("splitNote", () => {
  it("names the whole amount of a split operation's part", () => {
    expect(plain(splitNote({ total: 40 }) ?? "")).toBe("scindée, sur 40,00 €");
  });

  it("is null for a whole operation", () => {
    expect(splitNote({ total: null })).toBeNull();
  });
});

describe("reportSummary", () => {
  it("tells the month in one sentence, with the average leftover", () => {
    const parts = reportSummaryParts(
      "2026-08",
      { income: 2000, expenses: 1500, epargne: 300, desepargne: 0, reste: 200 },
      150,
    );
    expect(plain(reportSummary(parts))).toBe(
      "En août 2026, le foyer a gagné 2 000,00 € et dépensé 1 500,00 €. Il a mis 300,00 € de côté. Il reste 200,00 € (en moyenne 150,00 € par mois).",
    );
  });

  it("says what is missing in a deficit month, without an average", () => {
    const parts = reportSummaryParts(
      "2026-08",
      { income: 1000, expenses: 1500, epargne: 0, desepargne: 100, reste: -400 },
      null,
    );
    expect(plain(reportSummary(parts))).toBe(
      "En août 2026, le foyer a gagné 1 000,00 € et dépensé 1 500,00 €. Il a puisé 100,00 € dans son épargne. Il manque 400,00 €.",
    );
  });
});

describe("partialNote and averageNote", () => {
  it("says nothing without a partial month, and names one or several", () => {
    expect(partialNote([])).toBeNull();
    expect(partialNote(["2026-06"])).toContain("juin 2026 est un mois partiel");
    expect(partialNote(["2026-06", "2026-07"])).toContain("juin 2026, juillet 2026 sont des mois partiels");
  });

  it("tells what the averages cover, or that none is ready", () => {
    expect(averageNote("sur 12 mois (a – b)")).toBe("Moyennes sur 12 mois (a – b), mois clos uniquement.");
    expect(averageNote(null)).toContain("Pas encore de mois clos");
  });
});

describe("monthFigures", () => {
  const dashboard = (over: Partial<Dashboard> = {}): Dashboard => ({
    month: "2026-08",
    months_available: ["2026-09", "2026-08"],
    months_partial: ["2026-07"],
    income: 2000,
    expenses: 1500,
    epargne: 300,
    desepargne: 0,
    reste: 200,
    by_category: { id: null, name: "total", credit: 0, debit: 0, balance: 0, children: [] },
    uncategorized: { count: 2, credit: 0, debit: 0, difference: 0, balanced: true },
    transfers: { count: 0, total: 0 },
    history: [totals("2026-07"), totals("2026-08"), totals("2026-09")],
    budget: {
      months: 1,
      target: 0,
      actual: 0,
      untargeted: 0,
      groups: [],
      savings_target: null,
      income_reference: 0,
      savings_actual: 0,
    },
    ...over,
  });

  it("nets the refunds off Revenus and Dépenses, with the average beside each card", () => {
    const avg = averages({
      totals: { income: 1810, expenses: 1310, epargne: 250, desepargne: 50, reste: 300 },
      offset: { value: 10, month_value: 20 },
    });
    const f = monthFigures(dashboard(), avg, "2026-08");
    expect(f.cards.map((c) => [c.label, c.value, c.average])).toEqual([
      ["Revenus", 1980, 1800],
      ["Dépenses", 1480, 1300],
      ["Épargne", 300, 200],
      ["Reste", 200, 300],
    ]);
    expect(plain(f.parts.average ?? "")).toBe("en moyenne 300,00 € par mois");
    expect(f.averageNote).toContain("Moyennes sur 12 mois");
  });

  it("has no average while no budget month is complete", () => {
    const f = monthFigures(dashboard(), averages({ months: 0, first_month: null, last_month: null }), "2026-08");
    expect(f.cards.map((c) => c.average)).toEqual([null, null, null, null]);
    expect(f.parts.average).toBeNull();
    expect(f.averageNote).toContain("Pas encore de mois clos");
  });

  it("stops the Reste chart at the month and flags its partial months and unclassed operations", () => {
    const f = monthFigures(dashboard(), averages({}), "2026-08");
    expect(f.history.map((h) => h.month)).toEqual(["2026-07", "2026-08"]);
    expect(f.partialNote).toContain("juillet 2026 est un mois partiel");
    expect(f.unclassified).toBe(unclassifiedNote(2));
    const clean = dashboard({
      months_partial: [],
      uncategorized: { count: 0, credit: 0, debit: 0, difference: 0, balanced: true },
    });
    expect(monthFigures(clean, averages({}), "2026-08")).toMatchObject({ partialNote: null, unclassified: null });
  });
});
