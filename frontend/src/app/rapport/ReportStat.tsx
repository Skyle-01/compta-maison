import { formatEuro } from "@/lib/api";
import Gap from "@/components/Gap";

/** A card of the month with its average and the gap between them. */
export default function ReportStat({
  label,
  value,
  average,
  goodIsUp,
  valueClass,
}: {
  label: string;
  value: number;
  average: number | null;
  goodIsUp: boolean;
  valueClass: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3">
      <div className="text-sm text-zinc-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${valueClass}`}>{formatEuro(value)}</div>
      {average !== null && (
        <div className="mt-1 text-xs text-zinc-500">
          moyenne {formatEuro(average)} · <Gap month={value} average={average} goodIsUp={goodIsUp} />
        </div>
      )}
    </div>
  );
}
