"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Line,
  LineChart,
  Rectangle,
  ReferenceLine,
  ResponsiveContainer,
  Sankey,
  Tooltip,
  XAxis,
} from "recharts";
import {
  api,
  type CategoryNode,
  type Dashboard,
  type MonthTotals,
  type Transaction,
  formatEuro,
  frenchMonth,
  frenchMonthShort,
} from "@/lib/api";

// The tree's structural node names come from the backend in English ("total", "uncategorised");
// everything else is already French. Display them in French without renaming the data.
const TREE_LABELS: Record<string, string> = { total: "Total", uncategorised: "Non classé" };
const treeLabel = (name: string): string => TREE_LABELS[name] ?? name;

/** A muted "▲ 1 234 € vs avril" delta line under a stat. `goodIsUp` colours the change green/red
 *  by whether an increase is good (revenus, reste) or bad (dépenses). */
function DeltaLine({ delta, prevMonth, goodIsUp }: { delta: number; prevMonth: string; goodIsUp: boolean }) {
  if (Math.abs(delta) < 0.005) {
    return <div className="mt-1 text-xs text-zinc-400">stable vs {frenchMonthShort(prevMonth)}</div>;
  }
  const up = delta > 0;
  const good = up === goodIsUp;
  return (
    <div className={`mt-1 text-xs ${good ? "text-green-600" : "text-red-600"}`}>
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
          Il vous reste <span className="font-semibold text-green-700">{formatEuro(data.reste)}</span>{" "}
          ce mois-ci.
        </>
      ) : data.epargne > 0.005 ? (
        <>
          En tenant compte de cette épargne, il vous manque{" "}
          <span className="font-semibold text-red-700">{formatEuro(Math.abs(data.reste))}</span> ce
          mois-ci.
        </>
      ) : (
        <>
          Il vous manque{" "}
          <span className="font-semibold text-red-700">{formatEuro(Math.abs(data.reste))}</span> ce
          mois-ci.
        </>
      )}
    </p>
  );
}

interface TrendDotProps {
  cx?: number;
  cy?: number;
  payload?: MonthTotals;
}

function TrendDot({ cx, cy, payload, current }: TrendDotProps & { current: string }) {
  const isCurrent = payload?.month === current;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={isCurrent ? 4 : 2.5}
      fill={isCurrent ? "#0d9488" : "#5eead4"}
      stroke={isCurrent ? "#ffffff" : "none"}
      strokeWidth={isCurrent ? 1.5 : 0}
    />
  );
}

