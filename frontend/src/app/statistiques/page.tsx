"use client";

import AveragesSection from "@/components/AveragesSection";
import HelpLink from "@/components/HelpLink";
import PeriodFilter from "@/components/PeriodFilter";
import { useMonthDashboard } from "@/lib/useMonthDashboard";

export default function StatisticsPage() {
  const { data, error } = useMonthDashboard({ allowAll: true });

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
        <PeriodFilter withAll />
      </div>

      <AveragesSection data={data} />
    </div>
  );
}
