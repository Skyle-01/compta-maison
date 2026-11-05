import { frenchMonth } from "@/lib/api";

/** The month list of `PeriodFilter`; partial months are flagged. */
export default function MonthSelect({
  value,
  available,
  partial,
  onChange,
  disabled,
}: {
  value: string;
  available: string[];
  partial: string[];
  onChange: (month: string) => void;
  disabled?: boolean;
}) {
  return (
    <select
      className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm disabled:bg-zinc-100 disabled:text-zinc-500"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-label="Mois affiché"
    >
      {available.map((m) => (
        <option key={m} value={m}>
          {frenchMonth(m)}
          {partial.includes(m) ? " (partiel)" : ""}
        </option>
      ))}
    </select>
  );
}
