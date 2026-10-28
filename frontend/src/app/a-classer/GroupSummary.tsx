import { formatEuro, frenchDate, type UncategorizedGroup } from "@/lib/api";
import { operations } from "@/lib/triage";

function dateRange(g: UncategorizedGroup): string {
  return g.first_date === g.last_date
    ? frenchDate(g.first_date)
    : `${frenchDate(g.first_date)} – ${frenchDate(g.last_date)}`;
}

/** The clickable line of a group: its first label, count, dates, accounts, suggestion and net. */
export default function GroupSummary({
  group: g,
  isActive,
  pathOf,
  onSelect,
}: {
  group: UncategorizedGroup;
  isActive: boolean;
  pathOf: (id: number) => string;
  onSelect: () => void;
}) {
  const net = g.credit - g.debit;
  return (
    <div
      onClick={onSelect}
      className={`flex cursor-pointer items-center gap-4 px-3 py-2 text-sm ${isActive ? "" : "hover:bg-zinc-50"}`}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium" title={g.transactions[0].libelle}>
          {g.transactions[0].libelle}
        </div>
        <div className="text-xs text-zinc-500">
          {operations(g.count)} · {dateRange(g)} · {g.accounts.join(", ")}
        </div>
      </div>
      {!isActive && g.suggestion && (
        <span className="truncate text-xs text-zinc-500">→ {pathOf(g.suggestion.category_id)}</span>
      )}
      <span className={`whitespace-nowrap ${net >= 0 ? "text-green-700" : "text-red-700"}`}>{formatEuro(net)}</span>
    </div>
  );
}
