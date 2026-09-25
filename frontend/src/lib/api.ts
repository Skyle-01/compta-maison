export interface ImportResult {
  import_id: number;
  account: string;
  rows_total: number;
  rows_new: number;
  uncategorized_count: number;
  balance_warnings: Record<string, number>;
  /** Bank profile that parsed the file ("default" = the built-in format). */
  profile: string;
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
  include_in_full_view: boolean;
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
}

export interface Rule {
  id: number;
  category_id: number;
  pattern: string;
  priority: number;
  is_income_anchor: boolean;
  description: string | null;
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
  /** Operating net: income - expenses. */
  net: number;
  epargne: number;
  desepargne: number;
  /** income - expenses - epargne + desepargne; the savings-inclusive leftover. */
  reste: number;
}

export interface Dashboard {
  month: string | null;
  months_available: string[];
  income: number;
  expenses: number;
  /** Operating net: income - expenses (savings not deducted). */
  net: number;
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
}

export class ApiError extends Error {
  constructor(public status: number, public details: string[]) {
    super(details.join("\n"));
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let details = [res.statusText];
    try {
      const body = await res.json();
      if (Array.isArray(body.detail)) details = body.detail.map(String);
      else if (body.detail) details = [String(body.detail)];
    } catch {
      // non-JSON error body — keep the status text
    }
    throw new ApiError(res.status, details);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export const api = {
  uploadCsv(file: File, account: string): Promise<ImportResult> {
    const form = new FormData();
    form.append("file", file);
    form.append("account", account);
    return request("/api/imports", { method: "POST", body: form });
  },

  listTransactions(params: {
    month?: string;
    account?: string;
    categoryId?: number;
    libelleContains?: string;
    uncategorized?: boolean;
    manual?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<TransactionPage> {
    const search = new URLSearchParams();
    if (params.month) search.set("month", params.month);
    if (params.account) search.set("account", params.account);
    if (params.categoryId != null) search.set("category_id", String(params.categoryId));
    if (params.libelleContains) search.set("libelle_contains", params.libelleContains);
    if (params.uncategorized) search.set("uncategorized", "true");
    if (params.manual) search.set("manual", "true");
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

  listAccounts: (): Promise<Account[]> => request("/api/accounts"),

  listCategories: (): Promise<Category[]> => request("/api/categories"),
  createCategory: (c: { name: string; parent_id: number | null }): Promise<Category> =>
    request("/api/categories", json("POST", c)),
  updateCategory: (id: number, c: { name: string; parent_id: number | null }): Promise<Category> =>
    request(`/api/categories/${id}`, json("PUT", c)),
  deleteCategory: (id: number): Promise<void> =>
    request(`/api/categories/${id}`, { method: "DELETE" }),

  listRules: (): Promise<Rule[]> => request("/api/rules"),
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

export function formatEuro(amount: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(amount);
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
