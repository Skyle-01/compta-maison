/** The month and account filters shared by the pages (see `components/FiltersProvider.tsx`): pure
 *  helpers for the effective month, the browser storage and the `?month=` / `?account=` of a deep link. */

/** `month` is the last month the user picked (null = none yet, so the latest); `all` = no month
 *  filter, kept apart so that unticking « Tous les mois » brings the last picked month back;
 *  `account` is a canonical account code, null = every account. */
export type Filters = { month: string | null; all: boolean; account: string | null };

export const DEFAULT_FILTERS: Filters = { month: null, all: false, account: null };

const STORAGE_KEY = "compta:filters";
const URL_KEYS = ["month", "account"];

/** The month to show: the picked one if it still exists (a rebuild can drop it), else the latest
 *  (`available` is newest first), "" on an empty database. */
export function effectiveMonth(picked: string | null, available: string[]): string {
  return picked !== null && available.includes(picked) ? picked : (available[0] ?? "");
}

/** The month to send to the API: none when every month is wanted (or on an empty database). */
export function monthParam(month: string, all: boolean): string | undefined {
  return all || !month ? undefined : month;
}

/** Filters from what the storage holds; anything unreadable gives the defaults. */
export function parseStored(raw: string | null): Filters {
  try {
    const value = JSON.parse(raw ?? "null");
    return {
      month: typeof value?.month === "string" ? value.month : null,
      all: value?.all === true,
      account: typeof value?.account === "string" ? value.account : null,
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

/** `filters` with what a deep link carries: `?month=` picks that month (and ends « Tous les
 *  mois »), `?account=` that account. `search` is a query string, with or without the `?`. */
export function applyUrl(filters: Filters, search: string): Filters {
  const params = new URLSearchParams(search);
  const month = params.get("month");
  const account = params.get("account");
  return {
    month: month || filters.month,
    all: month ? false : filters.all,
    account: account || filters.account,
  };
}

/** `search` without the filter keys, once the user changes a filter: a stale link must not win
 *  over the choice at the next reload. Other keys stay; the result keeps its leading `?`, if any. */
export function withoutUrlFilters(search: string): string {
  const params = new URLSearchParams(search);
  URL_KEYS.forEach((key) => params.delete(key));
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

// The browser storage can be missing or throw (private window, blocked site data): the filters
// then simply don't persist.

export function loadFilters(): Filters {
  try {
    return parseStored(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_FILTERS;
  }
}

export function saveFilters(filters: Filters): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // not persisted
  }
}