/** A compact reste-by-month sparkline so the current month reads in context. */
function ResteTrend({ history, current }: { history: MonthTotals[]; current: string }) {
  if (history.length < 2) return null;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="mb-2 text-sm text-zinc-500">Reste mois par mois</div>
      <ResponsiveContainer width="100%" height={72}>
        <LineChart data={history} margin={{ top: 6, right: 10, bottom: 0, left: 10 }}>
          <XAxis dataKey="month" hide />
          <ReferenceLine y={0} stroke="#d4d4d8" strokeDasharray="3 3" />
          <Tooltip
            formatter={(v) => [formatEuro(Number(v)), "Reste"] as [string, string]}
            labelFormatter={(m) => frenchMonth(String(m))}
          />
          <Line
            type="monotone"
            dataKey="reste"
            stroke="#0d9488"
            strokeWidth={2}
            isAnimationActive={false}
            activeDot={{ r: 5 }}
            dot={(props) => {
              const p = props as unknown as TrendDotProps;
              return <TrendDot key={p.payload?.month ?? p.cx} {...p} current={current} />;
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function TreeNode({ node, depth, month }: { node: CategoryNode; depth: number; month: string }) {
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
      // Imported-savings leaves list their account's operations; external-savings leaves (kids)
      // list the checking-account rows matching their libellé; node.id === null (and not
      // synthetic) marks the uncategorised bucket; otherwise filter by category.
      const params =
        node.synthetic && node.account_id
          ? { month, account: node.account_id, limit: 500 }
          : node.synthetic && node.libelle_match
            ? { month, libelleContains: node.libelle_match, limit: 500 }
            : node.id === null
              ? { month, uncategorized: true, limit: 500 }
              : { month, categoryId: node.id, limit: 500 };
      api
        .listTransactions(params)
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
            <span className="mr-1 inline-block w-3 text-zinc-400">{open ? "▾" : "▸"}</span>
          )}
          {treeLabel(node.name)}
        </span>
        <span className={node.balance >= 0 ? "text-green-700" : "text-red-700"}>
          {formatEuro(node.balance)}
        </span>
      </div>
      {open &&
        (loading ? (
          <div className="py-1 text-xs text-zinc-400" style={childIndent}>
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
                <span className="text-zinc-400">{t.date_valeur}</span> {t.libelle}
              </span>
              <span className={t.credit > 0 ? "text-green-700" : "text-red-700"}>
                {formatEuro(t.credit > 0 ? t.credit : -t.debit)}
              </span>
            </div>
          ))
        ) : (
          <div className="py-1 text-xs text-zinc-400" style={childIndent}>
            Aucune transaction dans cette catégorie.
          </div>
        ))}
      {node.children.map((child) => (
        <TreeNode key={child.id ?? child.name} node={child} depth={depth + 1} month={month} />
      ))}
    </>
  );
}

// One of the roles a Sankey node plays — drives its colour.
type FlowRole = "income" | "budget" | "expense" | "savings" | "net";

interface FlowNodeDatum {
  name: string;
  role: FlowRole;
  /** Filled in by recharts' layout, read back in the custom node renderer. */
  value?: number;
  targetNodes?: number[];
}
interface FlowLink {
  source: number;
  target: number;
  value: number;
}
interface FlowData {
  nodes: FlowNodeDatum[];
  links: FlowLink[];
}

const EPS = 0.01;
const ROLE_COLORS: Record<FlowRole, string> = {
  income: "#15803d", // green — money coming in
  budget: "#0284c7", // sky — the central pool
  savings: "#7c3aed", // violet — épargne set aside
  expense: "#dc2626", // red — money going out
  net: "#0d9488", // teal — the balancing surplus / deficit
};

/** Top-level root child named `name` (real category or synthetic group), if present. */
function topLevel(tree: CategoryNode, name: string): CategoryNode | undefined {
  return tree.children.find((c) => c.name === name);
}

/** Build the money-flow Sankey, symmetric around a central Budget node: income sources fan into a
 *  Revenus hub (alongside uncategorised income and any désépargne) which feeds the Budget; the
 *  Budget then fans out to expense groups → leaves, uncategorised spend, Épargne, and a balancing
 *  Net branch (a surplus flows out on the right; a deficit flows in on the left).
 *  Flow values are rolled UP from the leaves: an expense node is its leaves' net debit
 *  (debit - credit, so refunds offset), an income source is a leaf's net credit. That per-leaf
 *  split is what lets income live inside an otherwise-expense group (e.g. the salary under Fixe)
 *  without hiding that group's expenses or creating a Budget↔group cycle. The uncategorised bucket
 *  is shown gross on both sides (it usually holds both income and spending). Net balances the
 *  Budget node so its inflow and outflow always match. To keep the right edge legible, tiny
 *  expense leaves within a group are folded into a single "Autres" node. Returns indexed
 *  {nodes, links}. */
