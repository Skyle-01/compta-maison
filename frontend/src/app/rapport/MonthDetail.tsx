import BudgetSection from "@/components/BudgetSection";
import type { CategoryAverages, Dashboard } from "@/lib/api";
import { breakdown } from "@/lib/report";
import BreakdownTable from "./BreakdownTable";

/** Page 3: where the month's money went and came from, and its budget. */
export default function MonthDetail({ data, avg }: { data: Dashboard; avg: CategoryAverages }) {
  return (
    <div className="space-y-6">
      <BreakdownTable
        title="Dépenses par catégorie"
        groups={breakdown(avg, "expenses")}
        side="expenses"
        empty="Aucune dépense classée ce mois-ci."
      />
      <BreakdownTable
        title="Revenus par catégorie"
        groups={breakdown(avg, "income")}
        side="income"
        empty="Aucun revenu classé ce mois-ci."
      />
      <div className="break-inside-avoid">
        <BudgetSection budget={data.budget} all={false} />
      </div>
    </div>
  );
}
