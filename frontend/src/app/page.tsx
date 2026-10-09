"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ALL_MONTHS,
  api,
  errorMessage,
  type AverageNode,
  type AveragePeriod,
  type CategoryAverages,
  type CategoryNode,
  type Dashboard,
  type Transaction,
  formatEuro,
  frenchDate,
  frenchMonth,
  frenchMonthShort,
  leafFilters,
  treeLabel,
} from "@/lib/api";
import BudgetSection, { TONE_TEXT } from "@/components/BudgetSection";
import Gap from "@/components/Gap";
import MoneyFlowChart from "@/components/MoneyFlowChart";
import ResteTrend from "@/components/ResteTrend";
import SignedAmount from "@/components/SignedAmount";
import {
  AVERAGE_PERIODS,
  averageNet,
  monthNet,
  ownTarget,
  periodSummary,
  visibleAverageNodes,
} from "@/lib/averages";
import { budgetRatio, budgetTone } from "@/lib/budget";
import { moneyFlow } from "@/lib/moneyFlow";
import { reportLink } from "@/lib/report";

/** A muted "▲ 1 234 € vs avril" delta line under a stat. `goodIsUp` colours the change green/red
 *  by whether an increase is good (revenus, reste) or bad (dépenses). */
function DeltaLine({ delta, prevMonth, goodIsUp }: { delta: number; prevMonth: string; goodIsUp: boolean }) {
  if (Math.abs(delta) < 0.005) {
    return <div className="mt-1 text-xs text-zinc-500">stable vs {frenchMonthShort(prevMonth)}</div>;
  }
  const up = delta > 0;
  const good = up === goodIsUp;
  return (
    <div className={`mt-1 text-xs ${good ? "text-green-700" : "text-red-700"}`}>
      {up ? "▲" : "▼"} {formatEuro(Math.abs(delta))} vs {frenchMonthShort(prevMonth)}
    </div>
  );
}

function Stat({
  label,
  value,
  valueClass,
  delta,
}: {
  label: string;
  value: number;
  valueClass?: string;
  delta?: { delta: number; prevMonth: string; goodIsUp: boolean } | null;
}) {
  const color = valueClass ?? (value >= 0 ? "text-green-700" : "text-red-700");
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="text-sm text-zinc-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${color}`}>{formatEuro(value)}</div>
      {delta && <DeltaLine {...delta} />}
    </div>
  );
}

/** Plain-language one-liner: the story of the month for a non-technical reader. Mirrors the four
 *  cards (Revenus − Dépenses − Épargne nette = Reste) in words. */
function HeroSummary({ data }: { data: Dashboard }) {
  const positive = data.reste >= 0;
  const all = data.month === ALL_MONTHS;
  const when = all ? "sur l’ensemble de la période" : "ce mois-ci";
  return (
    <p className="text-base leading-relaxed text-zinc-700">
      {all ? (
        "Sur l’ensemble de la période"
      ) : (
        <>
          En <span className="font-medium">{frenchMonth(data.month ?? "")}</span>
        </>
      )}
      , vous avez gagné{" "}
      <span className="font-medium text-green-700">{formatEuro(data.income)}</span> et dépensé{" "}
      <span className="font-medium text-red-700">{formatEuro(data.expenses)}</span>.{" "}
      {data.epargne > 0.005 && (
        <>
          Vous avez mis <span className="font-medium text-violet-700">{formatEuro(data.epargne)}</span> de
          côté.{" "}
        </>
      )}
      {data.desepargne > 0.005 && (
        <>
          Vous avez puisé <span className="font-medium text-amber-700">{formatEuro(data.desepargne)}</span>{" "}
          dans votre épargne.{" "}
        </>
      )}
      {positive ? (
        <>
          Il vous reste <span className="font-semibold text-green-700">{formatEuro(data.reste)}</span>{" "}
          {when}.
        </>
      ) : data.epargne > 0.005 ? (
        <>
          En tenant compte de cette épargne, il vous manque{" "}
          <span className="font-semibold text-red-700">{formatEuro(Math.abs(data.reste))}</span>{" "}
          {when}.
        </>
      ) : (
        <>
          Il vous manque{" "}
          <span className="font-semibold text-red-700">{formatEuro(Math.abs(data.reste))}</span>{" "}
          {when}.
        </>
      )}
    </p>
  );
}

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
  gapClass = "text-zinc-700",
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
  gapClass?: string;
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
          <Gap month={month} average={value} className={gapClass} />
        </td>
      )}
      <td className={NUM}>{last}</td>
    </tr>
  );
}

/** A targeted category's gap colour: neutral while the month stays under 90 % of the target, then the
 *  Budget section's amber / red. */
function gapBudgetClass(monthSpending: number, target: number): string | undefined {
  const tone = budgetTone(budgetRatio(monthSpending, target));
  return tone === "ok" ? undefined : TONE_TEXT[tone];
}