function moneyFlow(data: Dashboard): FlowData {
  const tree = data.by_category;
  const nodes: FlowNodeDatum[] = [];
  const links: FlowLink[] = [];
  const add = (name: string, role: FlowRole): number => nodes.push({ name, role }) - 1;
  const link = (source: number, target: number, value: number) => {
    if (value > EPS) links.push({ source, target, value });
  };

  const budget = add("Budget", "budget");
  const SKIP = new Set(["Épargne", "Déficit", "uncategorised"]);
  const unc = topLevel(tree, "uncategorised");
  let incomeShown = 0;
  let expensesShown = 0;

  // Income side: each net-credit category leaf fans into a Revenus hub, which feeds the budget.
  const incomeLeaves: { name: string; value: number }[] = [];
  const collectIncome = (node: CategoryNode) => {
    if (node.synthetic || SKIP.has(node.name)) return;
    if (node.children.length === 0) {
      const net = node.credit - node.debit;
      if (net > EPS) incomeLeaves.push({ name: node.name, value: net });
    } else node.children.forEach(collectIncome);
  };
  tree.children.forEach(collectIncome);
  if (incomeLeaves.length > 0) {
    const revenus = add("Revenus", "income");
    for (const leaf of incomeLeaves) {
      link(add(leaf.name, "income"), revenus, leaf.value);
      incomeShown += leaf.value;
    }
    link(revenus, budget, incomeShown);
  }
  // Uncategorised income (gross credit) and désépargne (money pulled from savings) feed straight in.
  if (unc && unc.credit > EPS) {
    link(add("Non classé", "income"), budget, unc.credit);
    incomeShown += unc.credit;
  }
  const deficit = topLevel(tree, "Déficit");
  const desepargne = deficit ? deficit.credit : 0;
  if (desepargne > EPS) {
    link(add("Désépargne", "income"), budget, desepargne);
    incomeShown += desepargne;
  }

  // Expense side: Budget → top-level group → leaves, recursing through any sub-groups so the
  // hierarchy is preserved. Group values are rolled up from the leaves' net debit (see above).
  const expenseValue = (node: CategoryNode): number => {
    if (node.synthetic || SKIP.has(node.name)) return 0;
    if (node.children.length === 0) return Math.max(0, node.debit - node.credit);
    return node.children.reduce((sum, child) => sum + expenseValue(child), 0);
  };
  // Leaves smaller than this (within their group) collapse into one "Autres" node.
  const totalExpenses =
    tree.children.reduce((sum, g) => sum + expenseValue(g), 0) + (unc ? Math.max(0, unc.debit) : 0);
  const foldThreshold = totalExpenses * 0.025;

  const emit = (node: CategoryNode, parent: number) => {
    for (const child of node.children) {
      if (child.children.length === 0) continue;
      const value = expenseValue(child);
      if (value <= EPS) continue;
      const idx = add(child.name, "expense");
      link(parent, idx, value);
      emit(child, idx);
    }
    const leaves = node.children
      .filter((c) => c.children.length === 0)
      .map((c) => ({ name: c.name, value: expenseValue(c) }))
      .filter((e) => e.value > EPS);
    const kept = leaves.filter((l) => l.value >= foldThreshold);
    const folded = leaves.filter((l) => l.value < foldThreshold);
    for (const leaf of kept) link(parent, add(leaf.name, "expense"), leaf.value);
    if (folded.length === 1) {
      link(parent, add(folded[0].name, "expense"), folded[0].value);
    } else if (folded.length > 1) {
      // Name the rolled-up node after its group so several "Autres" stay distinguishable.
      link(parent, add(`Autres (${node.name})`, "expense"), folded.reduce((s, l) => s + l.value, 0));
    }
  };

  for (const group of tree.children) {
    const value = expenseValue(group);
    if (value <= EPS) continue;
    const idx = add(group.name, "expense");
    link(budget, idx, value);
    expensesShown += value;
    emit(group, idx);
  }
  if (unc && unc.debit > EPS) {
    link(budget, add("Non classé", "expense"), unc.debit);
    expensesShown += unc.debit;
  }

  // Épargne branch (money moved to savings).
  const epargneNode = topLevel(tree, "Épargne");
  const epargne = epargneNode ? epargneNode.debit : 0;
  if (epargne > EPS) link(budget, add("Épargne", "savings"), epargne);

  // The all-in cash balance (= Balance-tree total): a surplus ("Reste") flows out on the right,
  // a deficit ("Découvert", money drawn from reserves) flows in on the left. This intentionally
  // accounts for Épargne too, so it differs from the income−expenses "Net" stat card.
  const net = incomeShown - expensesShown - epargne;
  if (net > EPS) link(budget, add("Reste", "net"), net);
  else if (net < -EPS) link(add("Découvert", "net"), budget, -net);

  return { nodes, links };
}

