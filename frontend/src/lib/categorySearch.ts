import type { Category } from "./api";

/** Category search shared by CategoryPicker and the « À classer » page. */

/** Lower case without accents, so « epa » finds « Épargne ». */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Fuzzy score of `query` against `text`: its characters in order, not necessarily adjacent.
 *  Word starts and runs of adjacent characters score higher; null when `text` doesn't match.
 *  Every occurrence of the first character is tried as a start, so « elec » scores
 *  « Fixe / Électricité » on the word, not on the « e » of « Fixe ». */
export function fuzzyScore(query: string, text: string): number | null {
  const q = fold(query).replace(/\s+/g, "");
  const t = fold(text);
  if (!q) return 0;
  let best: number | null = null;
  for (let start = t.indexOf(q[0]); start !== -1; start = t.indexOf(q[0], start + 1)) {
    const score = scoreFrom(q, t, start);
    if (score == null) break; // a later start can't match either
    if (best == null || score > best) best = score;
  }
  return best;
}

/** Greedy match of `q` in `t`, its first character at `start`. */
function scoreFrom(q: string, t: string, start: number): number | null {
  let score = 0;
  let previous = -2;
  let at = start;
  for (let i = 0; i < q.length; i++) {
    if (i > 0) at = t.indexOf(q[i], previous + 1);
    if (at === -1) return null;
    score += 1;
    if (at === 0 || /[\s/·-]/.test(t[at - 1])) score += 5;
    if (at === previous + 1) score += 3;
    previous = at;
  }
  return score;
}

/** Categories a row can be assigned to: leaves only (no category is parented to them), like the
 *  backend's reject_group_target. */
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
