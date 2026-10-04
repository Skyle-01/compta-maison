/** Pure helpers for the dashboard Budget section (spending vs a category's target). */

export type BudgetTone = "ok" | "warn" | "over";

/** Share of the target already spent (0 when there is no target to compare with). */
export function budgetRatio(actual: number, target: number): number {
  return target > 0 ? Math.max(actual, 0) / target : 0;
}

/** Colour band: below 90 % of the target is fine, up to 100 % is a warning, beyond is an overrun. */
export function budgetTone(ratio: number): BudgetTone {
  if (ratio > 1 + 1e-9) return "over";
  if (ratio >= 0.9) return "warn";
  return "ok";
}

/** Bar fill width in percent, capped at 100 (an overrun fills the bar). */
export function barWidth(ratio: number): number {
  return Math.min(100, Math.round(ratio * 1000) / 10);
}

/** Room left under the target (positive) or overrun (negative), rounded to the cent. */
export function budgetLeft(actual: number, target: number): number {
  return Math.round((target - actual) * 100) / 100;
}

/** Parse a target typed on the Catégories page ("300", "12,50", "1 200") into euros; null when empty.
 *  Returns NaN for anything that is not a positive amount. */
export function parseTarget(text: string): number | null {
  const cleaned = text.replace(/[\s  €]/g, "").replace(",", ".");
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 ? value : NaN;
}
