import { describe, expect, it } from "vitest";
import type { AverageNode, CategoryAverages, CategoryNode, Dashboard, MonthTotals, Transaction } from "./api";
import { buildMobileReport, reportFileName } from "./mobileReport";
import type { ReportData } from "./reportData";

// Intl's fr-FR amounts use no-break spaces: compare them as plain spaces.
const plain = (s: string) => s.replace(/[  ]/g, " ");

const totals = (month: string, over: Partial<MonthTotals> = {}): MonthTotals => ({
  month,
  income: 2000,
  expenses: 1500,
  epargne: 300,
  desepargne: 0,
  reste: 200,
  ...over,
});

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

const averages = (month: string): CategoryAverages => ({
  months: 12,
  first_month: "2025-08",
  last_month: "2026-07",
  current_month: "2026-09",
  month,
  totals: { income: 2000, expenses: 1400, epargne: 300, desepargne: 0, reste: 300 },
  groups: [
    node(1, "Courses <b>", { expenses: 400, month_expenses: 450 }),
    node(2, "Salaire", { income: 2000, month_income: 2000 }),
  ],
  uncategorized: { expenses: 0, income: 0, month_expenses: 0, month_income: 0 },
  offset: { value: 0, month_value: 0 },
  savings: [],
});

const leaf: CategoryNode = { id: 1, name: "Courses <b>", credit: 0, debit: 450, balance: -450, children: [] };

const operation: Transaction = {
  id: 7,
  date_operation: "2026-08-07",
  date_valeur: "2026-08-07",
  budget_month: "2026-08",
  libelle: 'CARTE "MARCHE" & CIE',
  debit: 450,
  credit: 0,
  account: "PERSO",
  account_id: "PERSO",
  kind: "expense",
  category_id: 1,
  category: "Courses <b>",
  category_manual: false,
  note: null,
  rule_id: null,
  rule_pattern: null,
  transfer_group_id: null,
  kind_manual: false,
  split_category_id: null,
  split_category: null,
  split_amount: null,
  total: null,
};

function report(month: string, withOperation = true): ReportData {
  const data: Dashboard = {
    month,
    months_available: ["2026-09", "2026-08", "2026-07"],
    months_partial: [],
    income: 2000,
    expenses: 1500,
    epargne: 300,
    desepargne: 0,
    reste: 200,
    by_category: { id: null, name: "total", credit: 2000, debit: 1800, balance: 200, children: [leaf] },
    uncategorized: { count: 2, credit: 0, debit: 0, difference: 0, balanced: true },
    transfers: { count: 0, total: 0 },
    history: [totals("2026-06"), totals("2026-07"), totals(month), totals("2026-09")],
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
  };
  return { data, columns: [averages(month)], operations: new Map(withOperation ? [[leaf, [operation]]] : []) };
}

const input = (operations: boolean, months = ["2026-07", "2026-08"]) => ({
  reports: months.map((m) => report(m)),
  months,
  available: ["2026-09", "2026-08", "2026-07"],
  operations,
  today: new Date(2026, 8, 12),
});

describe("buildMobileReport", () => {
  it("answers first: the verdict, then the story, in plain words", () => {
    const html = plain(buildMobileReport(input(false)));
    expect(html).toContain('<p class="verdict good">Il reste 200,00 €</p>');
    expect(html).toContain("en moyenne 300,00 € par mois");
    expect(html).toContain("En août 2026, le foyer a gagné 2 000,00 € et dépensé 1 500,00 €. Il a mis 300,00 € de côté.");
  });

  it("lists the months oldest first, each as its own article, with a picker newest first", () => {
    const html = buildMobileReport(input(false));
    expect(html.indexOf('id="2026-07"')).toBeLessThan(html.indexOf('id="2026-08"'));
    expect(html).toContain('<select id="month"><option value="2026-08">');
    expect(html).toContain("<script>");
  });

  it("has no picker and no script for a single month", () => {
    const html = buildMobileReport(input(false, ["2026-08"]));
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('id="month"');
  });

  it("escapes every dynamic text", () => {
    const html = buildMobileReport(input(true));
    expect(html).toContain("Courses &lt;b&gt;");
    expect(html).not.toContain("Courses <b>");
    expect(html).toContain("CARTE &quot;MARCHE&quot; &amp; CIE");
  });

  it("leaves the operations out unless asked", () => {
    expect(buildMobileReport(input(false))).not.toContain("MARCHE");
    expect(buildMobileReport(input(true))).toContain("MARCHE");
  });

  it("warns about unclassed operations and flags the month still filling", () => {
    const html = plain(buildMobileReport({ ...input(false, ["2026-09"]), reports: [report("2026-09")] }));
    expect(html).toContain("2 opérations du mois ne sont pas encore classées");
    expect(html).toContain("mois en cours, pas encore clos");
  });

  it("is self-contained: no external file, no image, no network call", () => {
    const html = buildMobileReport(input(true));
    expect(html).not.toMatch(/<(link|img|iframe)\b/);
    expect(html).not.toMatch(/(src|href)="https?:/);
    expect(html).not.toMatch(/fetch\(|XMLHttpRequest/);
    expect(html).toContain('name="viewport"');
  });
});

describe("reportFileName", () => {
  it("names the month, or the first and last of several", () => {
    expect(reportFileName(["2026-08"])).toBe("comptes-foyer-2026-08.html");
    expect(reportFileName(["2026-06", "2026-07", "2026-08"])).toBe("comptes-foyer-2026-06-2026-08.html");
  });
});
