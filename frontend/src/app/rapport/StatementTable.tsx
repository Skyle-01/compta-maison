import { Fragment } from "react";
import type { CategoryAverages, Dashboard } from "@/lib/api";
import { buildStatement, notable, type StatementRow } from "@/lib/report";
import { monthTick } from "@/lib/trend";
import { cell, CURRENT_COLUMN, highlight, NUM } from "./tableStyles";

/** A statement line: the label, one amount per month (the report month shaded, and highlighted
 *  when notable if `goodIsUp` is given), the average. */
function StatementLine({
  row,
  current,
  className = "border-b border-zinc-100",
  labelClass = "pl-3",
  amountClass,
  goodIsUp,
}: {
  row: StatementRow;
  current: number;
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
            i === current && goodIsUp !== undefined ? highlight(notable(v, row.average, goodIsUp)) : ""
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

/** Page 2: the last months side by side, a household income statement. */
export default function StatementTable({
  columns,
  data,
}: {
  columns: CategoryAverages[];
  data: Dashboard;
}) {
  const statement = buildStatement(columns, data.history);
  const current = statement.months.length - 1;
  const average = columns[current];
  const span = statement.months.length + 2;
  const sectionColor: Record<string, string> = {
    Revenus: "text-green-700",
    Dépenses: "text-red-700",
    Épargne: "text-violet-700",
  };
  const goodIsUp: Record<string, boolean> = { Revenus: true, Dépenses: false, Épargne: true };
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-zinc-300 text-zinc-500">
          <th className="py-1 text-left font-normal" />
          {statement.months.map((m, i) => (
            <th key={m} className={`${NUM} font-normal ${i === current ? CURRENT_COLUMN : ""}`}>
              {monthTick(m)}
              <div className="text-[10px]">{m.slice(0, 4)}</div>
            </th>
          ))}
          <th className={`${NUM} border-l border-zinc-200 font-normal`}>
            Moyenne
            <div className="text-[10px]">{average.months > 0 ? `${average.months} mois` : "aucun mois clos"}</div>
          </th>
        </tr>
      </thead>
      <tbody>
        {statement.sections.map((section) => (
          <Fragment key={section.title}>
            <tr>
              <td colSpan={span} className={`pb-1 pt-3 text-sm font-semibold ${sectionColor[section.title] ?? ""}`}>
                {section.title}
              </td>
            </tr>
            {section.rows.map((row, i) => (
              <StatementLine
                key={row.key}
                row={row}
                current={current}
                className={`border-b border-zinc-100 ${i % 2 === 1 ? "bg-zinc-50" : ""}`}
                goodIsUp={row.muted ? undefined : goodIsUp[section.title]}
              />
            ))}
            <StatementLine
              row={section.total}
              current={current}
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
          className="border-y-2 border-zinc-300 text-sm font-semibold"
          labelClass=""
          amountClass={(v) => (v >= 0 ? "text-green-700" : "text-red-700")}
        />
      </tbody>
    </table>
  );
}
