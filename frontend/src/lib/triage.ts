import type { RuleConflict, RulePreview, Transaction, UncategorizedGroup } from "./api";

/** Pure helpers of the « À classer » page: default mode, next active group, messages. */

export type TriageMode = "rule" | "manual";

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

/** « Virement associé : VIR vers LOGEMENT (PERSO) ↔ VIR de MOI MEME (LOCATIF) ». */
export function pairedMessage(
  a: Pick<Transaction, "libelle" | "account_id">,
  b: Pick<Transaction, "libelle" | "account_id">,
): string {
  const leg = (t: Pick<Transaction, "libelle" | "account_id">) => `${t.libelle} (${t.account_id ?? "?"})`;
  return `Virement associé : ${leg(a)} ↔ ${leg(b)}`;
}

/** Why a category is suggested: « comme 4 opérations « BOULANGERIE » déjà classées ». */
export function suggestionReason(count: number, token: string | null): string {
  const s = count > 1 ? "s" : "";
  return `comme ${count} opération${s}${token ? ` « ${token} »` : ` similaire${s}`} déjà classée${s}`;
}

/** « 2 opérations correspondent aussi à la règle « LECLERC » (Variable / Courses) »: the rules of
 *  another category a pattern overlaps (those operations would be left without a category). */
export function conflictsMessage(conflicts: RuleConflict[], pathOf: (categoryId: number) => string): string {
  return conflicts
    .map(
      (c) =>
        `${c.count} opération${c.count > 1 ? "s correspondent" : " correspond"} aussi à la règle « ${c.pattern} » (${pathOf(c.category_id)})`,
    )
    .join(" ; ");
}

/** The rule preview line: what the rule would classify, then the conflicts it would create. */
export function previewMessage(preview: RulePreview, pathOf: (categoryId: number) => string): string {
  const classed =
    preview.uncategorized === 0
      ? "aucune opération sans catégorie ne correspond"
      : `classerait ${operations(preview.uncategorized)} sans catégorie`;
  return preview.conflicts.length === 0 ? classed : `${classed} ; ${conflictsMessage(preview.conflicts, pathOf)}`;
}

/** Link to a rule in Catégories: the page opens with its pattern in the search box. */
export function ruleLink(pattern: string): string {
  return `/categories?q=${encodeURIComponent(pattern)}`;
}

/** The search text of a Catégories URL (`?q=`), empty when absent. */
export function queryFromSearch(search: string): string {
  return new URLSearchParams(search).get("q") ?? "";
}
