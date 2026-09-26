import type { MonthTotals } from "./api";

/** Most month ticks the Reste sparkline shows before thinning them (it must fit a phone width). */
export const MAX_TREND_TICKS = 8;

/** Compact axis label for a YYYY-MM month: "juil.", "sept." (fr-FR short month). */
export function monthTick(month: string): string {
  const [year, m] = month.split("-").map(Number);
  if (!year || !m) return month;
  return new Intl.DateTimeFormat("fr-FR", { month: "short" }).format(new Date(year, m - 1, 1));
}

/** Months that get an axis tick: all of them up to MAX_TREND_TICKS, else every n-th one plus the
 *  last and the current month so the reader can always place "now". Oldest-first like `history`. */
export function trendTicks(history: MonthTotals[], current: string): string[] {
  const step = Math.ceil(history.length / MAX_TREND_TICKS);
  const last = history.length - 1;
  return history
    .filter((h, i) => i % step === 0 || i === last || h.month === current)
    .map((h) => h.month);
}

/** Months whose point carries its value: the current month when it is in the series; otherwise
 *  (the "Tous les mois" view) the highest and lowest months. */
export function trendValueLabels(history: MonthTotals[], current: string): Set<string> {
  if (history.some((h) => h.month === current)) return new Set([current]);
  if (history.length === 0) return new Set();
  const byReste = [...history].sort((a, b) => a.reste - b.reste);
  return new Set([byReste[0].month, byReste[byReste.length - 1].month]);
}
