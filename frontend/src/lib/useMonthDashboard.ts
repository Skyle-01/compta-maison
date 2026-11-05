"use client";

import { useEffect, useState } from "react";
import { useFilters } from "@/components/FiltersProvider";
import { ALL_MONTHS, api, errorMessage, type Dashboard } from "@/lib/api";

/** The dashboard payload of the shared month (`useFilters`), for « Le mois », « Budget » and, with
 *  `allowAll`, Statistiques, where « Tous les mois » gives the payload of every month. */
export function useMonthDashboard({ allowAll = false }: { allowAll?: boolean } = {}): {
  data: Dashboard | null;
  error: string | null;
} {
  const { ready, month, all } = useFilters();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const period = allowAll && all ? ALL_MONTHS : month; // "" on an empty database: the latest, none

  useEffect(() => {
    if (!ready) return;
    let stale = false; // a slower answer for a previous month must not overwrite this one
    api
      .dashboard(period || undefined)
      .then((d) => {
        if (!stale) setData(d);
      })
      .catch((e) => {
        if (!stale) setError(errorMessage(e));
      });
    return () => {
      stale = true;
    };
  }, [ready, period]);

  return { data, error };
}
