/** Pure helpers for the printable report (/rapport). */
import {
  ALL_MONTHS,
  type AverageNode,
  type AveragePeriod,
  type BudgetSummary,
  type CategoryAverages,
  type Dashboard,
  type MonthTotals,
  type UncategorizedStats,
  formatEuro,
  frenchMonth,
} from "./api";

/** Budget months in the « Les derniers mois » statement. */
export const STATEMENT_MONTHS = 6;
/** The period every report average covers (complete budget months). */
export const REPORT_AVERAGE: AveragePeriod = "12";
/** A month's spending rise worth flagging: at least this many euros and this share of the average. */
export const RISE_MIN = 20;
export const RISE_RATIO = 0.2;
export const MAX_RISES = 3;

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
  /** An explanatory line (Non classé, compensations) rather than a category. */
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

/** The « Les derniers mois » statement: one column per budget month (`columns`, oldest first, each
 *  the averages payload for that month, all over the same window) plus the average month.
 *  Income is listed by source (income-side leaves, as the Sankey does), spending by top-level
 *  category, savings by account; Non classé and the compensations close each side so a column adds
 *  up to that month's cards. Totals come from `history` (the cards' own figures). */
export function buildStatement(columns: CategoryAverages[], history: MonthTotals[]): Statement {
  const months = columns.map((c) => c.month ?? "");
  const hasAverage = columns.length > 0 && columns[columns.length - 1].months > 0;
  const averageTotals = hasAverage ? columns[columns.length - 1].totals : null;
  const byMonth = new Map(history.map((h) => [h.month, h]));
  const total = (key: string, label: string, pick: (t: Totals) => number): StatementRow => ({
    key,
    label,
    values: months.map((m) => pick(byMonth.get(m) ?? NO_TOTALS)),
    average: averageTotals ? pick(averageTotals) : null,
  });
  const muted = (rows: StatementRow[]) => rows.map((r) => ({ ...r, muted: true }));
  const compensations = collect(
    columns,
    (a) => [
      {
        key: "offset",
        label: "Remboursements et compensations",
        value: a.offset.month_value ?? 0,
        average: a.offset.value,
      },
    ],
    hasAverage,
  );

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
      ...muted(compensations),
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
      ...muted(compensations),
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

/** The month's spending per top-level category and its leaves (named by their path below the
 *  group), largest first, with the average month and the target; a category with neither spending
 *  this month nor on average is left out. */
export function expenseBreakdown(avg: CategoryAverages): BreakdownGroup[] {
  const hasAverage = avg.months > 0;
  const line = (n: AverageNode, name: string): BreakdownLine => ({
    id: n.id,
    name,
    month: n.month_expenses ?? 0,
    average: hasAverage ? n.expenses : null,
    target: n.target,
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

/** A group's leaves named « Group / Leaf », or the group itself when it has none (a top-level leaf). */
function groupLeaves<T extends { name: string }>(groups: (T & { leaves: T[] })[]): T[] {
  return groups.flatMap((g) =>
    g.leaves.length === 0 ? [g] : g.leaves.map((l) => ({ ...l, name: `${g.name} / ${l.name}` })),
  );
}

/** What deserves a reader's attention this month, in plain French: targets overrun, the largest
 *  spending rises against the average (at least RISE_MIN € and RISE_RATIO of it, MAX_RISES at
 *  most), and the operations still uncategorised. */
export function attentionPoints(
  breakdown: BreakdownGroup[],
  budget: BudgetSummary,
  uncategorized: UncategorizedStats,
): string[] {
  const points: string[] = [];
  for (const t of groupLeaves(budget.groups)) {
    const over = t.actual - t.target;
    if (over >= EPS) {
      points.push(
        `Objectif dépassé, ${t.name} : ${formatEuro(t.actual)} pour ${formatEuro(t.target)} prévus ` +
          `(+${formatEuro(over)}).`,
      );
    }
  }
  const rises = groupLeaves(breakdown)
    .filter((l) => l.average !== null)
    .map((l) => ({ ...l, average: l.average ?? 0, rise: l.month - (l.average ?? 0) }))
    .filter((l) => l.rise >= RISE_MIN && l.rise >= RISE_RATIO * l.average)
    .sort((a, b) => b.rise - a.rise)
    .slice(0, MAX_RISES);
  for (const l of rises) {
    points.push(
      `En hausse, ${l.name} : ${formatEuro(l.month)} contre ${formatEuro(l.average)} en moyenne ` +
        `(+${formatEuro(l.rise)}).`,
    );
  }
  if (uncategorized.count > 0) {
    const s = uncategorized.count > 1 ? "s" : "";
    points.push(
      `${uncategorized.count} opération${s} pas encore classée${s} (${formatEuro(uncategorized.debit)} de ` +
        `dépenses, ${formatEuro(uncategorized.credit)} de revenus) : comptée${s} sous « Non classé ».`,
    );
  }
  return points;
}

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
