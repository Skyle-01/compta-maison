import { formatEuro } from "@/lib/api";

export const NUM = "px-1.5 py-1 text-right tabular-nums whitespace-nowrap";
export const cell = (value: number | null) =>
  value === null ? "" : Math.abs(value) < 0.005 ? "–" : formatEuro(value);
/** The report month's column, a shade darker than the striped rows so it shows on them too. */
export const CURRENT_COLUMN = "bg-zinc-100/70";
/** A notable amount (see lib/report.ts::notable), the same in every table of the report. */
export const HIGHLIGHT = { good: "font-semibold text-green-700", bad: "font-semibold text-red-700" };
export const highlight = (tone: "good" | "bad" | null) => (tone ? HIGHLIGHT[tone] : "");
