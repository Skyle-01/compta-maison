import { formatEuro } from "@/lib/api";
import { cell, NUM } from "@/components/tableStyles";
import type { AverageLine, AverageMonth as AverageMonthData, ReportCard } from "@/lib/report";
import { Bar } from "./BreakdownTable";

const TONE_TEXT: Record<ReportCard["tone"], string> = {
  good: "text-green-700",
  bad: "text-red-700",
  save: "text-violet-700",
  warn: "text-amber-700",
};

/** « Revenus − Dépenses − Épargne = Reste », each card with its average. */
function Equation({ cards }: { cards: ReportCard[] }) {
  const operators = ["", "−", "−", "="];
  return (
    <div className="flex items-center gap-2">
      {cards.map((card, i) => (
        <div key={card.label} className="flex flex-1 items-center gap-2">
          {operators[i] && <span className="text-lg text-zinc-500">{operators[i]}</span>}
          <div className="flex-1 rounded-lg border border-zinc-200 p-3">
            <div className="text-sm text-zinc-500">{card.label}</div>
            <div className={`mt-1 text-xl font-semibold tabular-nums ${TONE_TEXT[card.tone]}`}>
              {formatEuro(card.value)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** A list of averages: the amount, a bar scaled to the largest line, the target when there is one,
 *  and an optional muted line (Non classé) after them. */
function AverageRows({
  title,
  lines,
  side,
  unclassified,
  showTarget,
}: {
  title: string;
  lines: AverageLine[];
  side: "expenses" | "income";
  unclassified?: number | null;
  showTarget?: boolean;
}) {
  const max = Math.max(0, ...lines.map((l) => l.value));
  return (
    <section>
      <h3 className="mb-2 font-medium">{title}</h3>
      <table className="w-full text-xs">
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-b border-zinc-100">
              <td className="py-1 pr-2">{l.name}</td>
              <td className={NUM}>{cell(l.value)}</td>
              <td className="w-1/3 px-2">
                <Bar value={l.value} max={max} side={side} strong />
              </td>
              {showTarget && (
                <td className={`${NUM} text-zinc-500`}>{l.target === null ? "" : `objectif ${formatEuro(l.target)}`}</td>
              )}
            </tr>
          ))}
          {unclassified != null && (
            <tr>
              <td className="py-1 pr-2 text-zinc-500">Non classé</td>
              <td className={`${NUM} text-zinc-500`}>{cell(unclassified)}</td>
              <td />
              {showTarget && <td />}
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

/** The last page of the report: the average month over the complete months, shown once. Spending is
 *  listed by top-level category only (each month's « Le mois en détail » has the sub-categories),
 *  income by source. */
export default function AverageMonth({ average }: { average: AverageMonthData }) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-700">Moyennes {average.period}, mois clos uniquement.</p>
      <Equation cards={average.cards} />
      <AverageRows
        title="Où part l'argent en moyenne"
        lines={average.spending}
        side="expenses"
        unclassified={average.spendingUnclassified}
        showTarget
      />
      <AverageRows
        title="D'où vient l'argent en moyenne"
        lines={average.incomeSources}
        side="income"
        unclassified={average.incomeUnclassified}
      />
      {average.savings.length > 0 && <AverageRows title="Épargne" lines={average.savings} side="income" />}
    </div>
  );
}
