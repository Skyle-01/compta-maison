"use client";

import { useEffect, useState } from "react";
import { ALL_MONTHS, api, type CategoryAverages, type Dashboard, errorMessage } from "@/lib/api";
import StatementTable from "@/components/StatementTable";
import { REPORT_AVERAGE, statementMonths } from "@/lib/report";

/** « Les derniers mois »: the budget months side by side, the displayed month last (shaded, its
 *  notable amounts in bold); with « Tous les mois » the latest months, with no reference month.
 *  Own fetch, one averages request per column. */
export default function StatementSection({ data }: { data: Dashboard }) {
  const reference = data.month !== null && data.month !== ALL_MONTHS;
  const last = reference ? (data.month as string) : data.months_available[0];
  const months = statementMonths(data.months_available, last);
  const key = months.join(",");
  const [loaded, setLoaded] = useState<{ key: string; columns: CategoryAverages[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!key) return;
    let stale = false; // a slower answer for a previous month must not overwrite this one
    Promise.all(key.split(",").map((m) => api.averages(REPORT_AVERAGE, m)))
      .then((columns) => {
        if (stale) return;
        setLoaded({ key, columns });
        setError(null);
      })
      .catch((e) => {
        if (!stale) setError(errorMessage(e));
      });
    return () => {
      stale = true;
    };
  }, [key]);

  return (
    <section className="space-y-3">
      <h2 className="font-semibold">Les derniers mois</h2>
      {error && <p className="text-red-700">{error}</p>}
      {loaded?.key === key ? (
        <>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white p-4">
            <StatementTable columns={loaded.columns} history={data.history} reference={reference} />
          </div>
          <p className="text-xs text-zinc-500">
            Les revenus et les dépenses de ce tableau sont nets des remboursements : ils peuvent être un peu
            plus bas que ceux des moyennes mensuelles ci-dessus. Le reste est le même. La colonne « Moyenne »
            porte toujours sur les {REPORT_AVERAGE} derniers mois clos.
          </p>
        </>
      ) : (
        !error && <p className="text-zinc-500">Chargement…</p>
      )}
    </section>
  );
}