/** A category row (indented by depth), expandable to its sub-categories. An own target turns
 *  amber or red as its average spending nears or passes it (the Budget section's bands). */
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
        gapClass={
          // Only an own target is comparable (a Σ of children's targets leaves untargeted ones out).
          ownTarget(node) && node.target !== null && node.month_expenses !== null
            ? gapBudgetClass(node.month_expenses - (node.month_income ?? 0), node.target)
            : undefined
        }
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
                  ? TONE_TEXT[budgetTone(budgetRatio(node.expenses - node.income, node.target))]
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
          écart {monthLabel} : <Gap month={month} average={value} goodIsUp={goodIsUp} />
        </div>
      )}
    </div>
  );
}

/** Average month per top-level category over the last 3/6/12 complete budget months (the latest,
 *  still filling, never counts), each compared with the displayed month. The rows, Non classé and
 *  the compensations add up to the Revenus / Dépenses averages; the savings accounts to Épargne. */
function AveragesSection({ data }: { data: Dashboard }) {
  const [period, setPeriod] = useState<AveragePeriod>("6");
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
              {gaps && <th className="px-2 py-1 text-right font-normal">Écart {monthLabel}</th>}
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
                <td className="pb-1 pt-4">Comptes d’épargne</td>
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
          Mois complets uniquement : {frenchMonth(avg.current_month ?? "")}, en cours, n’est pas compté.
          Chaque ligne est le solde moyen d’un mois : en vert ce qui rentre, en rouge ce qui sort (un
          remboursement vient en déduction de sa catégorie) ; le total vaut Revenus − Dépenses. L’écart
          compare {gaps ? monthLabel : "le mois affiché"} à cette moyenne ; sur une catégorie avec
          objectif, il passe en orange ou en rouge quand ce mois-là approche ou dépasse l’objectif.
        </p>
      </>
    );
  }

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-medium">
          Moyennes mensuelles
          {summary && <span className="ml-2 text-sm font-normal text-zinc-500">{summary}</span>}
        </h2>
        <select
          className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm"
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

