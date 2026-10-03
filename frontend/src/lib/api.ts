export interface ImportResult {
  account: string;
  rows_total: number;
  rows_new: number;
  uncategorized_count: number;
  balance_warnings: Record<string, number>;
  /** Bank profile that parsed the file ("default" = the built-in format). */
  profile: string;
  /** File name the statement was copied to in _inputs/ (null: not copied, a rebuild will miss it). */
  archived_as: string | null;
}

/** One _inputs/ statement of a bulk import (error: why it was skipped). */
export interface InputFileResult {
  name: string;
  account: string | null;
  rows_total: number;
  rows_new: number;
  profile: string | null;
  error: string | null;
}

export interface InputsImportResult {
  files: InputFileResult[];
  rows_new: number;
}

export interface Transaction {
  id: number;
  date_operation: string;
  date_valeur: string;
  budget_month: string;
  libelle: string;
  debit: number;
  credit: number;
  account: string;
  account_id: string | null;
  kind: "income" | "expense" | "transfer";
  category_id: number | null;
  category: string | null;
  category_manual: boolean;
  note: string | null;
  rule_id: number | null;
  rule_pattern: string | null;
  /** Shared by the two legs of a transfer (null for a single-legged or non-transfer row). */
  transfer_group_id: number | null;
  /** True when the user decided the transfer status (pair, unpair, single-row transfer). */
  kind_manual: boolean;
}

/** Manual transfer decision on one row: this row alone is a transfer / not a transfer / automatic. */
export type TransferMode = "transfer" | "none" | "auto";

export interface TransferMarkers {
  markers: string[];
  is_default: boolean;
}

export interface Account {
  code: string;
  label: string;
  type: "checking" | "savings";
  sort_order: number;
}

export interface TransactionPage {
  items: Transaction[];
  total: number;
}

export interface Category {
  id: number;
  name: string;
  parent_id: number | null;
  path: string;
  is_root: boolean;
  rule_count: number;
  /** Monthly spending cap in euros (leaves only); null = no target. */
  budget_target: number | null;
}

export interface Rule {
  id: number;
  category_id: number;
  pattern: string;
  priority: number;
  is_income_anchor: boolean;
  description: string | null;
}

/** What the already categorised operations suggest for an uncategorised group. */
export interface CategorySuggestion {
  category_id: number;
  /** Categorised operations backing it. */
  count: number;
  /** The deciding word of the label; null when those operations share the whole label. */
  token: string | null;
}

/** Uncategorised operations with similar labels (the « À classer » page). */
export interface UncategorizedGroup {
  key: string;
  /** Default rule pattern: a substring of every member's label. */
  pattern: string;
  /** Too generic for a rule (bank vocabulary only): the group defaults to a manual assignment. */
  pattern_generic: boolean;
  count: number;
  debit: number;
  credit: number;
  first_date: string;
  last_date: string;
  accounts: string[];
  /** Newest first. */
  transactions: Transaction[];
  suggestion: CategorySuggestion | null;
  /** Possible other legs of the group's operations, likeliest first per operation. */
  transfer_candidates: TransferCandidate[];
}

/** An operation that could be the other leg of a transfer with `transaction_id`. */
export interface TransferCandidate {
  transaction_id: number;
  partner: Transaction;
}

/** Rows an existing rule would lose to a new one. */
export interface RuleLoss {
  rule_id: number;
  pattern: string;
  category_id: number;
  count: number;
}

export interface RulePreview {
  /** Uncategorised operations the new rule would classify. */
  uncategorized: number;
  reclassified: RuleLoss[];
}

export interface CategoryNode {
  id: number | null;
  name: string;
  credit: number;
  debit: number;
  balance: number;
  children: CategoryNode[];
  /** Derived savings leaf (épargne/désépargne). Drill-down is by account_id for an imported
   *  savings account, or by libelle_match (libellé substring) for an external one (kids). */
  synthetic?: boolean;
  account_id?: string | null;
  libelle_match?: string | null;
}

export interface UncategorizedStats {
  count: number;
  credit: number;
  debit: number;
  difference: number;
  balanced: boolean;
}

export interface TransfersSummary {
  count: number;
  total: number;
}

export interface MonthTotals {
  month: string;
  income: number;
  expenses: number;
  epargne: number;
  desepargne: number;
  /** income - expenses - epargne + desepargne; the savings-inclusive leftover. */
  reste: number;
}

/** One targeted leaf: net spending (debits − credits) vs its target × the months shown. */
export interface BudgetLeaf {
  id: number;
  /** Path below the top-level group, e.g. "Sortie / Bar". */
  name: string;
  target: number;
  actual: number;
}

/** A top-level group: the sums of its targeted leaves (none when the group is itself a leaf). */
export interface BudgetGroup extends BudgetLeaf {
  leaves: BudgetLeaf[];
}

