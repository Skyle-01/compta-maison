import type { ReportCard } from "@/lib/report";

export const NUM = "px-1.5 py-1 text-right tabular-nums whitespace-nowrap";
/** The report month's column, a shade darker than the striped rows so it shows on them too. */
export const CURRENT_COLUMN = "bg-zinc-100/70";
/** A notable amount (see lib/report.ts::notable), the same in every table of the report. */
export const HIGHLIGHT = { good: "font-semibold text-green-700", bad: "font-semibold text-red-700" };
export const highlight = (tone: "good" | "bad" | null) => (tone ? HIGHLIGHT[tone] : "");
/** The text colour of a card's amount (lib/report.ts::reportCards), on every screen showing the four cards. */
export const CARD_TEXT: Record<ReportCard["tone"], string> = {
  good: "text-green-700",
  bad: "text-red-700",
  save: "text-violet-700",
  warn: "text-amber-700",
};
