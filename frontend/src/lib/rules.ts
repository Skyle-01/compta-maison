import type { Category, Rule, RuleIssue } from "./api";
import { fold } from "./categorySearch";

/** Pure helpers of the « Règles » page: search, filters, sort, the pair view and the badge texts. */

export type RuleSort = "pattern" | "category" | "account" | "operations";

/** "" = every rule, "any" = a rule with at least one problem, else one kind of problem. */
export type ProblemFilter = "" | "any" | RuleIssue["kind"];

export type RuleFilters = {
  query: string;
  /** An account code: its rules plus the global ones that apply to it. "" = every account. */
  account: string;
  /** A category id; a group takes its whole subtree. null = every category. */
  category: number | null;
  problem: ProblemFilter;
};

export const emptyFilters = (): RuleFilters => ({ query: "", account: "", category: null, problem: "" });

export const SORT_LABELS: Record<RuleSort, string> = {
  pattern: "Motif",
  category: "Catégorie",
  account: "Compte",
  operations: "Opérations",
};

export const PROBLEM_LABELS: Record<RuleIssue["kind"], string> = {
  duplicate: "Doublon",
  redundant: "Redondante",
  conflict: "Conflit",
  shadowed: "Masquée",
  unused: "Inutilisée",
};

/** Link to a rule on the Règles page: it opens with the pattern in the search box. */
export function rulesPageLink(pattern: string): string {
  return `/regles?q=${encodeURIComponent(pattern)}`;
}

/** The id of `categoryId` and of everything below it. */
export function subtreeIds(categories: Category[], categoryId: number): Set<number> {
  const ids = new Set([categoryId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of categories) {
      if (c.parent_id != null && ids.has(c.parent_id) && !ids.has(c.id)) {
        ids.add(c.id);
        grew = true;
      }
    }
  }
  return ids;
}

const pathOf = (byId: Map<number, Category>, rule: Rule): string => {
  const c = byId.get(rule.category_id);
  return c ? c.path || c.name : "";
};

/** The rules matching the search (pattern, description or category path, accents and case ignored)
 *  and the three filters. `issues` = the problems by rule id. */
export function filterRules(
  rules: Rule[],
  categories: Category[],
  issues: Record<number, RuleIssue[]>,
  filters: RuleFilters,
): Rule[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const q = fold(filters.query.trim());
  const inCategory = filters.category != null ? subtreeIds(categories, filters.category) : null;
  return rules.filter((rule) => {
    if (q && !fold(`${rule.pattern} ${rule.description ?? ""} ${pathOf(byId, rule)}`).includes(q)) return false;
    if (filters.account && rule.account_id != null && rule.account_id !== filters.account) return false;
    if (inCategory && !inCategory.has(rule.category_id)) return false;
    const found = issues[rule.id] ?? [];
    if (filters.problem === "any") return found.length > 0;
    if (filters.problem) return found.some((issue) => issue.kind === filters.problem);
    return true;
  });
}

/** The rules sorted, ties by pattern then id. Pattern, category and account go A to Z (a rule of
 *  every account first), operations from the most to the fewest. */
export function sortRules(rules: Rule[], categories: Category[], sort: RuleSort): Rule[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const text = (a: string, b: string) => fold(a).localeCompare(fold(b), "fr");
  const byPattern = (a: Rule, b: Rule) => text(a.pattern, b.pattern) || a.id - b.id;
  const compare = {
    pattern: byPattern,
    category: (a: Rule, b: Rule) => text(pathOf(byId, a), pathOf(byId, b)) || byPattern(a, b),
    account: (a: Rule, b: Rule) => text(a.account_id ?? "", b.account_id ?? "") || byPattern(a, b),
    operations: (a: Rule, b: Rule) => b.operation_count - a.operation_count || byPattern(a, b),
  }[sort];
  return [...rules].sort(compare);
}

/** The pair view of a badge: the rule and the other rules its issue refers to. */
export const pairIds = (ruleId: number, issue: RuleIssue): number[] => [ruleId, ...issue.rule_ids];

/** `rules` reduced to those of a pair view, in the order they come. */
export function narrowToPair(rules: Rule[], ids: number[]): Rule[] {
  const wanted = new Set(ids);
  return rules.filter((rule) => wanted.has(rule.id));
}

/** The one-line summary of a pair view, for its removable chip: « EDF, EDF CLIENTS ». */
export function pairLabel(rules: Rule[], ids: number[]): string {
  return narrowToPair(rules, ids)
    .map((rule) => rule.pattern)
    .join(", ");
}

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;

/** The badge text of an issue. */
export function issueLabel(issue: RuleIssue): string {
  if (issue.kind === "shadowed") return issue.masked ? "Masquée" : "En partie masquée";
  return PROBLEM_LABELS[issue.kind];
}

/** The badge tooltip: what the issue means, naming the other rules (`patternOf` gives a rule's
 *  pattern). A test on the patterns never says that deleting the rule is harmless. */
export function issueTooltip(issue: RuleIssue, patternOf: (id: number) => string): string {
  const others = issue.rule_ids.map((id) => `« ${patternOf(id)} »`).join(", ");
  switch (issue.kind) {
    case "duplicate":
      return `Même motif, même compte et même catégorie que ${others}, créée avant elle.`;
    case "redundant":
      return `Tout ce qu'elle classe correspond aussi à ${others}, de la même catégorie : les deux règles se recouvrent.`;
    case "conflict":
      return `${plural(issue.count, "opération")} ${issue.count > 1 ? "correspondent" : "correspond"} aussi à ${others}, d'une autre catégorie : ${issue.count > 1 ? "elles restent" : "elle reste"} sans catégorie.`;
    case "shadowed":
      return `${issue.masked ? "Toutes ses opérations" : plural(issue.count, "opération")} ${issue.masked || issue.count > 1 ? "vont" : "va"} à ${others}, règle d'un compte : une règle d'un compte l'emporte sur une règle de tous les comptes.`;
    case "unused":
      return "Cette règle ne classe aucune opération.";
  }
}