export interface BudgetSummary {
  /** Budget months covered; targets are multiplied by it ("Tous les mois"). */
  months: number;
  target: number;
  actual: number;
  /** Expenses outside any targeted category (uncategorised included). */
  untargeted: number;
  /** Overruns first. */
  groups: BudgetGroup[];
}

/** Dashboard `month` value (and `?month=`) for every budget month at once. */
export const ALL_MONTHS = "all";

export interface Dashboard {
  /** The budget month shown, ALL_MONTHS for every month, null when there is no data yet. */
  month: string | null;
  months_available: string[];
  income: number;
  expenses: number;
  /** Net money set aside to savings this month. */
  epargne: number;
  /** Net money pulled from savings this month. */
  desepargne: number;
  /** income - expenses - epargne + desepargne; equals the balance-tree total. */
  reste: number;
  by_category: CategoryNode;
  uncategorized: UncategorizedStats;
  transfers: TransfersSummary;
  history: MonthTotals[];
  budget: BudgetSummary;
}

export class ApiError extends Error {
  constructor(public status: number, public details: string[]) {
    super(details.join("\n"));
  }
}

/** Messages from an error body's `detail`: the routers send strings, FastAPI's own request
 *  validation sends `{loc, msg, ...}` objects (shown by their `msg`). Empty when absent. */
export function errorDetails(detail: unknown): string[] {
  const items = Array.isArray(detail) ? detail : detail ? [detail] : [];
  return items.map((d) =>
    d && typeof d === "object" && "msg" in d ? String(d.msg) : String(d),
  );
}

/** What to show for a caught error: an Error's message (no "Error: " prefix), else the value. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** An error response without a `detail` (the dev proxy answers a bare 500 while the backend is
 *  stopped): its status text would be English. */
export function statusMessage(status: number): string {
  return status >= 500
    ? `Erreur ${status} du serveur — le backend est-il démarré ?`
    : `La requête a échoué (erreur ${status})`;
}