/** Custom Sankey node: a coloured rectangle plus a two-line label (name over amount, so each line
 *  stays short and fits the margins). Terminal nodes (no outgoing links, right-aligned by recharts)
 *  label to the right into the right gutter; every other node labels to the left of its bar. */
interface FlowNodeProps {
  x: number;
  y: number;
  width: number;
  height: number;
  payload: FlowNodeDatum;
}

function FlowNode({ x, y, width, height, payload }: FlowNodeProps) {
  const isTerminal = (payload.targetNodes?.length ?? 0) === 0;
  const fill = ROLE_COLORS[payload.role];
  const labelX = isTerminal ? x + width + 6 : x - 6;
  const anchor = isTerminal ? "start" : "end";
  const midY = y + height / 2;
  const name = payload.name.length > 22 ? `${payload.name.slice(0, 21)}…` : payload.name;
  return (
    <g>
      <Rectangle x={x} y={y} width={width} height={height} fill={fill} fillOpacity={0.9} />
      <text x={labelX} y={midY - 5} textAnchor={anchor} fontSize={11} fill="#3f3f46">
        {name}
      </text>
      <text x={labelX} y={midY + 8} textAnchor={anchor} fontSize={10} fill="#a1a1aa">
        {formatEuro(payload.value ?? 0)}
      </text>
    </g>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((month?: string) => {
    api
      .dashboard(month)
      .then(setData)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => load(), [load]);

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

  const flow = moneyFlow(data);
  const hist = data.history;
  const cur = hist.findIndex((h) => h.month === data.month);
  const prev = cur > 0 ? hist[cur - 1] : null;
  const epargneNet = data.epargne - data.desepargne;
  const deltaProps = (current: number, previous: number | undefined, goodIsUp: boolean) =>
    prev && previous !== undefined
      ? { delta: current - previous, prevMonth: prev.month, goodIsUp }
      : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Tableau de bord</h1>
        <select
          className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm"
          value={data.month}
          onChange={(e) => load(e.target.value)}
        >
          {data.months_available.map((m) => (
            <option key={m} value={m}>
              {frenchMonth(m)}
            </option>
          ))}
        </select>
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

      <ResteTrend history={hist} current={data.month} />

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
            href={`/transactions?uncategorized=1&month=${data.month}`}
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
            <ResponsiveContainer width="100%" height={Math.max(360, flow.nodes.length * 30)}>
              <Sankey
                data={flow}
                nodePadding={20}
                nodeWidth={12}
                node={(props) => <FlowNode {...(props as unknown as FlowNodeProps)} />}
                link={{ stroke: "#475569", strokeOpacity: 0.28 }}
                margin={{ left: 140, right: 168, top: 12, bottom: 12 }}
              >
                <Tooltip formatter={(v) => formatEuro(Number(v))} />
              </Sankey>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-zinc-400">Aucun revenu ni dépense catégorisée pour l’instant.</p>
          )}
        </div>
      </section>

      <section>
        <details className="rounded-lg border border-zinc-200 bg-white">
          <summary className="cursor-pointer px-4 py-3 font-medium">Détail par catégorie</summary>
          <div className="border-t border-zinc-100 px-4 pb-3 pt-1">
            <TreeNode key={data.month} node={data.by_category} depth={0} month={data.month} />
          </div>
        </details>
      </section>
    </div>
  );
}
