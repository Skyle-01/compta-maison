"use client";

import Link from "next/link";
import BudgetSection from "@/components/BudgetSection";
import HelpLink from "@/components/HelpLink";
import MonthNotice from "@/components/MonthNotice";
import PeriodFilter from "@/components/PeriodFilter";
import { hasTargets } from "@/lib/budget";
import { useMonthDashboard } from "@/lib/useMonthDashboard";

export default function BudgetPage() {
  const { data, error } = useMonthDashboard();

  if (error || !data?.month) return <MonthNotice data={data} error={error} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          Budget
          <HelpLink page="/budget" />
        </h1>
        <PeriodFilter />
      </div>
      {!hasTargets(data.budget) ? (
        <p className="text-sm text-zinc-500">
          Aucun objectif pour l&apos;instant. Fixez-en depuis la page{" "}
          <Link href="/categories" className="underline hover:no-underline">
            Catégories
          </Link>
          .
        </p>
      ) : (
        <BudgetSection budget={data.budget} />
      )}
    </div>
  );
}
