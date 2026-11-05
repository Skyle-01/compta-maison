import Link from "next/link";
import { TONE_TEXT } from "@/components/BudgetSection";
import { type BudgetSummary, formatEuro } from "@/lib/api";
import { budgetRatio, budgetTone, overrunCount } from "@/lib/budget";

/** The dashboard's one-line budget summary, linking to the Budget page. Hidden without targets. */
export default function BudgetGlance({ budget, month }: { budget: BudgetSummary; month: string }) {
  if (budget.groups.length === 0) return null;
  const over = overrunCount(budget.groups);
  const tone = budgetTone(budgetRatio(budget.actual, budget.target));
  return (
    <p className="text-sm text-zinc-700">
      Budget : <span className="tabular-nums">{formatEuro(budget.actual)}</span>{" "}
      <span className="text-zinc-500">/ {formatEuro(budget.target)} d&apos;objectifs</span>
      {over > 0 && (
        <span className={TONE_TEXT.over}>
          , {over} groupe{over > 1 ? "s" : ""} dépassé{over > 1 ? "s" : ""}
        </span>
      )}
      {over === 0 && tone === "warn" && <span className={TONE_TEXT.warn}>, proche de la limite</span>}
      .{" "}
      <Link href={`/budget?month=${month}`} className="font-medium underline hover:no-underline">
        Voir le budget →
      </Link>
    </p>
  );
}
