import { ALL_MONTHS, frenchMonth } from "@/lib/api";

/** The month picker of the month pages; partial months are flagged, `withAll` adds « Tous les mois ». */
export default function MonthSelect({
  value,
  available,
  partial,
  onChange,
  withAll,
}: {
  value: string;
  available: string[];
  partial: string[];
  onChange: (month: string) => void;
  withAll?: boolean;
}) {
  return (
    <select
      className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Mois affiché"
    >
      {withAll && <option value={ALL_MONTHS}>Tous les mois</option>}
      {available.map((m) => (
        <option key={m} value={m}>
          {frenchMonth(m)}
          {partial.includes(m) ? " (partiel)" : ""}
        </option>
      ))}
    </select>
  );
}
