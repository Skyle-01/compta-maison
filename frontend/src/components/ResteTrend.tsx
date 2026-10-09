"use client";

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
import { type MonthTotals, formatEuro, frenchMonth } from "@/lib/api";
import { monthTick, trendTicks, trendValueLabels } from "@/lib/trend";

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
 *  a red tint below it so a deficit month stands out. With `onSelect` (the dashboard; not the
 *  printed report) a click anywhere on the chart picks the month under the tooltip. */
export default function ResteTrend({
  history,
  current,
  onSelect,
}: {
  history: MonthTotals[];
  current: string;
  onSelect?: (month: string) => void;
}) {
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
      <div className="mb-1 flex items-baseline justify-between text-sm text-zinc-500">
        <span>Reste mois par mois</span>
        {onSelect && <span className="text-xs print:hidden">Cliquez sur un mois pour l’afficher</span>}
      </div>
      <ResponsiveContainer width="100%" height={112}>
        <LineChart
          data={history}
          margin={{ top: 18, right: 8, bottom: 0, left: 28 }}
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
