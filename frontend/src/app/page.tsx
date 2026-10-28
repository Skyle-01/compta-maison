"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import HelpLink from "@/components/HelpLink";
import Link from "next/link";
import {
  ALL_MONTHS,
  api,
  errorMessage,
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
import AveragesSection from "@/components/AveragesSection";
import BudgetSection from "@/components/BudgetSection";
import MoneyFlowChart from "@/components/MoneyFlowChart";
import ResteTrend from "@/components/ResteTrend";
import SignedAmount from "@/components/SignedAmount";
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
        <h1 className="text-xl font-semibold">
          Tableau de bord
          <HelpLink page="/" />
        </h1>
        <div className="flex items-center gap-3">
          <Link
            href={reportLink(data.month, data.months_available)}
            className="btn-secondary"
          >
            Rapport PDF
          </Link>
          {data.month !== latest && (
            <button
              type="button"
              onClick={() => choose(latest)}
              className="btn-secondary"
            >
              Dernier mois
            </button>
          )}
          <select
            className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm"
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
        <h2 className="mb-3 font-semibold">Flux d’argent</h2>
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
