/** Everything the report of one month needs from the API: shared by the printable PDF and the
 *  mobile HTML export, so both show the same figures. */
import { api, type CategoryAverages, type CategoryNode, type Dashboard, listLeafOperations, type Transaction } from "./api";
import { REPORT_AVERAGE, statementMonths, treeLeaves } from "./report";

export interface ReportData {
  data: Dashboard;
  /** The averages payload of each statement month, oldest first; the last one is the report month. */
  columns: CategoryAverages[];
  /** The operations of each leaf of `data.by_category` (see treeLeaves). */
  operations: Map<CategoryNode, Transaction[]>;
}

/** Loads one month's report. `available` is Dashboard.months_available (newest first); without
 *  `withOperations` the leaves' operations are not fetched (the map stays empty). */
export async function loadReport(available: string[], month: string, withOperations = true): Promise<ReportData> {
  const [data, columns] = await Promise.all([
    api.dashboard(month),
    Promise.all(statementMonths(available, month).map((m) => api.averages(REPORT_AVERAGE, m))),
  ]);
  const operations = withOperations
    ? await listLeafOperations(treeLeaves(data.by_category), month)
    : new Map<CategoryNode, Transaction[]>();
  return { data, columns, operations };
}
