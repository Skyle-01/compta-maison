"use client";

import {
  Bar,
  BarChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { type MonthTotals, formatEuro, frenchMonth } from "@/lib/api";
import { averageLabel, monthTick, trendTicks, trendValueLabels } from "@/lib/trend";

interface TrendBarProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: MonthTotals;
}

const TREND_TEAL = "#0d9488";
const TREND_TEAL_LIGHT = "#5eead4";
const TREND_RED = "#dc2626";
const TREND_RED_LIGHT = "#fca5a5";
const AVERAGE_STROKE = "#52525b";

/** A month's bar: the current month in full colour, the others lighter, deficit months red; the
 *  month still filling (`latest`) is outlined with a dashed border, its Reste being provisional.
 *  The months picked by `trendValueLabels` print their amount above the bar (below a deficit). */
function TrendBar({
  x,
  y,
  width,
  height,
  payload,
  current,
  latest,
  labelled,
}: TrendBarProps & { current: string; latest?: string; labelled: Set<string> }) {
  if (x === undefined || y === undefined || width === undefined || height === undefined || !payload)
    return null;
  const top = Math.min(y, y + height);
  const h = Math.max(Math.abs(height), 1); // a zero month still shows a sliver
  const isCurrent = payload.month === current;
  const inProgress = payload.month === latest;
  const negative = payload.reste < 0;
  const strong = negative ? TREND_RED : TREND_TEAL;
  const light = negative ? TREND_RED_LIGHT : TREND_TEAL_LIGHT;
  return (
    <g>
      <rect
        x={x}
        y={top}
        width={width}
        height={h}
        rx={2}
        fill={isCurrent ? strong : light}
        fillOpacity={inProgress ? (isCurrent ? 0.5 : 0.35) : 1}
        stroke={inProgress ? strong : "none"}
        strokeWidth={inProgress ? 1.5 : 0}
        strokeDasharray={inProgress ? "3 2" : undefined}
      />
      {labelled.has(payload.month) && (
        <text
          x={x + width / 2}
          y={negative ? top + h + 12 : top - 4}
          textAnchor="middle"
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

/** The hovered month's reconciliation: Revenus − Dépenses − Épargne = Reste. */
function TrendTooltip({
  active,
  payload,
  latest,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: MonthTotals }>;
  latest?: string;
}) {
  const m = payload?.[0]?.payload;
  if (!active || !m) return null;
  const rows: [string, number, string][] = [
    ["Revenus", m.income, "text-green-700"],
    ["Dépenses", -m.expenses, "text-red-700"],
    ["Épargne", -(m.epargne - m.desepargne), "text-violet-700"],
  ];
  return (
    <div className="rounded border border-zinc-200 bg-white px-3 py-2 text-xs shadow-sm">
      <div className="mb-1 font-medium text-zinc-900">
        {frenchMonth(m.month)}
        {m.month === latest && <span className="font-normal text-zinc-500"> (en cours)</span>}
      </div>
      <table className="tabular-nums">
        <tbody>
          {rows.map(([label, value, cls]) => (
            <tr key={label}>
              <td className="pr-4 text-zinc-500">{label}</td>
              <td className={`text-right ${cls}`}>{formatEuro(value)}</td>
            </tr>
          ))}
          <tr className="border-t border-zinc-200 font-medium">
            <td className="pr-4 pt-0.5 text-zinc-700">Reste</td>
            <td className={`pt-0.5 text-right ${m.reste < 0 ? "text-red-700" : "text-green-700"}`}>
              {formatEuro(m.reste)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** A compact reste-by-month bar chart so the current month reads in context: short month ticks,
 *  the current month's amount (the extremes in the "Tous les mois" view), a labelled zero line, a
 *  red tint below it so a deficit month stands out, the `average` Reste as a dashed line and the
 *  month still filling (`latest`) outlined. With `onSelect` (the dashboard; not the printed report)
 *  a click anywhere on the chart picks the month under the tooltip. */
export default function ResteTrend({
  history,
  current,
  latest,
  average = null,
  averageMonths = 0,
  onSelect,
}: {
  history: MonthTotals[];
  current: string;
  /** The latest budget month overall, still filling until the next paycheck. */
  latest?: string;
  /** The average Reste over the latest complete months (12 at most), null when there is none. */
  average?: number | null;
  /** How many complete months `average` spans, for its legend. */
  averageMonths?: number;
  onSelect?: (month: string) => void;
}) {
  if (history.length < 2) return null;
  const values = history.map((h) => h.reste).concat(average ?? []);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;
  // Headroom for the value labels: above the top bar, and below a deficit (labelled underneath).
  const domain = [min < 0 ? min - range * 0.3 : 0, max + range * 0.12];
  const labelled = trendValueLabels(history, current);
  const showsLatest = history.some((h) => h.month === latest);
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4 text-sm text-zinc-500">
        <span>Reste mois par mois</span>
        <span className="flex flex-wrap items-center gap-x-4 text-xs">
          {average !== null && (
            <span className="flex items-center gap-1.5">
              <svg width="16" height="6" aria-hidden="true">
                <line x1="0" y1="3" x2="16" y2="3" stroke={AVERAGE_STROKE} strokeDasharray="4 3" />
              </svg>
              {averageLabel(averageMonths)} : {formatEuro(average)}
            </span>
          )}
          {showsLatest && (
            <span className="flex items-center gap-1.5">
              <svg width="10" height="10" aria-hidden="true">
                <rect
                  x="0.75"
                  y="0.75"
                  width="8.5"
                  height="8.5"
                  fill={TREND_TEAL}
                  fillOpacity={0.35}
                  stroke={TREND_TEAL}
                  strokeWidth={1.5}
                  strokeDasharray="3 2"
                />
              </svg>
              mois en cours
            </span>
          )}
          {onSelect && <span className="print:hidden">Cliquez sur un mois pour l’afficher</span>}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <BarChart
          data={history}
          margin={{ top: 18, right: 8, bottom: 0, left: 28 }}
          barCategoryGap="25%"
          style={onSelect ? { cursor: "pointer" } : undefined}
          onClick={
            onSelect
              ? (state) => {
                  const month = history[Number(state.activeIndex)]?.month;
                  if (month && month !== current) onSelect(month);
                }
              : undefined
          }
        >
          <XAxis
            dataKey="month"
            ticks={trendTicks(history, current)}
            tickFormatter={monthTick}
            interval={0}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fill: "#71717a" }}
            height={16}
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
            cursor={{ fill: "#f4f4f5" }}
            isAnimationActive={false}
            content={(props) => (
              <TrendTooltip
                active={props.active}
                payload={props.payload as ReadonlyArray<{ payload?: MonthTotals }>}
                latest={latest}
              />
            )}
          />
          <Bar
            dataKey="reste"
            maxBarSize={40}
            isAnimationActive={false}
            shape={(props: unknown) => (
              <TrendBar {...(props as TrendBarProps)} current={current} latest={latest} labelled={labelled} />
            )}
          />
          {average !== null && (
            <ReferenceLine y={average} stroke={AVERAGE_STROKE} strokeDasharray="4 3" ifOverflow="extendDomain" />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
