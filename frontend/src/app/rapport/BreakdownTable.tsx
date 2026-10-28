import { Fragment } from "react";
import { formatEuro } from "@/lib/api";
import Gap from "@/components/Gap";
import { type BreakdownGroup, type BreakdownLine, type BreakdownSide, notable } from "@/lib/report";
import { cell, highlight, NUM } from "./tableStyles";

const BAR_COLORS: Record<BreakdownSide, { strong: string; light: string }> = {
  expenses: { strong: "bg-red-500", light: "bg-red-300" },
  income: { strong: "bg-green-600", light: "bg-green-300" },
};

/** A bar scaled to the largest category of the month. */
function Bar({ value, max, side, strong }: { value: number; max: number; side: BreakdownSide; strong?: boolean }) {
  const width = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const colors = BAR_COLORS[side];
  return (
    <div className="h-2 w-full rounded-full bg-zinc-100">
      <div className={`h-2 rounded-full ${strong ? colors.strong : colors.light}`} style={{ width: `${width}%` }} />
    </div>
  );
}

function BreakdownRow({
  line,
  max,
  side,
  group,
  target,
}: {
  line: BreakdownLine;
  max: number;
  side: BreakdownSide;
  group?: boolean;
  /** The target the month is held to: a group's sums only its targeted leaves, so it gets none. */
  target: number | null;
}) {
  const goodIsUp = side === "income";
  return (
    <tr className={group ? "border-t border-zinc-200" : ""}>
      <td className={`py-1 pr-2 ${group ? "font-medium" : "pl-4 text-zinc-700"}`}>{line.name}</td>
      <td className={`${NUM} ${group ? "font-medium" : ""} ${highlight(notable(line.month, line.average, goodIsUp, target))}`}>
        {cell(line.month)}
      </td>
      <td className="w-1/4 px-2">
        <Bar value={line.month} max={max} side={side} strong={group} />
      </td>
      <td className={`${NUM} text-zinc-500`}>{cell(line.average)}</td>
      <td className={NUM}>
        {line.average !== null && <Gap month={line.month} average={line.average} goodIsUp={goodIsUp} />}
      </td>
      {side === "expenses" && (
        <td className={`${NUM} text-zinc-500`}>{line.target === null ? "" : formatEuro(line.target)}</td>
      )}
    </tr>
  );
}

/** The month's spending or income per category and leaf, against the average (and the targets). */
export default function BreakdownTable({
  title,
  groups,
  side,
  empty,
}: {
  title: string;
  groups: BreakdownGroup[];
  side: BreakdownSide;
  empty: string;
}) {
  const max = Math.max(0, ...groups.map((g) => g.month));
  return (
    <section>
      <h3 className="mb-2 font-medium">{title}</h3>
      {groups.length > 0 ? (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-300 text-zinc-500">
              <th className="py-1 text-left font-normal">Catégorie</th>
              <th className={`${NUM} font-normal`}>Ce mois</th>
              <th />
              <th className={`${NUM} font-normal`}>Moyenne</th>
              <th className={`${NUM} font-normal`}>Écart</th>
              {side === "expenses" && <th className={`${NUM} font-normal`}>Objectif</th>}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.id}>
                <BreakdownRow line={g} max={max} side={side} group target={g.target} />
                {g.leaves.map((l) => (
                  <BreakdownRow key={l.id} line={l} max={max} side={side} target={l.target} />
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-zinc-500">{empty}</p>
      )}
    </section>
  );
}
