"use client";

import { type ReactNode, useEffect, useState } from "react";
import {
  ALL_MONTHS,
  api,
  errorMessage,
  type AverageNode,
  type AveragePeriod,
  type CategoryAverages,
  type Dashboard,
  formatEuro,
  frenchMonth,
  frenchMonthShort,
} from "@/lib/api";
import { TONE_TEXT } from "@/components/BudgetSection";
import Gap from "@/components/Gap";
import {
  AVERAGE_PERIODS,
  averageNet,
  monthNet,
  ownTarget,
  periodSummary,
  visibleAverageNodes,
} from "@/lib/averages";
import { budgetRatio, budgetTone } from "@/lib/budget";

/** The Objectif cell's colour: green while under 90 % of the target, then the Budget bands. */
const OBJECTIVE_TEXT = { ...TONE_TEXT, ok: "text-green-700" };

const NUM = "px-2 py-1 text-right tabular-nums";

/** A signed average, green above zero and red below; blank when zero. */
function NetCell({ value }: { value: number }) {
  if (Math.abs(value) < 0.005) return null;
  return <span className={value > 0 ? "text-green-700" : "text-red-700"}>{formatEuro(value)}</span>;
}

/** One table row of the averages: a label, the signed average with its gap, and a last cell. The
 *  gap is neutral unless `gapClass` colours it (an own target: the month's spending vs it). */
function AverageLine({
  label,
  value,
  month,
  gaps,
  last,
  className = "border-b border-zinc-100",
  labelClass = "font-medium",
  indent = 0,
  marker = "",
  onClick,
}: {
  label: string;
  value: number;
  month: number | null;
  gaps: boolean;
  last?: ReactNode;
  className?: string;
  labelClass?: string;
  indent?: number;
  marker?: string;
  onClick?: () => void;
}) {
  return (
    <tr className={className} onClick={onClick}>
      <td className={`py-1 pr-2 ${labelClass}`} style={{ paddingLeft: indent }}>
        <span className="mr-1 inline-block w-3 text-zinc-500">{marker}</span>
        {label}
      </td>
      <td className={NUM}>
        <NetCell value={value} />
      </td>
      {gaps && (
        <td className={NUM}>
          {month !== null && <NetCell value={month} />}{" "}
          <Gap month={month} average={value} className="text-zinc-700" wrap />
        </td>
      )}
      <td className={NUM}>{last}</td>
    </tr>
  );
}

/** The spending the Objectif colour judges: the displayed month's, else (« Tous les mois ») the average. */
function monthSpending(node: AverageNode): number {
  return node.month_expenses !== null ? node.month_expenses - (node.month_income ?? 0) : node.expenses - node.income;
}

/** A category row (indented by depth), expandable to its sub-categories. An own target turns
 *  amber or red as the month's spending nears or passes it (the Budget section's bands). */
function AverageRow({
  node,
  depth,
  gaps,
  open,
  toggle,
}: {
  node: AverageNode;
  depth: number;
  gaps: boolean;
  open: Set<number>;
  toggle: (id: number) => void;
}) {
  const expandable = node.children.length > 0;
  const isOpen = open.has(node.id);
  return (
    <>
      <AverageLine
        label={node.name}
        value={averageNet(node.expenses, node.income)}
        month={monthNet(node.month_expenses, node.month_income)}
        gaps={gaps}
        indent={depth * 20}
        marker={expandable ? (isOpen ? "▾" : "▸") : ""}
        labelClass={depth === 0 ? "font-medium" : "text-zinc-700"}
        className={`border-b border-zinc-100 ${expandable ? "cursor-pointer hover:bg-zinc-50" : ""}`}
        onClick={expandable ? () => toggle(node.id) : undefined}
        last={
          node.target !== null && (
            <span
              className={
                ownTarget(node)
                  ? OBJECTIVE_TEXT[budgetTone(budgetRatio(monthSpending(node), node.target))]
                  : "text-zinc-500"
              }
            >
              {formatEuro(node.target)}
            </span>
          )
        }
      />
      {isOpen &&
        node.children.map((child) => (
          <AverageRow key={child.id} node={child} depth={depth + 1} gaps={gaps} open={open} toggle={toggle} />
        ))}
    </>
  );
}

