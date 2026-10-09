/** Pure helpers for the printable report (/rapport). */
import {
  ALL_MONTHS,
  type AverageNode,
  type AveragePeriod,
  type CategoryAverages,
  type CategoryNode,
  type Dashboard,
  type MonthTotals,
  formatEuro,
  frenchMonth,
} from "./api";
import { gapTone, ownTarget } from "./averages";

/** Budget months in the « Les derniers mois » statement. */
export const STATEMENT_MONTHS = 6;
/** The period every report average covers (complete budget months). */
export const REPORT_AVERAGE: AveragePeriod = "12";
/** A month worth highlighting: at least this many euros away from the average and this share of it. */
export const NOTABLE_MIN = 20;
export const NOTABLE_RATIO = 0.2;

const EPS = 0.005;
const nonZero = (value: number | null | undefined) => Math.abs(value ?? 0) >= EPS;

/** "Comptes du foyer - septembre 2026": the report heading and the PDF's default file name. */
export function reportTitle(month: string): string {
  return `Comptes du foyer - ${frenchMonth(month)}`;
}

/** The month the report covers: the requested one when it exists, else the latest complete month
 *  (the latest one is still filling until the next paycheck), else the only one. `available` is
 *  newest first, like Dashboard.months_available. */
export function reportMonth(available: string[], requested: string | null): string | null {
  if (requested && available.includes(requested)) return requested;
  return available[1] ?? available[0] ?? null;
}

/** The dashboard's « Rapport PDF » link: for the month shown, unless it is every month or the
 *  month still filling (the report then defaults to the latest complete month). */
export function reportLink(month: string, available: string[]): string {
  return month === ALL_MONTHS || month === available[0] ? "/rapport" : `/rapport?month=${month}`;
}

/** The statement's columns, oldest first: up to `count` budget months ending with `month`. */
export function statementMonths(available: string[], month: string, count = STATEMENT_MONTHS): string[] {
  return available
    .filter((m) => m <= month)
    .slice(0, count)
    .reverse();
}

export interface StatementRow {
  key: string;
  label: string;
  /** One value per statement month. */
  values: number[];
  /** The average month; null while no budget month is complete. */
  average: number | null;
  /** An explanatory line (Non classé) rather than a category. */
  muted?: boolean;
}

export interface StatementSection {
  title: string;
  rows: StatementRow[];
  total: StatementRow;
}

export interface Statement {
  months: string[];
  sections: StatementSection[];
  reste: StatementRow;
}

type Totals = Omit<MonthTotals, "month">;
const NO_TOTALS: Totals = { income: 0, expenses: 0, epargne: 0, desepargne: 0, reste: 0 };

/** Every leaf below `nodes`, named by its path from them (« Sortie / Bar »). */
function leaves(nodes: AverageNode[], prefix = ""): { node: AverageNode; name: string }[] {
  return nodes.flatMap((n) => {
    const name = prefix ? `${prefix} / ${n.name}` : n.name;
    return n.children.length === 0 ? [{ node: n, name }] : leaves(n.children, name);
  });
}

/** Rows keyed across the columns: `pick` reads one column's value for each key (absent = 0). */
function collect(
  columns: CategoryAverages[],
  pick: (avg: CategoryAverages) => { key: string; label: string; value: number; average: number }[],
  hasAverage: boolean,
): StatementRow[] {
  const rows = new Map<string, StatementRow>();
  const row = (key: string, label: string) => {
    let r = rows.get(key);
    if (!r) {
      r = { key, label, values: columns.map(() => 0), average: hasAverage ? 0 : null };
      rows.set(key, r);
    }
    return r;
  };
  columns.forEach((avg, i) => {
    for (const { key, label, value } of pick(avg)) row(key, label).values[i] = value;
  });
  // Every column shares the same averaging window: read the averages from the last one.
  if (hasAverage && columns.length > 0) {
    for (const { key, label, average } of pick(columns[columns.length - 1])) row(key, label).average = average;
  }
  return [...rows.values()]
    .filter((r) => nonZero(r.average) || r.values.some(nonZero))
    .sort((a, b) => (b.average ?? 0) - (a.average ?? 0) || a.label.localeCompare(b.label, "fr"));
}

