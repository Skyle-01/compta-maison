import { frenchMonth, transactionsExportUrl, type Account } from "@/lib/api";

export default function Filters({
  onlyUncategorized,
  onOnlyUncategorizedChange,
  month,
  months,
  onMonthChange,
  account,
  accounts,
  onAccountChange,
}: {
  onlyUncategorized: boolean;
  onOnlyUncategorizedChange: (checked: boolean) => void;
  month: string;
  months: string[];
  onMonthChange: (month: string) => void;
  account: string;
  accounts: Account[];
  onAccountChange: (code: string) => void;
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
      <select
        className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm"
        value={account}
        onChange={(e) => onAccountChange(e.target.value)}
        aria-label="Compte"
      >
        <option value="">Tous les comptes</option>
        {accounts.map((a) => (
          <option key={a.code} value={a.code}>
            {a.label}
          </option>
        ))}
      </select>
      <a
        href={transactionsExportUrl({
          month: month || undefined,
          account: account || undefined,
          uncategorized: onlyUncategorized,
        })}
        download
        className="btn-secondary"
      >
        Exporter CSV
      </a>
    </div>
  );
}
