import { formatEuro } from "@/lib/api";
import Gap from "@/components/Gap";
import { CARD_TEXT } from "@/components/tableStyles";
import type { MonthCard } from "@/lib/report";

/** A card of the month with its average and the gap between them. */
export default function ReportStat({ card }: { card: MonthCard }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3">
      <div className="text-sm text-zinc-500">{card.label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${CARD_TEXT[card.tone]}`}>
        {formatEuro(card.value)}
      </div>
      {card.average !== null && (
        <div className="mt-1 text-xs text-zinc-500">
          moyenne {formatEuro(card.average)} ·{" "}
          <Gap month={card.value} average={card.average} goodIsUp={card.goodIsUp} />
        </div>
      )}
    </div>
  );
}