/** A card average, with its gap to the displayed month when there is one. */
function AverageStat({
  label,
  value,
  month,
  monthLabel,
  goodIsUp,
  valueClass,
}: {
  label: string;
  value: number;
  month: number | null;
  monthLabel: string;
  goodIsUp: boolean;
  valueClass: string;
}) {
  return (
    <div className="rounded-md border border-zinc-100 px-3 py-2">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${valueClass}`}>{formatEuro(value)}</div>
      {month !== null && (
        <div className="text-xs text-zinc-500">
          {monthLabel} : <span className="tabular-nums text-zinc-700">{formatEuro(month)}</span>{" "}
          <Gap month={month} average={value} goodIsUp={goodIsUp} wrap />
        </div>
      )}
    </div>
  );
}

/** Average month per top-level category over the last 3/6/12 complete budget months (the latest,
 *  still filling, never counts), each compared with the displayed month. The rows, Non classé and
 *  the compensations add up to the Revenus / Dépenses averages; the savings accounts to Épargne. */
export default function AveragesSection({ data }: { data: Dashboard }) {
  const [period, setPeriod] = useState<AveragePeriod>("12");
  const [avg, setAvg] = useState<CategoryAverages | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const month = data.month ?? ALL_MONTHS;

  useEffect(() => {
    let stale = false; // a slower answer for a previous choice must not overwrite this one
    api
      .averages(period, month)
      .then((a) => {
        if (stale) return;
        setAvg(a);
        setError(null);
      })
      .catch((e) => {
        if (!stale) setError(errorMessage(e));
      });
    return () => {
      stale = true;
    };
  }, [period, month]);

  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const summary = avg ? periodSummary(avg, period) : null;
  const gaps = avg?.month != null;
  const monthLabel = avg?.month ? frenchMonthShort(avg.month) : "";
  // The cards' month values come from the dashboard payload (same definitions as the averages).
  const cardMonth = (value: number) => (gaps ? value : null);

  let body: ReactNode;
  if (error) body = <p className="text-sm text-red-700">{error}</p>;
  else if (!avg) body = <p className="text-sm text-zinc-500">Chargement…</p>;
  else if (avg.months === 0) {
    body = (
      <p className="text-sm text-zinc-500">
        Pas encore de mois complet : {frenchMonth(avg.current_month ?? "")} est en cours, les moyennes
        commenceront après lui.
      </p>
    );
  } else {
    const { totals, uncategorized: unc } = avg;
    body = (
      <>
        <div className="grid grid-cols-4 gap-3">
          <AverageStat
            label="Revenus / mois"
            value={totals.income}
            month={cardMonth(data.income)}
            monthLabel={monthLabel}
            goodIsUp
            valueClass="text-green-700"
          />
          <AverageStat
            label="Dépenses / mois"
            value={totals.expenses}
            month={cardMonth(data.expenses)}
            monthLabel={monthLabel}
            goodIsUp={false}
            valueClass="text-red-700"
          />
          <AverageStat
            label="Épargne / mois"
            value={totals.epargne - totals.desepargne}
            month={cardMonth(data.epargne - data.desepargne)}
            monthLabel={monthLabel}
            goodIsUp
            valueClass={totals.epargne >= totals.desepargne ? "text-violet-700" : "text-amber-700"}
          />
          <AverageStat
            label="Reste / mois"
            value={totals.reste}
            month={cardMonth(data.reste)}
            monthLabel={monthLabel}
            goodIsUp
            valueClass={totals.reste >= 0 ? "text-green-700" : "text-red-700"}
          />
        </div>

        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs text-zinc-500">
              <th className="py-1 text-left font-normal">Catégorie</th>
              <th className="px-2 py-1 text-right font-normal">Moyenne / mois</th>
              {gaps && <th className="px-2 py-1 text-right font-normal">{monthLabel} (écart)</th>}
              <th className="px-2 py-1 text-right font-normal">Objectif</th>
            </tr>
          </thead>
          <tbody>
            {visibleAverageNodes(avg.groups).map((g) => (
              <AverageRow key={g.id} node={g} depth={0} gaps={gaps} open={open} toggle={toggle} />
            ))}
            <AverageLine
              label="Non classé"
              value={averageNet(unc.expenses, unc.income)}
              month={monthNet(unc.month_expenses, unc.month_income)}
              gaps={gaps}
            />
            <AverageLine
              label="Total"
              value={averageNet(totals.expenses, totals.income)}
              month={gaps ? averageNet(data.expenses, data.income) : null}
              gaps={gaps}
              className="border-t-2 border-zinc-200 font-medium"
            />
            {avg.savings.length > 0 && (
              <tr className="text-xs text-zinc-500">
                <td className="pb-1 pt-4">Comptes d&apos;épargne</td>
                <td className="px-2 pb-1 pt-4 text-right">Mis de côté / mois</td>
                {gaps && <td />}
                <td />
              </tr>
            )}
            {avg.savings.map((s) => (
              // Positive = set aside, negative = dipped into (the Épargne card's sign).
              <AverageLine
                key={s.account_id}
                label={s.name}
                value={averageNet(s.desepargne, s.epargne)}
                month={monthNet(s.month_desepargne, s.month_epargne)}
                gaps={gaps}
                labelClass="text-zinc-700"
              />
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-zinc-500">
          Mois complets uniquement : {frenchMonth(avg.current_month ?? "")}, en cours, n&apos;est pas compté.
          Chaque ligne est le solde moyen d&apos;un mois : en vert ce qui rentre, en rouge ce qui sort (un
          remboursement vient en déduction de sa catégorie) ; le total vaut Revenus − Dépenses. La colonne
          du mois affiche {gaps ? monthLabel : "le mois affiché"} et, entre parenthèses, son écart à cette moyenne. Sur une catégorie avec
          objectif, l&apos;objectif est vert tant que la dépense du mois reste sous 90 %, orange de 90 à 100 %, rouge au-delà.
        </p>
      </>
    );
  }

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-semibold">
          Moyennes mensuelles
          {summary && <span className="ml-2 text-sm font-normal text-zinc-500">{summary}</span>}
        </h2>
        <select
          className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm"
          value={period}
          onChange={(e) => setPeriod(e.target.value as AveragePeriod)}
          aria-label="Période des moyennes"
        >
          {AVERAGE_PERIODS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div className="rounded-lg border border-zinc-200 bg-white p-4">{body}</div>
    </section>
  );
}
