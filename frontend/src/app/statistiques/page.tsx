"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AveragesSection from "@/components/AveragesSection";
import HelpLink from "@/components/HelpLink";
import MonthSelect from "@/components/MonthSelect";
import { api, errorMessage, type Dashboard } from "@/lib/api";

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
        <MonthSelect
          value={data.month}
          available={data.months_available}
          partial={data.months_partial}
          onChange={load}
          withAll
        />
      </div>

      <AveragesSection data={data} />
    </div>
  );
}
