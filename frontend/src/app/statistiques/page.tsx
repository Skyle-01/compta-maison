"use client";

import AveragesSection from "@/components/AveragesSection";
import HelpLink from "@/components/HelpLink";
import MonthNotice from "@/components/MonthNotice";
import PeriodFilter from "@/components/PeriodFilter";
import StatementSection from "@/components/StatementSection";
import { useMonthDashboard } from "@/lib/useMonthDashboard";

export default function StatisticsPage() {
  const { data, error } = useMonthDashboard({ allowAll: true });

  if (error || !data?.month) return <MonthNotice data={data} error={error} />;

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
      <StatementSection data={data} />
    </div>
  );
}