function TreeNode({ node, depth, month }: { node: CategoryNode; depth: number; month?: string }) {
  const hasActivity = node.credit !== 0 || node.debit !== 0;
  const [open, setOpen] = useState(false);
  const [txns, setTxns] = useState<Transaction[] | null>(null);
  const [loading, setLoading] = useState(false);

  // Transactions are only ever assigned to leaf categories, so only leaves expand to reveal
  // them: the uncategorised bucket and the derived savings leaves (by account) included.
  // Group nodes (and the root "total") just aggregate their children inline.
  const expandable = depth > 0 && node.children.length === 0;

  if (!hasActivity) return null;

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && txns === null && !loading) {
      setLoading(true);
      api
        .listTransactions({ ...leafFilters(node, month), limit: 500 })
        .then((p) => setTxns(p.items))
        .catch(() => setTxns([]))
        .finally(() => setLoading(false));
    }
  }

  const childIndent = { paddingLeft: (depth + 1) * 20 };

  return (
    <>
      <div
        className={`flex justify-between border-b border-zinc-100 py-1 text-sm ${
          expandable ? "cursor-pointer hover:bg-zinc-50" : ""
        }`}
        style={{ paddingLeft: depth * 20 }}
        onClick={expandable ? toggle : undefined}
      >
        <span className={depth <= 1 ? "font-medium" : ""}>
          {expandable && (
            <span className="mr-1 inline-block w-3 text-zinc-500">{open ? "▾" : "▸"}</span>
          )}
          {treeLabel(node.name)}
        </span>
        <span className={node.balance >= 0 ? "text-green-700" : "text-red-700"}>
          {formatEuro(node.balance)}
        </span>
      </div>
      {open &&
        (loading ? (
          <div className="py-1 text-xs text-zinc-500" style={childIndent}>
            Chargement…
          </div>
        ) : txns && txns.length > 0 ? (
          txns.map((t) => (
            <div
              key={t.id}
              className="flex justify-between border-b border-zinc-50 py-0.5 text-xs text-zinc-600"
              style={childIndent}
            >
              <span className="min-w-0 truncate pr-2">
                <span className="text-zinc-500">{frenchDate(t.date_valeur)}</span> {t.libelle}
              </span>
              <SignedAmount tx={t} />
            </div>
          ))
        ) : (
          <div className="py-1 text-xs text-zinc-500" style={childIndent}>
            Aucune transaction dans cette catégorie.
          </div>
        ))}
      {node.children.map((child) => (
        <TreeNode key={child.id ?? child.name} node={child} depth={depth + 1} month={month} />
      ))}
    </>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const request = useRef(0); // a slower answer for a previous month must not overwrite this one

  const load = useCallback((month?: string) => {
    const id = ++request.current;
    api
      .dashboard(month)
      .then((d) => {
        // An unknown ?month= (a stale link, a rebuilt DB) falls back to the latest month.
        if (!month || month === ALL_MONTHS || d.months_available.includes(month)) return d;
        window.history.replaceState(null, "", window.location.pathname);
        return api.dashboard();
      })
      .then((d) => {
        if (id === request.current) setData(d);
      })
      .catch((e) => {
        if (id === request.current) setError(errorMessage(e));
      });
  }, []);

  // The displayed month lives in the URL (?month=, none for the latest month) so a reload keeps it
  // and the browser's Back button returns to the previous month.
  useEffect(() => {
    const fromUrl = () => load(new URLSearchParams(window.location.search).get("month") ?? undefined);
    fromUrl();
    window.addEventListener("popstate", fromUrl);
    return () => window.removeEventListener("popstate", fromUrl);
  }, [load]);

  const select = (month: string, latest: string | undefined) => {
    const url = month === latest ? window.location.pathname : `?month=${month}`;
    window.history.pushState(null, "", url);
    load(month);
  };

  if (error) return <p className="text-red-700">{error}</p>;
  if (!data) return <p className="text-zinc-500">Chargement…</p>;

  if (!data.month) {
    return (
      <p className="text-zinc-500">
        Aucune transaction pour l’instant — commencez par importer un relevé bancaire depuis la page
        Importer.
      </p>
    );
  }

  const all = data.month === ALL_MONTHS;
  const month = all ? undefined : data.month; // the transaction filter: none for every month
  const flow = moneyFlow(data);
  const hist = data.history;
  const cur = hist.findIndex((h) => h.month === data.month);
  const prev = cur > 0 ? hist[cur - 1] : null;
  const epargneNet = data.epargne - data.desepargne;
  const latest = data.months_available[0];
  const choose = (m: string) => select(m, latest);
  const deltaProps = (current: number, previous: number | undefined, goodIsUp: boolean) =>
    prev && previous !== undefined
      ? { delta: current - previous, prevMonth: prev.month, goodIsUp }
      : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Tableau de bord</h1>
        <div className="flex items-center gap-3">
          <Link
            href={reportLink(data.month, data.months_available)}
            className="text-sm text-zinc-600 underline hover:text-zinc-900 hover:no-underline"
          >
            Rapport PDF
          </Link>
          {data.month !== latest && (
            <button
              type="button"
              onClick={() => choose(latest)}
              className="text-sm text-zinc-600 underline hover:text-zinc-900 hover:no-underline"
            >
              Dernier mois
            </button>
          )}
          <select
            className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm"
            value={data.month}
            onChange={(e) => choose(e.target.value)}
          >
            <option value={ALL_MONTHS}>Tous les mois</option>
            {data.months_available.map((m) => (
              <option key={m} value={m}>
                {frenchMonth(m)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <HeroSummary data={data} />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat
          label="Revenus"
          value={data.income}
          valueClass="text-green-700"
          delta={deltaProps(data.income, prev?.income, true)}
        />
        <Stat
          label="Dépenses"
          value={data.expenses}
          valueClass="text-red-700"
          delta={deltaProps(data.expenses, prev?.expenses, false)}
        />
        <Stat
          label="Épargne"
          value={epargneNet}
          valueClass={epargneNet >= 0 ? "text-violet-700" : "text-amber-700"}
          delta={deltaProps(epargneNet, prev ? prev.epargne - prev.desepargne : undefined, true)}
        />
        <Stat label="Reste" value={data.reste} delta={deltaProps(data.reste, prev?.reste, true)} />
      </div>

      <ResteTrend
        history={hist}
        current={data.month}
        latest={hist.at(-1)?.month}
        onSelect={choose}
      />

      <BudgetSection budget={data.budget} all={all} />

      <AveragesSection data={data} />

      {data.transfers.count > 0 && (
        <p className="text-sm text-zinc-500">
          {data.transfers.count} virement(s) interne(s) de {formatEuro(data.transfers.total)} appariés
          et exclus des totaux ci-dessus.
        </p>
      )}

      {!data.uncategorized.balanced && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {data.uncategorized.count} opération{data.uncategorized.count > 1 ? "s" : ""} encore sans
          catégorie ({formatEuro(Math.abs(data.uncategorized.difference))} d’écart dans les totaux).{" "}
          <Link
            href={`/transactions?uncategorized=1&month=${month ?? ""}`}
            className="font-medium underline hover:no-underline"
          >
            Les classer →
          </Link>
        </div>
      )}

      <section>
        <h2 className="mb-3 font-medium">Flux d’argent</h2>
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          {flow.links.length > 0 ? (
            // Too wide for a phone: the chart keeps a readable width and scrolls sideways inside
            // its card instead of squashing its columns together.
            <div className="-mx-4 overflow-x-auto px-4">
              <p className="mb-2 text-xs text-zinc-400 md:hidden">Faites défiler le graphique vers la droite →</p>
              <div className="min-w-[760px]">
                <MoneyFlowChart flow={flow} />
              </div>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">Aucun revenu ni dépense catégorisée pour l’instant.</p>
          )}
        </div>
      </section>

      <section>
        <details className="rounded-lg border border-zinc-200 bg-white">
          <summary className="cursor-pointer px-4 py-3 font-medium">Détail par catégorie</summary>
          <div className="border-t border-zinc-100 px-4 pb-3 pt-1">
            <TreeNode key={data.month} node={data.by_category} depth={0} month={month} />
          </div>
        </details>
      </section>
    </div>
  );
}
