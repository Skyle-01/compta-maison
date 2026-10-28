import { frenchMonth, transactionsExportUrl } from "@/lib/api";

export default function Filters({
  onlyUncategorized,
  onOnlyUncategorizedChange,
  month,
  months,
  onMonthChange,
}: {
  onlyUncategorized: boolean;
  onOnlyUncategorizedChange: (checked: boolean) => void;
  month: string;
  months: string[];
  onMonthChange: (month: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={onlyUncategorized}
          onChange={(e) => onOnlyUncategorizedChange(e.target.checked)}
        />
        Sans catégorie uniquement
      </label>
      <select
        className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm"
        value={month}
        onChange={(e) => onMonthChange(e.target.value)}
      >
        <option value="">Tous les mois</option>
        {months.map((m) => (
          <option key={m} value={m}>
            {frenchMonth(m)}
          </option>
        ))}
      </select>
      <a
        href={transactionsExportUrl({ month: month || undefined, uncategorized: onlyUncategorized })}
        download
        className="btn-secondary"
      >
        Exporter CSV
      </a>
    </div>
  );
}
