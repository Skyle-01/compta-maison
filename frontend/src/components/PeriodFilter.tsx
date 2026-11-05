"use client";

import { useFilters } from "@/components/FiltersProvider";
import MonthSelect from "@/components/MonthSelect";

/** The month filter of every page: the shared month list, « Dernier mois » when another month is
 *  shown and, with `withAll`, « Tous les mois » (ticked: the list is greyed, unticked: the last
 *  picked month comes back). Pages without `withAll` always show `month`. */
export default function PeriodFilter({ withAll = false }: { withAll?: boolean }) {
  const { months, partial, month, all, setMonth, setAll } = useFilters();
  const allMonths = withAll && all;
  const latest = months[0];
  return (
    <div className="flex items-center gap-3">
      {!allMonths && latest && month !== latest && (
        <button type="button" onClick={() => setMonth(latest)} className="btn-secondary">
          Dernier mois
        </button>
      )}
      {withAll && (
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          Tous les mois
        </label>
      )}
      <MonthSelect value={month} available={months} partial={partial} onChange={setMonth} disabled={allMonths} />
    </div>
  );
}
