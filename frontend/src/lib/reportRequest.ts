/** What a report covers: the months and the content options, carried in the /rapport URL by the
 *  Export page. Pure helpers, no fetching. */
import { frenchMonth } from "./api";
import { reportMonth, reportTitle } from "./report";

export interface ReportOptions {
  /** List the operations of each leaf in « Détail par catégorie ». */
  operations: boolean;
  /** Include the money-flow Sankey page (PDF only). */
  flow: boolean;
}

export interface ReportRequest extends ReportOptions {
  /** Budget months, oldest first. */
  months: string[];
}

export const DEFAULT_OPTIONS: ReportOptions = { operations: true, flow: true };

/** The latest `count` complete budget months, newest first: the newest month of `available` (newest
 *  first, like Dashboard.months_available) is still filling until the next paycheck. */
export function lastCompleteMonths(available: string[], count: number): string[] {
  return available.slice(1, 1 + count);
}

/** The request of a /rapport URL's query string: `months=a,b` (else the older `month=a`), kept to the
 *  existing months, deduplicated, oldest first; none given or none valid means the latest complete
 *  month. `operations=0` / `flow=0` switch an option off. */
export function parseReportRequest(search: string, available: string[]): ReportRequest {
  const params = new URLSearchParams(search);
  const asked = (params.get("months") ?? params.get("month") ?? "").split(",");
  const months = [...new Set(asked.filter((m) => available.includes(m)))].sort();
  const fallback = reportMonth(available, null);
  return {
    months: months.length > 0 ? months : fallback ? [fallback] : [],
    operations: params.get("operations") !== "0",
    flow: params.get("flow") !== "0",
  };
}

/** The query string `parseReportRequest` reads back (only the options that differ from the defaults). */
export function reportSearch(request: ReportRequest): string {
  const params = new URLSearchParams({ months: request.months.join(",") });
  if (!request.operations) params.set("operations", "0");
  if (!request.flow) params.set("flow", "0");
  return params.toString().replace(/%2C/g, ",");
}

/** "Comptes du foyer - 3 mois jusqu'en août 2026", or the single month's title: the PDF's default
 *  file name (the months need not be consecutive, so no "from ... to"). */
export function reportRangeTitle(months: string[]): string {
  if (months.length === 0) return "Comptes du foyer";
  if (months.length === 1) return reportTitle(months[0]);
  return `Comptes du foyer - ${months.length} mois jusqu'en ${frenchMonth(months[months.length - 1])}`;
}
