"use client";

import { useEffect, useState } from "react";
import { api, errorMessage, formatEuro, type CategoryAverages } from "@/lib/api";
import { highlight } from "@/components/tableStyles";
import { breakdown, cell, REPORT_AVERAGE, type BreakdownLine } from "@/lib/report";

/** One line: name with its average and target under it, the month's amount, and (categories only) a
 *  neutral bar scaled to the largest category. */
function Line({ line, max, bar }: { line: BreakdownLine; max: number; bar: boolean }) {
  const detail = [
    line.average === null ? null : `moyenne ${formatEuro(line.average)}`,
    line.target === null ? null : `objectif ${formatEuro(line.target)}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const width = max > 0 ? Math.max(0, Math.min(100, (line.month / max) * 100)) : 0;
  return (
    <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 py-1.5 text-sm">
      <div className="min-w-0">
        <div className={bar ? "font-medium" : "text-zinc-700"}>{line.name}</div>
        {detail && <div className="text-xs text-zinc-500">{detail}</div>}
      </div>
      <div className={`tabular-nums ${highlight(line.tone)}`}>{cell(line.month)}</div>
      {bar && (
        <div className="col-span-2 mt-1 h-2 rounded-full bg-zinc-100">
          <div className="h-2 rounded-full bg-zinc-600" style={{ width: `${width}%` }} />
        </div>
      )}
    </div>
  );
}

/** « Où part l'argent »: the month's spending per top-level category, largest first, each unfolding
 *  to its sub-categories (the same lines as the reports, `report.ts::breakdown`). */
export default function SpendingBreakdown({ month }: { month: string }) {
  const [loaded, setLoaded] = useState<{ month: string; avg: CategoryAverages } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false; // a slower answer for a previous month must not overwrite this one
    api
      .averages(REPORT_AVERAGE, month)
      .then((avg) => {
        if (stale) return;
        setLoaded({ month, avg });
        setError(null);
      })
      .catch((e) => {
        if (!stale) setError(errorMessage(e));
      });
    return () => {
      stale = true;
    };
  }, [month]);

  const avg = loaded?.month === month ? loaded.avg : null;
  let body;
  if (error) body = <p className="text-sm text-red-700">{error}</p>;
  else if (!avg) body = <p className="text-sm text-zinc-500">Chargement…</p>;
  else {
    const groups = breakdown(avg, "expenses");
    const max = Math.max(0, ...groups.map((g) => g.month));
    // The lines are net of refunds, the Dépenses card is gross: say so when they differ.
    const refunds = Math.abs(avg.offset.month_value ?? 0) >= 0.005;
    body =
      groups.length === 0 ? (
        <p className="text-sm text-zinc-500">Aucune dépense classée ce mois-ci.</p>
      ) : (
        <>
          <div>
            {groups.map((g) =>
              g.leaves.length === 0 ? (
                <div key={g.id} className="border-b border-zinc-100">
                  <Line line={g} max={max} bar />
                </div>
              ) : (
                <details key={g.id} className="group border-b border-zinc-100">
                  <summary className="cursor-pointer list-none">
                    <span className="flex items-start gap-1">
                      <span
                        aria-hidden
                        className="mt-1.5 text-xs text-zinc-500 transition-transform group-open:rotate-90"
                      >
                        ▸
                      </span>
                      <span className="min-w-0 flex-1">
                        <Line line={g} max={max} bar />
                      </span>
                    </span>
                  </summary>
                  <div className="mb-1 ml-4 border-l border-zinc-100 pl-3">
                    {g.leaves.map((l) => (
                      <Line key={l.id} line={l} max={max} bar={false} />
                    ))}
                  </div>
                </details>
              ),
            )}
          </div>
          {refunds && (
            <p className="mt-2 text-xs text-zinc-500">
              Chaque catégorie est nette de ses remboursements : le total peut être plus bas que la carte
              Dépenses.
            </p>
          )}
        </>
      );
  }

  return (
    <section>
      <h2 className="mb-3 font-semibold">Où part l&apos;argent</h2>
      {body}
    </section>
  );
}
