/** Pure helpers for the dashboard « Moyennes mensuelles » section. */
import { type AverageNode, type AveragePeriod, type CategoryAverages, frenchMonth } from "./api";

export const AVERAGE_PERIODS: { value: AveragePeriod; label: string }[] = [
  { value: "3", label: "3 derniers mois" },
  { value: "6", label: "6 derniers mois" },
  { value: "12", label: "12 derniers mois" },
  { value: "all", label: "Tout l’historique" },
];

export type GapTone = "good" | "bad" | "flat";

/** The displayed month minus the average, rounded to the cent; null when there is no month to
 *  compare with (« Tous les mois »). */
export function averageGap(month: number | null, average: number): number | null {
  return month === null ? null : Math.round((month - average) * 100) / 100;
}

/** Colour of a gap: whether being above the average is good (income, savings) or bad (spending). */
export function gapTone(gap: number, goodIsUp: boolean): GapTone {
  if (Math.abs(gap) < 0.005) return "flat";
  return gap > 0 === goodIsUp ? "good" : "bad";
}

/** Nodes worth a row: some money over the period or in the displayed month, or a target. */
export function visibleAverageNodes(nodes: AverageNode[]): AverageNode[] {
  return nodes
    .map((n) => ({ ...n, children: visibleAverageNodes(n.children) }))
    .filter(
      (n) =>
        n.target !== null ||
        n.children.length > 0 ||
        [n.expenses, n.income, n.month_expenses ?? 0, n.month_income ?? 0].some((v) => Math.abs(v) >= 0.005),
    );
}

/** What the averages cover, e.g. "sur 6 mois (mars 2026 – août 2026)"; flags a period shorter than
 *  asked ("sur 4 mois seulement"); null when no budget month is complete yet. */
export function periodSummary(avg: CategoryAverages, period: AveragePeriod): string | null {
  if (avg.months === 0 || !avg.first_month || !avg.last_month) return null;
  const short = period !== "all" && avg.months < Number(period) ? " seulement" : "";
  const range =
    avg.first_month === avg.last_month
      ? frenchMonth(avg.first_month)
      : `${frenchMonth(avg.first_month)} – ${frenchMonth(avg.last_month)}`;
  return `sur ${avg.months} mois${short} (${range})`;
}

/** A row's signed average (income − spending: a spending category reads negative), rounded to the
 *  cent. Netting the two sides drops the compensations: the rows add up to Revenus − Dépenses. */
export function averageNet(expenses: number, income: number): number {
  return Math.round((income - expenses) * 100) / 100;
}

/** The displayed month's signed value of a row; null when there is no month (« Tous les mois »). */
export function monthNet(monthExpenses: number | null, monthIncome: number | null): number | null {
  if (monthExpenses === null && monthIncome === null) return null;
  return averageNet(monthExpenses ?? 0, monthIncome ?? 0);
}
