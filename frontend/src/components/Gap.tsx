import { formatEuro } from "@/lib/api";
import { averageGap, type GapTone, gapTone } from "@/lib/averages";

const GAP_TEXT: Record<GapTone, string> = {
  good: "text-green-700",
  bad: "text-red-700",
  flat: "text-zinc-500",
};

/** The displayed month minus the average ("+120,00 €"), green or red by `goodIsUp` unless a
 *  `className` sets its colour; nothing when there is no month to compare with or no money either way. */
export default function Gap({
  month,
  average,
  goodIsUp = true,
  className,
  wrap = false,
}: {
  month: number | null;
  average: number;
  goodIsUp?: boolean;
  className?: string;
  /** Put the gap between parentheses, after a value it qualifies. */
  wrap?: boolean;
}) {
  const gap = averageGap(month, average);
  if (gap === null || (month === 0 && average === 0)) return null;
  const sign = gap > 0.005 ? "+" : gap < -0.005 ? "−" : "";
  const text = sign + formatEuro(Math.abs(gap));
  return <span className={className ?? GAP_TEXT[gapTone(gap, goodIsUp)]}>{wrap ? `(${text})` : text}</span>;
}
