/** Everything the report of one month needs from the API: shared by the printable PDF and the
 *  mobile HTML export, so both show the same figures. */
import { api, type CategoryAverages, type CategoryNode, type Dashboard, listLeafOperations, type Transaction } from "./api";
import { REPORT_AVERAGE, treeLeaves } from "./report";

export interface ReportData {
  data: Dashboard;
  /** The averages payload of the report month: the average window is the same whatever the month,
   *  only its `month_*` values belong to the month. */
  averages: CategoryAverages;
  /** The operations of each leaf of `data.by_category` (see treeLeaves). */
  operations: Map<CategoryNode, Transaction[]>;
}

/** Loads one month's report; without `withOperations` the leaves' operations are not fetched (the
 *  map stays empty). */
export async function loadReport(month: string, withOperations = true): Promise<ReportData> {
  const [data, averages] = await Promise.all([api.dashboard(month), api.averages(REPORT_AVERAGE, month)]);
  const operations = withOperations
    ? await listLeafOperations(treeLeaves(data.by_category), month)
    : new Map<CategoryNode, Transaction[]>();
  return { data, averages, operations };
}
