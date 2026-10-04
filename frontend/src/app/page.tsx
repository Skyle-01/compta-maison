"use client";

import { type MouseEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ALL_MONTHS,
  api,
  errorMessage,
  type BudgetSummary,
  type CategoryNode,
  type Dashboard,
  type MonthTotals,
  type Transaction,
  formatEuro,
  frenchDate,
  frenchMonth,
  frenchMonthShort,
} from "@/lib/api";
import SignedAmount from "@/components/SignedAmount";
import { barWidth, budgetLeft, budgetRatio, budgetTone, type BudgetTone } from "@/lib/budget";
import { busiestColumn, flowLayout, type PlacedLink, type PlacedNode } from "@/lib/flowLayout";
import { type FlowData, type FlowRole, moneyFlow } from "@/lib/moneyFlow";
import { monthTick, trendTicks, trendValueLabels } from "@/lib/trend";

// The tree's structural node names come from the backend in English ("total", "uncategorised");
// everything else is already French. Display them in French without renaming the data.
const TREE_LABELS: Record<string, string> = { total: "Total", uncategorised: "Non classé" };
const treeLabel = (name: string): string => TREE_LABELS[name] ?? name;

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

interface TrendDotProps {
  cx?: number;
  cy?: number;
  index?: number;
  payload?: MonthTotals;
}

const TREND_TEAL = "#0d9488";
const TREND_RED = "#dc2626";

/** A sparkline point: the current month is larger, deficit months are red, and the months picked by
 *  `trendValueLabels` print their amount (above, or below for a negative month; anchored inwards at
 *  either end so the text never leaves the chart). */
function TrendDot({
  cx,
  cy,
  index,
  payload,
  current,
  labelled,
  count,
}: TrendDotProps & { current: string; labelled: Set<string>; count: number }) {
  if (cx === undefined || cy === undefined || !payload) return null;
  const isCurrent = payload.month === current;
  const negative = payload.reste < 0;
  const color = negative ? TREND_RED : TREND_TEAL;
  const anchor = index === 0 ? "start" : index === count - 1 ? "end" : "middle";
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={isCurrent ? 4 : 2.5}
        fill={isCurrent || negative ? color : "#5eead4"}
        stroke={isCurrent ? "#ffffff" : "none"}
        strokeWidth={isCurrent ? 1.5 : 0}
      />
      {labelled.has(payload.month) && (
        <text
          x={cx}
          y={negative ? cy + 15 : cy - 8}
          textAnchor={anchor}
          fontSize={11}
          fontWeight={isCurrent ? 600 : 400}
          fill={negative ? "#b91c1c" : "#0f766e"}
          stroke="#ffffff"
          strokeWidth={3}
          paintOrder="stroke"
        >
          {formatEuro(payload.reste)}
        </text>
      )}
    </g>
  );
}

/** A compact reste-by-month sparkline so the current month reads in context: short month ticks,
 *  the current month's amount (the extremes in the "Tous les mois" view), a labelled zero line and
 *  a red tint below it so a deficit month stands out. */
