import type { Category, RulePreview, UncategorizedGroup } from "./api";

/** Pure helpers of the « À classer » page: category search, default mode, messages. */

export type TriageMode = "rule" | "manual";

/** Lower case without accents, so « epa » finds « Épargne ». */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Fuzzy score of `query` against `text`: its characters in order, not necessarily adjacent.
 *  Word starts and runs of adjacent characters score higher; null when `text` doesn't match. */
export function fuzzyScore(query: string, text: string): number | null {
  const q = fold(query).replace(/\s+/g, "");
  const t = fold(text);
  if (!q) return 0;
  let score = 0;
  let from = 0;
  let previous = -2;
  for (const char of q) {
    const at = t.indexOf(char, from);
    if (at === -1) return null;
    score += 1;
    if (at === 0 || /[\s/·-]/.test(t[at - 1])) score += 5;
    if (at === previous + 1) score += 3;
    previous = at;
    from = at + 1;
  }
  return score;
}

/** Categories a row can be assigned to: leaves only (no category is parented to them), like
 *  CategoryPicker and the backend's reject_group_target. */
export function leafCategories(categories: Category[]): Category[] {
  const parents = new Set(categories.map((c) => c.parent_id).filter((id) => id != null));
  return categories.filter((c) => !parents.has(c.id));
}

/** Leaves matching `query` on their full path, best match first (ties by path). */
export function searchCategories(query: string, leaves: Category[]): Category[] {
  return leaves
    .map((c) => ({ c, score: fuzzyScore(query, c.path || c.name) }))
    .filter((m): m is { c: Category; score: number } => m.score != null)
    .sort((a, b) => b.score - a.score || (a.c.path || a.c.name).localeCompare(b.c.path || b.c.name, "fr"))
    .map((m) => m.c);
}

/** A group of similar operations defaults to a rule, a lone one (or a too generic pattern, which
 *  would swallow unrelated operations) to a one-off manual assignment. */
export function defaultMode(group: Pick<UncategorizedGroup, "count" | "pattern_generic">): TriageMode {
  return group.count >= 2 && !group.pattern_generic ? "rule" : "manual";
}

/** Index of the group to make active after a reload: the one that followed the classed group if
 *  it is still there, else the same position (clamped). */
export function nextActiveIndex(keys: string[], followingKey: string | null, previousIndex: number): number {
  if (keys.length === 0) return 0;
  const found = followingKey == null ? -1 : keys.indexOf(followingKey);
  return found !== -1 ? found : Math.min(previousIndex, keys.length - 1);
}

/** « 1 opération » / « 3 opérations ». */
export function operations(n: number): string {
  return `${n} opération${n > 1 ? "s" : ""}`;
}

/** « 5 opérations classées en Variable / Sport ». */
export function classedMessage(n: number, path: string): string {
  return `${operations(n)} classée${n > 1 ? "s" : ""} en ${path}`;
}

/** Why a category is suggested: « comme 4 opérations « BOULANGERIE » déjà classées ». */
export function suggestionReason(count: number, token: string | null): string {
  const s = count > 1 ? "s" : "";
  return `comme ${count} opération${s}${token ? ` « ${token} »` : ` similaire${s}`} déjà classée${s}`;
}

/** The rule preview line, warning about rows taken from existing rules: « 3 sans catégorie +
 *  2 déjà classées par la règle « LECLERC » (Variable / Courses) seraient reclassées ». */
export function previewMessage(preview: RulePreview, pathOf: (categoryId: number) => string): string {
  if (preview.reclassified.length === 0) {
    return preview.uncategorized === 0
      ? "aucune opération sans catégorie ne correspond"
      : `classerait ${operations(preview.uncategorized)} sans catégorie`;
  }
  const losses = preview.reclassified.map(
    (r) => `${r.count} déjà classée${r.count > 1 ? "s" : ""} par la règle « ${r.pattern} » (${pathOf(r.category_id)})`,
  );
  return `${preview.uncategorized} sans catégorie + ${losses.join(" + ")} seraient reclassées`;
}
