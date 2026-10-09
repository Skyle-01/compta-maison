import Link from "next/link";
import { type BudgetSummary, formatEuro } from "@/lib/api";
import { barWidth, budgetLeft, budgetMargin, budgetRatio, budgetTone, type BudgetTone } from "@/lib/budget";

const TONE_BAR: Record<BudgetTone, string> = {
  ok: "bg-green-500",
  warn: "bg-amber-500",
  over: "bg-red-500",
};
export const TONE_TEXT: Record<BudgetTone, string> = {
  ok: "text-zinc-500",
  warn: "text-amber-700",
  over: "text-red-700",
};

/** One "spent / target" line with its progress bar (a group header when `strong`). */
function BudgetLine({
  label,
  actual,
  target,
  strong,
}: {
  label: string;
  actual: number;
  target: number;
  strong?: boolean;
}) {
  const ratio = budgetRatio(actual, target);
  const tone = budgetTone(ratio);
  const left = budgetLeft(actual, target);
  return (
    <div className="py-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className={`min-w-0 truncate ${strong ? "font-medium" : "text-zinc-700"}`}>{label}</span>
        <span className="shrink-0 tabular-nums">
          {formatEuro(actual)} <span className="text-zinc-500">/ {formatEuro(target)}</span>
        </span>
      </div>
      <div className={`mt-1 rounded-full bg-zinc-100 ${strong ? "h-2" : "h-1.5"}`}>
        <div
          className={`rounded-full ${TONE_BAR[tone]} ${strong ? "h-2" : "h-1.5"}`}
          style={{ width: `${barWidth(ratio)}%` }}
        />
      </div>
      <div className={`mt-0.5 text-xs ${TONE_TEXT[tone]}`}>
        {left < 0 ? `${formatEuro(-left)} de dépassement` : `reste ${formatEuro(left)}`}
      </div>
    </div>
  );
}

/** « Revenu moyen − objectifs − épargne visée = marge », monthly: red when the targets promise more
 *  than comes in. Shared with the Catégories page. */
export function BudgetBalance({
  income,
  spending,
  savings,
}: {
  income: number;
  spending: number;
  savings: number | null;
}) {
  const margin = budgetMargin(income, spending, savings);
  return (
    <p
      className="text-sm text-zinc-700"
      title="Revenu mensuel moyen du groupe « Revenus » sur les 12 derniers mois complets (hors loyers perçus et désépargne)"
    >
      Revenu moyen <span className="tabular-nums">{formatEuro(income)}</span> − objectifs de dépense{" "}
      <span className="tabular-nums">{formatEuro(spending)}</span>
      {savings !== null && (
        <>
          {" "}
          − épargne visée <span className="tabular-nums">{formatEuro(savings)}</span>
        </>
      )}{" "}
      ={" "}
      <span className={`font-medium tabular-nums ${margin < 0 ? "text-red-700" : "text-green-700"}`}>
        {margin < 0 ? `${formatEuro(-margin)} de plus que le revenu` : `${formatEuro(margin)} non budgétés`}
      </span>{" "}
      / mois
    </p>
  );
}

/** Spending vs the categories' monthly targets, one card per top-level group, overruns first
 *  (the backend already orders groups and leaves). Hidden when no category has a target. */
export default function BudgetSection({ budget, all }: { budget: BudgetSummary; all: boolean }) {
  if (budget.groups.length === 0 && budget.savings_target === null) return null;
  const savingsShort = budget.savings_target !== null ? budget.savings_target - budget.savings_actual : 0;
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-medium">
          Budget
          {all && (
            <span className="ml-2 text-sm font-normal text-zinc-500">
              sur {budget.months} mois (objectifs mensuels × {budget.months})
            </span>
          )}
        </h2>
        <Link
          href="/categories"
          className="text-xs text-zinc-600 underline hover:text-zinc-900 hover:no-underline print:hidden"
        >
          Modifier les objectifs
        </Link>
      </div>
      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <div className="mb-3 border-b border-zinc-100 pb-3">
          <BudgetBalance
            income={budget.income_reference}
            spending={budget.target / budget.months}
            savings={budget.savings_target !== null ? budget.savings_target / budget.months : null}
          />
          {budget.savings_target !== null && (
            // A floor, not a cap: green once reached.
            <p className="mt-1 text-sm text-zinc-700">
              Épargne : <span className="tabular-nums">{formatEuro(budget.savings_actual)}</span>{" "}
              <span className="text-zinc-500">/ {formatEuro(budget.savings_target)} visés</span>{" "}
              <span className={savingsShort > 0.005 ? "text-red-700" : "text-green-700"}>
                {savingsShort > 0.005 ? `il manque ${formatEuro(savingsShort)}` : "objectif atteint"}
              </span>
            </p>
          )}
        </div>
        <BudgetLine label="Total des objectifs" actual={budget.actual} target={budget.target} strong />
        {/* Masonry-like flow (CSS columns) rather than a grid: grid rows stretch every card to the
            tallest one, leaving short groups mostly empty. */}
        <div className="mt-3 gap-4 md:columns-2 print:columns-2">
          {budget.groups.map((g) => (
            <div key={g.id} className="mb-4 break-inside-avoid rounded-md border border-zinc-100 px-3 py-1 last:mb-0">
              {g.leaves.length === 1 ? (
                // A single targeted leaf carries the group's exact figures: one line, not two.
                <BudgetLine label={`${g.name} · ${g.leaves[0].name}`} actual={g.actual} target={g.target} strong />
              ) : (
                <>
                  <BudgetLine label={g.name} actual={g.actual} target={g.target} strong />
                  {g.leaves.length > 0 && (
                    <div className="border-t border-zinc-100 pl-3">
                      {g.leaves.map((l) => (
                        <BudgetLine key={l.id} label={l.name} actual={l.actual} target={l.target} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          Dépenses sans objectif : <span className="tabular-nums">{formatEuro(budget.untargeted)}</span>
        </p>
      </div>
    </section>
  );
}