const cents = (value: number) => Math.round(value * 100) / 100;

/** The cards net of refunds: `offset` (refunds on spending categories + spending on income
 *  categories, see CategoryAverages.offset) counts on both sides of the cards, so taking it off
 *  both leaves each category net and the reste unchanged. */
export function netOfRefunds<T extends { income: number; expenses: number }>(totals: T, offset: number): T {
  return { ...totals, income: cents(totals.income - offset), expenses: cents(totals.expenses - offset) };
}

/** The « Les derniers mois » statement: one column per budget month (`columns`, oldest first, each
 *  the averages payload for that month, all over the same window) plus the average month.
 *  Income is listed by source (income-side leaves, as the Sankey does), spending by top-level
 *  category, savings by account, every category net of its refunds; Non classé closes each side.
 *  Totals are the cards (`history`) net of refunds, so a column's rows add up to its total. */
export function buildStatement(columns: CategoryAverages[], history: MonthTotals[]): Statement {
  const months = columns.map((c) => c.month ?? "");
  const last = columns[columns.length - 1];
  const hasAverage = columns.length > 0 && last.months > 0;
  const averageTotals = hasAverage ? netOfRefunds(last.totals, last.offset.value) : null;
  const byMonth = new Map(history.map((h) => [h.month, h]));
  const monthTotals = columns.map((c, i) =>
    netOfRefunds(byMonth.get(months[i]) ?? NO_TOTALS, c.offset.month_value ?? 0),
  );
  const total = (key: string, label: string, pick: (t: Totals) => number): StatementRow => ({
    key,
    label,
    values: monthTotals.map(pick),
    average: averageTotals ? pick(averageTotals) : null,
  });
  const muted = (rows: StatementRow[]) => rows.map((r) => ({ ...r, muted: true }));

  const income: StatementSection = {
    title: "Revenus",
    rows: [
      ...collect(
        columns,
        (a) =>
          leaves(a.groups).map(({ node }) => ({
            key: String(node.id),
            label: node.name,
            value: node.month_income ?? 0,
            average: node.income,
          })),
        hasAverage,
      ),
      ...muted(
        collect(
          columns,
          (a) => [
            {
              key: "unc",
              label: "Non classé",
              value: a.uncategorized.month_income ?? 0,
              average: a.uncategorized.income,
            },
          ],
          hasAverage,
        ),
      ),
    ],
    total: total("income", "Total des revenus", (t) => t.income),
  };

  const expenses: StatementSection = {
    title: "Dépenses",
    rows: [
      ...collect(
        columns,
        (a) =>
          a.groups.map((g) => ({
            key: String(g.id),
            label: g.name,
            value: g.month_expenses ?? 0,
            average: g.expenses,
          })),
        hasAverage,
      ),
      ...muted(
        collect(
          columns,
          (a) => [
            {
              key: "unc",
              label: "Non classé",
              value: a.uncategorized.month_expenses ?? 0,
              average: a.uncategorized.expenses,
            },
          ],
          hasAverage,
        ),
      ),
    ],
    total: total("expenses", "Total des dépenses", (t) => t.expenses),
  };

  const savings: StatementSection = {
    title: "Épargne",
    rows: collect(
      columns,
      (a) =>
        a.savings.map((s) => ({
          key: s.account_id,
          label: s.name,
          value: (s.month_epargne ?? 0) - (s.month_desepargne ?? 0),
          average: s.epargne - s.desepargne,
        })),
      hasAverage,
    ),
    total: total("epargne", "Épargne nette", (t) => t.epargne - t.desepargne),
  };
  const hasSavings =
    savings.rows.length > 0 || nonZero(savings.total.average) || savings.total.values.some(nonZero);

  return {
    months,
    sections: hasSavings ? [income, expenses, savings] : [income, expenses],
    reste: total("reste", "Reste", (t) => t.reste),
  };
}

