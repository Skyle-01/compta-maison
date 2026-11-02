"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AveragesSection from "@/components/AveragesSection";
import HelpLink from "@/components/HelpLink";
import { ALL_MONTHS, api, errorMessage, frenchMonth, type Dashboard } from "@/lib/api";

export default function StatisticsPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const request = useRef(0); // a slower answer for a previous month must not overwrite this one

  const load = useCallback((month?: string) => {
    const id = ++request.current;
    api
      .dashboard(month)
      .then((d) => {
        if (id === request.current) setData(d);
      })
      .catch((e) => {
        if (id === request.current) setError(errorMessage(e));
      });
  }, []);

  useEffect(() => load(), [load]);

  if (error) return <p className="text-red-700">{error}</p>;
  if (!data) return <p className="text-zinc-500">Chargement…</p>;

  if (!data.month) {
    return (
      <p className="text-zinc-500">
        Aucune transaction pour l&apos;instant : commencez par importer un relevé bancaire depuis la page
        Importer.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          Statistiques
          <HelpLink page="/statistiques" />
        </h1>
        <select
          className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm"
          value={data.month}
          onChange={(e) => load(e.target.value)}
          aria-label="Mois affiché"
        >
          <option value={ALL_MONTHS}>Tous les mois</option>
          {data.months_available.map((m) => (
            <option key={m} value={m}>
              {frenchMonth(m)}
              {data.months_partial.includes(m) ? " (partiel)" : ""}
            </option>
          ))}
        </select>
      </div>

      <AveragesSection data={data} />
    </div>
  );
}
