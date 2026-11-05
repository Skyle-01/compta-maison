"use client";

import { useEffect, useState } from "react";
import HelpLink from "@/components/HelpLink";
import Link from "next/link";
import AccountDot from "@/components/AccountDot";
import {
  errorMessage,
  type Account,
  type CategoryNode,
  type Dashboard,
  type Transaction,
  formatEuro,
  frenchDate,
  frenchMonth,
  frenchMonthShort,
  listLeafOperations,
  treeLabel,
} from "@/lib/api";
import BudgetGlance from "@/components/BudgetGlance";
import MoneyFlowChart from "@/components/MoneyFlowChart";
import MonthSelect from "@/components/MonthSelect";
import ResteTrend from "@/components/ResteTrend";
import SignedAmount from "@/components/SignedAmount";
import { moneyFlow } from "@/lib/moneyFlow";
import { reportLink, treeLeaves } from "@/lib/report";
import { useAccounts } from "@/lib/useAccounts";
import { useMonthDashboard } from "@/lib/useMonthDashboard";

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
  return (
    <p className="text-base leading-relaxed text-zinc-700">
      En <span className="font-medium">{frenchMonth(data.month ?? "")}</span>, vous avez gagné{" "}
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
          Il vous reste <span className="font-semibold text-green-700">{formatEuro(data.reste)}</span> ce
          mois-ci.
        </>
      ) : data.epargne > 0.005 ? (
        <>
          En tenant compte de cette épargne, il vous manque{" "}
          <span className="font-semibold text-red-700">{formatEuro(Math.abs(data.reste))}</span> ce mois-ci.
        </>
      ) : (
        <>
          Il vous manque <span className="font-semibold text-red-700">{formatEuro(Math.abs(data.reste))}</span>{" "}
          ce mois-ci.
        </>
      )}
    </p>
  );
}

/** The balance tree, fully open: each leaf lists its operations (`operations`, loaded once for the
 *  whole tree; undefined while loading). Transactions are only ever assigned to leaf categories, so
 *  groups and the root just aggregate their children. */
function TreeNode({
  node,
  depth,
  operations,
  failed,
  accounts,
}: {
  node: CategoryNode;
  depth: number;
  operations: Map<CategoryNode, Transaction[]> | null;
  failed: boolean;
  accounts: Account[];
}) {
  if (node.credit === 0 && node.debit === 0) return null;
  const isLeaf = depth > 0 && node.children.length === 0;
  const txns = operations?.get(node);
  const childIndent = { paddingLeft: (depth + 1) * 20 };
  return (
    <>
      <div className="flex justify-between border-b border-zinc-100 py-1 text-sm" style={{ paddingLeft: depth * 20 }}>
        <span className={depth <= 1 ? "font-medium" : ""}>
          {node.synthetic && <AccountDot accounts={accounts} code={node.account_id} />}
          {treeLabel(node.name)}
        </span>
        <span className={node.balance >= 0 ? "text-green-700" : "text-red-700"}>
          {formatEuro(node.balance)}
        </span>
      </div>
      {isLeaf && !txns && !failed && (
        <div className="py-1 text-xs text-zinc-500" style={childIndent}>
          Chargement…
        </div>
      )}
      {txns?.map((t) => (
        <div
          key={t.id}
          className="flex justify-between border-b border-zinc-50 py-0.5 text-xs text-zinc-600"
          style={childIndent}
        >
          <span className="min-w-0 truncate pr-2">
            <AccountDot accounts={accounts} code={t.account_id} />
            <span className="text-zinc-500">{frenchDate(t.date_valeur)}</span> {t.libelle}
          </span>
          <SignedAmount tx={t} />
        </div>
      ))}
      {node.children.map((child) => (
        <TreeNode
          key={child.id ?? child.name}
          node={child}
          depth={depth + 1}
          operations={operations}
          failed={failed}
          accounts={accounts}
        />
      ))}
    </>
  );
}

export default function DashboardPage() {
  const accounts = useAccounts();
  const { data, error, choose } = useMonthDashboard();
  // The operations of every leaf, loaded per displayed month (null while loading).
  const [operations, setOperations] = useState<{
    month: string;
    byLeaf: Map<CategoryNode, Transaction[]> | null;
    error: string | null;
  } | null>(null);

  const tree = data?.by_category;
  const treeMonth = data?.month ?? undefined;
  useEffect(() => {
    if (!tree || !treeMonth) return;
    let stale = false; // a slower answer for a previous month must not overwrite this one
    listLeafOperations(treeLeaves(tree), treeMonth)
      .then((byLeaf) => {
        if (!stale) setOperations({ month: treeMonth, byLeaf, error: null });
      })
      .catch((e) => {
        if (!stale) setOperations({ month: treeMonth, byLeaf: null, error: errorMessage(e) });
      });
    return () => {
      stale = true;
    };
  }, [tree, treeMonth]);

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

  const month = data.month;
  const shown = operations?.month === month ? operations : null; // none until this month's answer
  const flow = moneyFlow(data);
  const hist = data.history;
  const cur = hist.findIndex((h) => h.month === month);
  const prev = cur > 0 ? hist[cur - 1] : null;
  const epargneNet = data.epargne - data.desepargne;
  const latest = data.months_available[0];
  const deltaProps = (current: number, previous: number | undefined, goodIsUp: boolean) =>
    prev && previous !== undefined
      ? { delta: current - previous, prevMonth: prev.month, goodIsUp }
      : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          Le mois
          <HelpLink page="/" />
        </h1>
        <div className="flex items-center gap-3">
          <Link
            href={reportLink(month, data.months_available)}
            className="btn-secondary"
          >
            Rapport PDF
          </Link>
          {month !== latest && (
            <button
              type="button"
              onClick={() => choose(latest)}
              className="btn-secondary"
            >
              Dernier mois
            </button>
          )}
          <MonthSelect
            value={month}
            available={data.months_available}
            partial={data.months_partial}
            onChange={choose}
          />
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
        current={month}
        latest={hist.at(-1)?.month}
        partial={data.months_partial}
        onSelect={choose}
      />

      <BudgetGlance budget={data.budget} month={month} />

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
            href={`/transactions?uncategorized=1&month=${month}`}
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
        <h2 className="mb-3 font-semibold">Détail par catégorie</h2>
        <div className="rounded-lg border border-zinc-200 bg-white px-4 pb-3 pt-1">
          {shown?.error && <p className="py-1 text-sm text-red-700">{shown.error}</p>}
          <TreeNode
            node={data.by_category}
            depth={0}
            operations={shown?.byLeaf ?? null}
            failed={!!shown?.error}
            accounts={accounts}
          />
        </div>
      </section>
    </div>
  );
}
