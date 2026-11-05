"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage, type Dashboard } from "@/lib/api";

/** The dashboard payload of the month in the URL (`?month=YYYY-MM`, none for the latest month), shared
 *  by « Le mois » and « Budget ». `choose` switches month with a pushState so Back returns to the
 *  previous one and a reload keeps it; an unknown month (a stale link, the old `?month=all`) falls
 *  back to the latest. */
export function useMonthDashboard(): {
  data: Dashboard | null;
  error: string | null;
  choose: (month: string) => void;
} {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0); // a slower answer for a previous month must not overwrite this one

  const load = useCallback((month?: string) => {
    const id = ++request.current;
    api
      .dashboard(month)
      .then((d) => {
        if (!month || d.months_available.includes(month)) return d;
        window.history.replaceState(null, "", window.location.pathname);
        return api.dashboard();
      })
      .then((d) => {
        if (id === request.current) setData(d);
      })
      .catch((e) => {
        if (id === request.current) setError(errorMessage(e));
      });
  }, []);

  useEffect(() => {
    const fromUrl = () => load(new URLSearchParams(window.location.search).get("month") ?? undefined);
    fromUrl();
    window.addEventListener("popstate", fromUrl);
    return () => window.removeEventListener("popstate", fromUrl);
  }, [load]);

  const latest = data?.months_available[0];
  const choose = useCallback(
    (month: string) => {
      window.history.pushState(null, "", month === latest ? window.location.pathname : `?month=${month}`);
      load(month);
    },
    [latest, load],
  );

  return { data, error, choose };
}