function ResteTrend({ history, current }: { history: MonthTotals[]; current: string }) {
  if (history.length < 2) return null;
  const values = history.map((h) => h.reste);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;
  // Headroom for the value labels: above the top point, and below a deficit (labelled underneath).
  const domain = [min < 0 ? min - range * 0.3 : 0, max + range * 0.08];
  const labelled = trendValueLabels(history, current);
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="mb-1 text-sm text-zinc-500">Reste mois par mois</div>
      <ResponsiveContainer width="100%" height={112}>
        <LineChart data={history} margin={{ top: 18, right: 8, bottom: 0, left: 28 }}>
          <XAxis
            dataKey="month"
            ticks={trendTicks(history, current)}
            tickFormatter={monthTick}
            interval={0}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fill: "#71717a" }}
            height={16}
            padding={{ left: 12, right: 12 }}
          />
          <YAxis hide domain={domain} />
          {min < 0 && <ReferenceArea y1={domain[0]} y2={0} fill={TREND_RED} fillOpacity={0.06} />}
          <ReferenceLine
            y={0}
            stroke="#a1a1aa"
            strokeDasharray="3 3"
            label={{ value: "0 €", position: "left", fontSize: 10, fill: "#71717a" }}
          />
          <Tooltip
            formatter={(v) => [formatEuro(Number(v)), "Reste"] as [string, string]}
            labelFormatter={(m) => frenchMonth(String(m))}
          />
          <Line
            type="monotone"
            dataKey="reste"
            stroke={TREND_TEAL}
            strokeWidth={2}
            isAnimationActive={false}
            activeDot={{ r: 5 }}
            dot={(props) => {
              const p = props as unknown as TrendDotProps;
              return (
                <TrendDot
                  key={p.payload?.month ?? p.cx}
                  {...p}
                  current={current}
                  labelled={labelled}
                  count={history.length}
                />
              );
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

const TONE_BAR: Record<BudgetTone, string> = {
  ok: "bg-green-500",
  warn: "bg-amber-500",
  over: "bg-red-500",
};
const TONE_TEXT: Record<BudgetTone, string> = {
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

/** Spending vs the categories' monthly targets, one card per top-level group, overruns first
 *  (the backend already orders groups and leaves). Hidden when no category has a target. */
function BudgetSection({ budget, all }: { budget: BudgetSummary; all: boolean }) {
  if (budget.groups.length === 0) return null;
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
        <Link href="/categories" className="text-xs text-zinc-600 underline hover:text-zinc-900 hover:no-underline">
          Modifier les objectifs
        </Link>
      </div>
      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <BudgetLine label="Total des objectifs" actual={budget.actual} target={budget.target} strong />
        {/* Masonry-like flow (CSS columns) rather than a grid: grid rows stretch every card to the
            tallest one, leaving short groups mostly empty. */}
        <div className="mt-3 gap-4 md:columns-2">
          {budget.groups.map((g) => (
            <div key={g.id} className="mb-4 break-inside-avoid rounded-md border border-zinc-100 px-3 py-1 last:mb-0">
              {g.leaves.length === 1 ? (
                // A single targeted leaf carries the group's exact figures: one line, not two.
                <BudgetLine
                  label={`${g.name} · ${g.leaves[0].name}`}
                  actual={g.actual}
                  target={g.target}
                  strong
                />
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
      // Imported-savings leaves list their account's operations; external-savings leaves (kids)
      // list the checking-account rows matching their libellé; node.id === null (and not
      // synthetic) marks the uncategorised bucket; otherwise filter by category.
      const params =
        node.synthetic && node.account_id
          ? { month, account: node.account_id, limit: 500 }
          : node.synthetic && node.libelle_match
            ? { month, depositPattern: node.libelle_match, limit: 500 }
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

// Sankey node colour per role (the graph comes from lib/moneyFlow.ts, its layout from lib/flowLayout.ts).
const ROLE_COLORS: Record<FlowRole, string> = {
  income: "#15803d", // green — money coming in
  budget: "#0284c7", // sky — the central pool
  savings: "#7c3aed", // violet — épargne set aside
  expense: "#dc2626", // red — money going out
  net: "#0d9488", // teal — the balancing surplus / deficit
};

// Pointer handlers shared by the chart's nodes and links: show `text` in the tooltip, hide it.
interface FlowHover {
  onHover: (e: MouseEvent, text: string) => void;
  onLeave: () => void;
}

// Label length caps: a one-line label also carries the amount, so its name gets less room.
const FLOW_LABEL_MAX = 26;
const FLOW_LABEL_MAX_ONE_LINE = 18;
const TWO_LINE_MIN_HEIGHT = 22;
// White outline behind label text (drawn under the fill), readable over links.
const HALO = { stroke: "#ffffff", strokeWidth: 3, strokeLinejoin: "round", paintOrder: "stroke" } as const;

/** Sankey node: a coloured rectangle plus its label. Sources (no incoming links) label to the left
 *  into the left gutter, terminal nodes (no outgoing links, in the last column) to the right;
 *  middle-column nodes label to the left of their bar over a white halo so the links passing
 *  through don't cover the text. A node tall enough for two lines shows name over amount; a short
 *  one gets a single line (name + amount at the edges, name only in the middle — the tooltip
 *  still has the amount). */
function FlowNode({ node, onHover, onLeave }: { node: PlacedNode } & FlowHover) {
  const { x, y, width, height } = node;
  const isMiddle = !node.isTerminal && !node.isSource;
  const labelX = node.isTerminal ? x + width + 6 : x - 6;
  const anchor = node.isTerminal ? "start" : "end";
  const midY = y + height / 2;
  const twoLines = height >= TWO_LINE_MIN_HEIGHT;
  const max = twoLines || isMiddle ? FLOW_LABEL_MAX : FLOW_LABEL_MAX_ONE_LINE;
  const name = node.name.length > max ? `${node.name.slice(0, max - 1)}…` : node.name;
  const amount = formatEuro(node.value);
  return (
    <g onMouseMove={(e) => onHover(e, `${node.name} : ${amount}`)} onMouseLeave={onLeave}>
      <rect x={x} y={y} width={width} height={height} fill={ROLE_COLORS[node.role]} fillOpacity={0.9} />
      {twoLines ? (
        <>
          <text x={labelX} y={midY - 3} textAnchor={anchor} fontSize={11} fill="#3f3f46" {...HALO}>
            {name}
          </text>
          <text x={labelX} y={midY + 10} textAnchor={anchor} fontSize={10} fill="#71717a" {...HALO}>
            {amount}
          </text>
        </>
      ) : (
        <text x={labelX} y={midY + 4} textAnchor={anchor} fontSize={11} fill="#3f3f46" {...HALO}>
          {name}
          {!isMiddle && (
            <tspan fontSize={10} fill="#71717a">
              {"  "}
              {amount}
            </tspan>
          )}
        </text>
      )}
    </g>
  );
}

/** Sankey link: a cubic band, tinted by what the flow carries (income green, expenses red,
 *  épargne violet, reste teal) so a flow can be followed from Budget to its leaf. */
function FlowLinkPath({ link, label, onHover, onLeave }: { link: PlacedLink; label: string } & FlowHover) {
  const { sourceX, sourceY, targetX, targetY } = link;
  const midX = (sourceX + targetX) / 2;
  return (
    <path
      d={`M${sourceX},${sourceY} C${midX},${sourceY} ${midX},${targetY} ${targetX},${targetY}`}
      fill="none"
      stroke={ROLE_COLORS[link.role]}
      strokeOpacity={0.2}
      strokeWidth={Math.max(1, link.width)}
      onMouseMove={(e) => onHover(e, label)}
      onMouseLeave={onLeave}
    />
  );
}

// Room around the bars: the first and last columns carry their labels outside them.
const FLOW_MARGIN = { left: 180, right: 180, top: 12, bottom: 12 };

/** Width of an element, kept current by a ResizeObserver (0 until it is mounted). */
function useElementWidth(el: HTMLElement | null): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return width;
}

/** The money-flow Sankey as plain SVG, laid out by lib/flowLayout.ts (recharts' <Sankey> can't
 *  centre its short columns), with a tooltip that follows the pointer. The height follows the
 *  busiest column. */
function MoneyFlowChart({ flow }: { flow: FlowData }) {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const width = useElementWidth(box);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const height = Math.max(360, busiestColumn(flow) * 40);
  const layout = useMemo(
    () =>
      width > 0
        ? flowLayout(flow, {
            width: width - FLOW_MARGIN.left - FLOW_MARGIN.right,
            height: height - FLOW_MARGIN.top - FLOW_MARGIN.bottom,
            nodeWidth: 12,
            nodePadding: 24,
          })
        : null,
    [flow, width, height],
  );
  const hover: FlowHover = {
    onHover: (e, text) => {
      const r = box?.getBoundingClientRect();
      if (r) setTip({ x: e.clientX - r.left, y: e.clientY - r.top, text });
    },
    onLeave: () => setTip(null),
  };
  return (
    <div ref={setBox} className="relative" style={{ height }}>
      {layout && (
        <svg width={width} height={height}>
          <g transform={`translate(${FLOW_MARGIN.left},${FLOW_MARGIN.top})`}>
            {layout.links.map((l, i) => (
              <FlowLinkPath
                key={i}
                link={l}
                label={`${flow.nodes[l.source].name} → ${flow.nodes[l.target].name} : ${formatEuro(l.value)}`}
                {...hover}
              />
            ))}
            {layout.nodes.map((n, i) => (
              <FlowNode key={i} node={n} {...hover} />
            ))}
          </g>
        </svg>
      )}
      {tip && (
        // Opens away from the nearest edges so it never spills out of the card.
        <div
          className="pointer-events-none absolute whitespace-nowrap rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-800 shadow-sm"
          style={{
            ...(tip.x < width / 2 ? { left: tip.x + 12 } : { right: width - tip.x + 12 }),
            ...(tip.y < height / 2 ? { top: tip.y + 12 } : { bottom: height - tip.y + 12 }),
          }}
        >
          {tip.text}
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((month?: string) => {
    api
      .dashboard(month)
      .then(setData)
      .catch((e) => setError(errorMessage(e)));
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

  const all = data.month === ALL_MONTHS;
  const month = all ? undefined : data.month; // the transaction filter: none for every month
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
          <option value={ALL_MONTHS}>Tous les mois</option>
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

      <BudgetSection budget={data.budget} all={all} />

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
