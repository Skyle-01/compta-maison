"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import {
  applyUrl,
  effectiveMonth,
  type Filters,
  loadFilters,
  monthParam,
  saveFilters,
  withoutUrlFilters,
} from "@/lib/periodFilter";

type FiltersValue = {
  /** False until the month list is loaded: pages wait before fetching. */
  ready: boolean;
  months: string[];
  partial: string[];
  /** The month shown, always an existing one ("" on an empty database). */
  month: string;
  /** « Tous les mois »: honoured by Transactions, « À classer » and Statistiques only. */
  all: boolean;
  /** `month` to send to the API on those pages: none when `all`. */
  monthFilter: string | undefined;
  account: string | null;
  /** Picking a month also ends « Tous les mois ». */
  setMonth: (month: string) => void;
  setAll: (all: boolean) => void;
  setAccount: (account: string | null) => void;
};

const FiltersContext = createContext<FiltersValue | null>(null);

/** The month list, newest first; `loaded` is false until the first answer. */
type Available = { months: string[]; partial: string[]; loaded: boolean };
const NO_MONTHS: Available = { months: [], partial: [], loaded: false };

export function useFilters(): FiltersValue {
  const value = useContext(FiltersContext);
  if (!value) throw new Error("useFilters needs a FiltersProvider");
  return value;
}

/** The one source of the month and account filters, kept across pages (the layout stays mounted),
 *  saved in the browser, and overridden by `?month=` / `?account=` when a link carries them. Loads
 *  the month list on every page change, so a month a new import or rule created shows up. */
export function FiltersProvider({ children }: { children: React.ReactNode }) {
  const search = useSearchParams().toString();
  const pathname = usePathname();
  // The saved filters are read at the first render. Nothing shown depends on them before `ready`
  // (the month list is not loaded yet), so a server render with the defaults can't mismatch.
  const [filters, setFilters] = useState<Filters>(loadFilters);
  const [appliedSearch, setAppliedSearch] = useState<string | null>(null);
  const [available, setAvailable] = useState(NO_MONTHS);

  // Apply a link's filters while rendering (not in an effect), so the page it opens never fetches
  // with the previous filters first.
  if (search !== appliedSearch) {
    setAppliedSearch(search);
    setFilters(applyUrl(filters, search));
  }

  useEffect(() => saveFilters(filters), [filters]);

  useEffect(() => {
    api
      .dashboard()
      .then((d) => setAvailable({ months: d.months_available, partial: d.months_partial, loaded: true }))
      .catch(() => setAvailable({ ...NO_MONTHS, loaded: true })); // the pages report the failure themselves
  }, [pathname]);

  const change = useCallback((patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    const rest = withoutUrlFilters(window.location.search);
    if (rest !== window.location.search) {
      window.history.replaceState(null, "", `${window.location.pathname}${rest}${window.location.hash}`);
    }
  }, []);

  const month = effectiveMonth(filters.month, available.months);
  const value = useMemo<FiltersValue>(
    () => ({
      ready: available.loaded,
      months: available.months,
      partial: available.partial,
      month,
      all: filters.all,
      monthFilter: monthParam(month, filters.all),
      account: filters.account,
      setMonth: (m) => change({ month: m, all: false }),
      setAll: (all) => change({ all }),
      setAccount: (account) => change({ account }),
    }),
    [available, month, filters.all, filters.account, change],
  );

  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>;
}
