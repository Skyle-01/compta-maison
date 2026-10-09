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

/** The budget's balance, monthly: reference income − Σ spending caps − savings goal = the margin
 *  left unbudgeted (negative: the targets promise more than comes in). Rounded to the cent. */
export function budgetMargin(income: number, spendingTargets: number, savingsTarget: number | null): number {
  return Math.round((income - spendingTargets - (savingsTarget ?? 0)) * 100) / 100;
}

/** The Catégories page's targets, monthly: Σ of the spending caps (one per branch) and the savings
 *  goal (the target of the top-level `savingsGroup` category; nothing below it, nor in Déficit,
 *  holds one). */
export function categoryTargets(
  cats: {
    name: string;
    parent_id: number | null;
    budget_target: number | null;
  }[],
  savingsGroup = "Épargne",
): { spending: number; savings: number | null } {
  let spending = 0;
  let savings: number | null = null;
  for (const c of cats) {
    if (c.budget_target == null) continue;
    if (c.parent_id == null && c.name === savingsGroup) savings = c.budget_target;
    else spending += c.budget_target;
  }
  return { spending: Math.round(spending * 100) / 100, savings };
}