export interface BreakdownLine {
  id: number;
  name: string;
  month: number;
  average: number | null;
  target: number | null;
}

export interface BreakdownGroup extends BreakdownLine {
  leaves: BreakdownLine[];
}

export type BreakdownSide = "expenses" | "income";

/** The month's spending (or income) per top-level category and its leaves (named by their path
 *  below the group), largest first, with the average month and, for spending, the target; a
 *  category with none of it this month nor on average is left out. */
export function breakdown(avg: CategoryAverages, side: BreakdownSide): BreakdownGroup[] {
  const hasAverage = avg.months > 0;
  const line = (n: AverageNode, name: string): BreakdownLine => ({
    id: n.id,
    name,
    month: (side === "expenses" ? n.month_expenses : n.month_income) ?? 0,
    average: hasAverage ? n[side] : null,
    // Only an own target is comparable (a Σ of children's targets leaves untargeted ones out).
    target: side === "expenses" && ownTarget(n) ? n.target : null,
  });
  const relevant = (l: BreakdownLine) => nonZero(l.month) || nonZero(l.average);
  const order = (a: BreakdownLine, b: BreakdownLine) =>
    b.month - a.month || (b.average ?? 0) - (a.average ?? 0) || a.name.localeCompare(b.name, "fr");
  return avg.groups
    .map((g) => ({
      ...line(g, g.name),
      leaves: leaves(g.children)
        .map(({ node, name }) => line(node, name))
        .filter(relevant)
        .sort(order),
    }))
    .filter(relevant)
    .sort(order);
}

/** Whether a month's amount deserves a highlight: "bad" for spending over its target, else the
 *  gap's tone when the month is at least NOTABLE_MIN € and NOTABLE_RATIO of the average away from
 *  it; null for an ordinary month (or no average to compare with). */
export function notable(
  month: number,
  average: number | null,
  goodIsUp: boolean,
  target: number | null = null,
): "good" | "bad" | null {
  if (target !== null && month - target >= EPS) return "bad";
  if (average === null) return null;
  const gap = month - average;
  if (Math.abs(gap) < NOTABLE_MIN || Math.abs(gap) < NOTABLE_RATIO * Math.abs(average)) return null;
  const tone = gapTone(gap, goodIsUp);
  return tone === "flat" ? null : tone;
}

/** The balance tree's leaves with some money (below the root), in display order: the nodes whose
 *  operations the report's « Détail par catégorie » lists. */
export function treeLeaves(root: CategoryNode): CategoryNode[] {
  const active = (n: CategoryNode) => n.credit !== 0 || n.debit !== 0;
  const walk = (n: CategoryNode): CategoryNode[] =>
    n.children.filter(active).flatMap((c) => (c.children.length === 0 ? [c] : walk(c)));
  return walk(root);
}

/** "2026-08-07" -> "07/08": an operation's day in the one-month report. */
export const dayMonth = (date: string): string => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

/** The month in one plain sentence for a reader outside the app, e.g. « En septembre 2026, le
 *  foyer a gagné … et dépensé … Il a mis … de côté. Il reste … (en moyenne … par mois). » */
export function reportSummary(
  month: string,
  d: Pick<Dashboard, "income" | "expenses" | "epargne" | "desepargne" | "reste">,
  averageReste: number | null,
): string {
  const parts = [
    `En ${frenchMonth(month)}, le foyer a gagné ${formatEuro(d.income)} et dépensé ${formatEuro(d.expenses)}.`,
  ];
  if (nonZero(d.epargne)) parts.push(`Il a mis ${formatEuro(d.epargne)} de côté.`);
  if (nonZero(d.desepargne)) parts.push(`Il a puisé ${formatEuro(d.desepargne)} dans son épargne.`);
  const average = averageReste === null ? "" : ` (en moyenne ${formatEuro(averageReste)} par mois)`;
  parts.push(
    d.reste >= 0 ? `Il reste ${formatEuro(d.reste)}${average}.` : `Il manque ${formatEuro(-d.reste)}${average}.`,
  );
  return parts.join(" ");
}
