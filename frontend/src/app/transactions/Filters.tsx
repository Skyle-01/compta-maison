import AccountSelect from "@/components/AccountSelect";
import { useFilters } from "@/components/FiltersProvider";
import PeriodFilter from "@/components/PeriodFilter";
import { transactionsExportUrl } from "@/lib/api";

export default function Filters({
  onlyUncategorized,
  onOnlyUncategorizedChange,
}: {
  onlyUncategorized: boolean;
  onOnlyUncategorizedChange: (checked: boolean) => void;
}) {
  const { monthFilter, account, setAccount } = useFilters();
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
      <PeriodFilter withAll />
      <AccountSelect purpose="filter" value={account} onChange={setAccount} />
      <a
        href={transactionsExportUrl({
          month: monthFilter,
          account: account ?? undefined,
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