/** fetch rejected: nothing answered (the browser's own message is English). */
export const UNREACHABLE = "Serveur injoignable — l’application est-elle démarrée ?";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, [UNREACHABLE]);
  }
  if (!res.ok) {
    let details = [statusMessage(res.status)];
    try {
      const body = await res.json();
      const fromBody = errorDetails(body.detail);
      if (fromBody.length) details = fromBody;
    } catch {
      // non-JSON error body — keep the status message
    }
    throw new ApiError(res.status, details);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export interface TransactionFilters {
  month?: string;
  account?: string;
  categoryId?: number;
  libelleContains?: string;
  uncategorized?: boolean;
  manual?: boolean;
  manualTransfer?: boolean;
}

function transactionSearch(params: TransactionFilters): URLSearchParams {
  const search = new URLSearchParams();
  if (params.month) search.set("month", params.month);
  if (params.account) search.set("account", params.account);
  if (params.categoryId != null) search.set("category_id", String(params.categoryId));
  if (params.libelleContains) search.set("libelle_contains", params.libelleContains);
  if (params.uncategorized) search.set("uncategorized", "true");
  if (params.manual) search.set("manual", "true");
  if (params.manualTransfer) search.set("manual_transfer", "true");
  return search;
}

/** Download link for the spreadsheet CSV of the transactions matching the list filters (every
 *  row, no pagination; the export ignores the Settings-only manual filters). */
export function transactionsExportUrl(
  params: Omit<TransactionFilters, "manual" | "manualTransfer">,
): string {
  const search = transactionSearch(params).toString();
  return `/api/transactions/export${search ? `?${search}` : ""}`;
}

export const api = {
  uploadCsv(file: File, account: string): Promise<ImportResult> {
    const form = new FormData();
    form.append("file", file);
    form.append("account", account);
    return request("/api/imports", { method: "POST", body: form });
  },

  importInputs(): Promise<InputsImportResult> {
    return request("/api/imports/inputs", { method: "POST" });
  },

  listTransactions(params: TransactionFilters & { limit?: number; offset?: number }): Promise<TransactionPage> {
    const search = transactionSearch(params);
    if (params.limit) search.set("limit", String(params.limit));
    if (params.offset) search.set("offset", String(params.offset));
    return request(`/api/transactions?${search}`);
  },

  /** Partial update of a transaction: pass category_id and/or note. Only the keys present in
   *  `patch` are applied server-side, so { note } leaves the category untouched and vice-versa. */
  updateTransaction(
    id: number,
    patch: { category_id?: number | null; note?: string | null },
  ): Promise<Transaction> {
    return request(`/api/transactions/${id}`, json("PATCH", patch));
  },

  /** Set (or clear, with null) the manual category and note of several operations at once. */
  updateTransactions(ids: number[], categoryId: number | null, note: string | null): Promise<Transaction[]> {
    return request("/api/transactions", json("PATCH", { ids, category_id: categoryId, note }));
  },

  uncategorizedGroups(month?: string): Promise<UncategorizedGroup[]> {
    return request(`/api/transactions/uncategorized-groups${month ? `?month=${month}` : ""}`);
  },

  /** Number of uncategorised non-transfer operations (the nav's « À classer (N) »). */
  async uncategorizedCount(): Promise<number> {
    return (await api.listTransactions({ uncategorized: true, limit: 1 })).total;
  },

  listAccounts: (): Promise<Account[]> => request("/api/accounts"),

  listCategories: (): Promise<Category[]> => request("/api/categories"),
  createCategory: (c: { name: string; parent_id: number | null }): Promise<Category> =>
    request("/api/categories", json("POST", c)),
  updateCategory: (id: number, c: { name: string; parent_id: number | null }): Promise<Category> =>
    request(`/api/categories/${id}`, json("PUT", c)),
  /** Set (euros, > 0) or clear (null) a leaf's monthly budget target. */
  setCategoryTarget: (id: number, budgetTarget: number | null): Promise<Category> =>
    request(`/api/categories/${id}/target`, json("PUT", { budget_target: budgetTarget })),
  deleteCategory: (id: number): Promise<void> =>
    request(`/api/categories/${id}`, { method: "DELETE" }),

  listRules: (): Promise<Rule[]> => request("/api/rules"),
  /** What a rule about to be created would classify, and the rows existing rules would lose. */
  previewRule(pattern: string, priority: number, categoryId: number | null): Promise<RulePreview> {
    const search = new URLSearchParams({ pattern, priority: String(priority) });
    if (categoryId != null) search.set("category_id", String(categoryId));
    return request(`/api/rules/preview?${search}`);
  },
  pairTransfer(ids: [number, number]): Promise<Transaction[]> {
    return request("/api/transactions/transfer-pair", json("POST", { transaction_ids: ids }));
  },

  setTransferMode(id: number, mode: TransferMode): Promise<Transaction[]> {
    return request(`/api/transactions/${id}/transfer`, json("PUT", { mode }));
  },

  getTransferMarkers: (): Promise<TransferMarkers> => request("/api/transfer-markers"),
  setTransferMarkers: (markers: string[]): Promise<TransferMarkers> =>
    request("/api/transfer-markers", json("PUT", { markers })),

  createRule: (r: Omit<Rule, "id">): Promise<Rule> => request("/api/rules", json("POST", r)),
  updateRule: (id: number, r: Omit<Rule, "id">): Promise<Rule> =>
    request(`/api/rules/${id}`, json("PUT", r)),
  deleteRule: (id: number): Promise<void> => request(`/api/rules/${id}`, { method: "DELETE" }),

  dashboard(month?: string): Promise<Dashboard> {
    return request(`/api/dashboard${month ? `?month=${month}` : ""}`);
  },
};

/** Window event telling the nav to refresh its « À classer » count after a categorisation. */
export const UNCATEGORIZED_CHANGED = "compta:uncategorized-changed";

export function notifyUncategorizedChanged(): void {
  window.dispatchEvent(new Event(UNCATEGORIZED_CHANGED));
}

export function formatEuro(amount: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(amount);
}

/** A transaction's amount as one signed number: the credit, or minus the debit. */
export function signedAmount(tx: Pick<Transaction, "credit" | "debit">): number {
  return tx.credit > 0 ? tx.credit : -tx.debit;
}

/** "2026-09-21" -> "21/09/2026" (French numeric date). Falls back to the raw value. */
export function frenchDate(date: string): string {
  const [year, m, d] = date.split("-").map(Number);
  if (!year || !m || !d) return date;
  return new Intl.DateTimeFormat("fr-FR").format(new Date(year, m - 1, d));
}

/** "2026-06" -> "juin 2026" (French long month + year). Falls back to the raw value. */
export function frenchMonth(month: string): string {
  const [year, m] = month.split("-").map(Number);
  if (!year || !m) return month;
  return new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(
    new Date(year, m - 1, 1),
  );
}

/** "2026-06" -> "juin" (French long month, no year) — for compact deltas. */
export function frenchMonthShort(month: string): string {
  const [year, m] = month.split("-").map(Number);
  if (!year || !m) return month;
  return new Intl.DateTimeFormat("fr-FR", { month: "long" }).format(new Date(year, m - 1, 1));
}

/** Full category path for display, e.g. "variable / sortie / bar". */
export function shortPath(category: Category): string {
  return category.path || category.name;
}

/**
 * Derive a rule pattern from a bank label by stripping the embedded date prefix,
 * so the pattern matches the same merchant across dates. Only the known dated
 * prefixes are stripped; otherwise the label is returned unchanged.
 * e.g. "CARTE 26/05 BOULANGERIE DU PORT" -> "BOULANGERIE DU PORT".
 */
export function suggestPattern(libelle: string): string {
  return libelle
    .replace(/^CARTE \d{2}\/\d{2} /, "")
    .replace(/^RET DAB \d{2}\/\d{2}\/\d{2} /, "")
    .trim();
}
