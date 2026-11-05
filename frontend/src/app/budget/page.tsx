"use client";

import Link from "next/link";
import BudgetSection from "@/components/BudgetSection";
import HelpLink from "@/components/HelpLink";
import MonthSelect from "@/components/MonthSelect";
import { hasTargets } from "@/lib/budget";
import { useMonthDashboard } from "@/lib/useMonthDashboard";

export default function BudgetPage() {
  const { data, error, choose } = useMonthDashboard();

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

  const latest = data.months_available[0];
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          Budget
          <HelpLink page="/budget" />
        </h1>
        <div className="flex items-center gap-3">
          {data.month !== latest && (
            <button type="button" onClick={() => choose(latest)} className="btn-secondary">
              Dernier mois
            </button>
          )}
          <MonthSelect
            value={data.month}
            available={data.months_available}
            partial={data.months_partial}
            onChange={choose}
          />
        </div>
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
