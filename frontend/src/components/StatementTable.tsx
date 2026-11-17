import { Fragment } from "react";
import type { CategoryAverages, MonthTotals } from "@/lib/api";
import { buildStatement, isFilling, notable, type StatementRow, type StatementSection } from "@/lib/report";
import { monthTick } from "@/lib/trend";
import { cell, CURRENT_COLUMN, highlight, NUM } from "./tableStyles";

const SECTION_COLOR: Record<StatementSection["kind"], string> = {
  income: "text-green-700",
  expenses: "text-red-700",
  savings: "text-violet-700",
};

/** A statement line: the label, one amount per month (the reference month shaded, and highlighted
 *  when notable if `goodIsUp` is given), the average. `current` is that column, -1 for none. */
function StatementLine({
  row,
  current,
  filling,
  className = "border-b border-zinc-100",
  labelClass = "pl-3",
  amountClass,
  goodIsUp,
}: {
  row: StatementRow;
  current: number;
  filling: boolean;
  className?: string;
  labelClass?: string;
  amountClass?: (value: number) => string;
  goodIsUp?: boolean;
}) {
  return (
    <tr className={className}>
      <td className={`py-1 pr-2 ${row.muted ? "text-zinc-500" : ""} ${labelClass}`}>{row.label}</td>
      {row.values.map((v, i) => (
        <td
          key={i}
          className={`${NUM} ${i === current ? CURRENT_COLUMN : ""} ${amountClass?.(v) ?? ""} ${
            i === current && goodIsUp !== undefined ? highlight(notable(v, row.average, goodIsUp, null, filling)) : ""
          }`}
        >
          {cell(v)}
        </td>
      ))}
      <td className={`${NUM} border-l border-zinc-200 font-medium ${amountClass?.(row.average ?? 0) ?? ""}`}>
        {cell(row.average)}
      </td>
    </tr>
  );
}

/** The last months side by side, a household income statement. `columns` are the averages payloads
 *  of the months, oldest first; `reference` tells whether the last one is the month the reader is
 *  looking at (shaded, its notable amounts in bold) or just the latest of several. */
export default function StatementTable({
  columns,
  history,
  reference,
}: {
  columns: CategoryAverages[];
  history: MonthTotals[];
  reference: boolean;
}) {
  const statement = buildStatement(columns, history);
  const last = statement.months.length - 1;
  const current = reference ? last : -1;
  const average = columns[last];
  const filling = isFilling(average);
  const span = statement.months.length + 2;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-zinc-300 text-zinc-500">
          <th className="py-1 text-left font-normal" />
          {statement.months.map((m, i) => (
            <th key={m} className={`${NUM} font-normal ${i === current ? CURRENT_COLUMN : ""}`}>
              {monthTick(m)}
              <div className="text-xs">{m.slice(0, 4)}</div>
            </th>
          ))}
          <th className={`${NUM} border-l border-zinc-200 font-normal`}>
            Moyenne
            <div className="text-xs">{average.months > 0 ? `${average.months} mois` : "aucun mois clos"}</div>
          </th>
        </tr>
      </thead>
      <tbody>
        {statement.sections.map((section) => (
          <Fragment key={section.title}>
            <tr>
              <td colSpan={span} className={`pb-1 pt-3 font-semibold ${SECTION_COLOR[section.kind]}`}>
                {section.title}
              </td>
            </tr>
            {section.rows.map((row, i) => (
              <StatementLine
                key={row.key}
                row={row}
                current={current}
                filling={filling}
                className={`border-b border-zinc-100 ${i % 2 === 1 ? "bg-zinc-50" : ""}`}
                goodIsUp={row.muted ? undefined : section.kind !== "expenses"}
              />
            ))}
            <StatementLine
              row={section.total}
              current={current}
              filling={filling}
              className="border-b border-zinc-300 font-semibold"
              labelClass=""
            />
          </Fragment>
        ))}
        <tr>
          <td colSpan={span} className="pt-3" />
        </tr>
        <StatementLine
          row={statement.reste}
          current={current}
          filling={filling}
          className="border-y-2 border-zinc-300 font-semibold"
          labelClass=""
          amountClass={(v) => (v >= 0 ? "text-green-700" : "text-red-700")}
        />
      </tbody>
    </table>
  );
}
