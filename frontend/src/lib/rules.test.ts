import { describe, expect, it } from "vitest";
import type { Category, Rule, RuleIssue } from "./api";
import {
  emptyFilters,
  filterRules,
  issueLabel,
  issueTooltip,
  narrowToPair,
  pairIds,
  pairLabel,
  rulesPageLink,
  sortRules,
  subtreeIds,
} from "./rules";

function cat(id: number, name: string, parent_id: number | null, path = name): Category {
  return { id, name, parent_id, path, is_root: parent_id == null, rule_count: 0, budget_target: null };
}

function rule(id: number, category_id: number, pattern: string, fields: Partial<Rule> = {}): Rule {
  return {
    id,
    category_id,
    pattern,
    is_income_anchor: false,
    description: null,
    account_id: null,
    operation_count: 0,
    debit: 0,
    credit: 0,
    conflicts: [],
    ...fields,
  };
}

const issue = (kind: RuleIssue["kind"], fields: Partial<RuleIssue> = {}): RuleIssue => ({
  kind,
  rule_ids: [],
  count: 0,
  masked: false,
  ...fields,
});

// Fixe (1) > Énergie (2); Courses (3) is a top-level leaf.
const categories = [cat(1, "Fixe", null), cat(2, "Énergie", 1, "Fixe / Énergie"), cat(3, "Courses", null)];
const rules = [
  rule(1, 2, "EDF CLIENTS", { operation_count: 2 }),
  rule(2, 2, "EDF", { account_id: "PERSO", description: "Électricité", operation_count: 9 }),
  rule(3, 3, "école", { account_id: "JOINT" }),
  rule(4, 3, "Ecole des fans"),
];
const ids = (list: Rule[]) => list.map((r) => r.id);

describe("rulesPageLink", () => {
  it("puts the encoded pattern in ?q=", () => {
    expect(rulesPageLink("EDF & Cie")).toBe("/regles?q=EDF%20%26%20Cie");
  });
});

describe("subtreeIds", () => {
  it("holds the category and everything below it", () => {
    expect([...subtreeIds(categories, 1)].sort()).toEqual([1, 2]);
    expect([...subtreeIds(categories, 2)]).toEqual([2]);
  });
});

describe("filterRules", () => {
  const none = {};
  it("keeps every rule without a filter", () => {
    expect(ids(filterRules(rules, categories, none, emptyFilters()))).toEqual([1, 2, 3, 4]);
  });

  it("searches pattern, description and category path, accents and case ignored", () => {
    const search = (query: string) => ids(filterRules(rules, categories, none, { ...emptyFilters(), query }));
    expect(search("ecole")).toEqual([3, 4]);
    expect(search("ELECTRICITE")).toEqual([2]);
    expect(search("fixe / energie")).toEqual([1, 2]);
    expect(search("  ")).toEqual([1, 2, 3, 4]);
    expect(search("rien")).toEqual([]);
  });

  it("keeps the rules of the account and the global ones", () => {
    const filters = { ...emptyFilters(), account: "PERSO" };
    expect(ids(filterRules(rules, categories, none, filters))).toEqual([1, 2, 4]);
  });

  it("takes a group's whole subtree for the category filter", () => {
    expect(ids(filterRules(rules, categories, none, { ...emptyFilters(), category: 1 }))).toEqual([1, 2]);
    expect(ids(filterRules(rules, categories, none, { ...emptyFilters(), category: 3 }))).toEqual([3, 4]);
  });

  it("filters on any problem or on one kind", () => {
    const issues = { 2: [issue("redundant", { rule_ids: [1] })], 4: [issue("unused"), issue("conflict")] };
    const by = (problem: "any" | RuleIssue["kind"]) =>
      ids(filterRules(rules, categories, issues, { ...emptyFilters(), problem }));
    expect(by("any")).toEqual([2, 4]);
    expect(by("unused")).toEqual([4]);
    expect(by("shadowed")).toEqual([]);
  });

  it("combines the filters", () => {
    const filters = { ...emptyFilters(), query: "edf", account: "PERSO", category: 2 };
    expect(ids(filterRules(rules, categories, none, filters))).toEqual([1, 2]);
  });
});

describe("sortRules", () => {
  it("sorts by pattern with accents and case folded, so overlapping patterns sit together", () => {
    expect(ids(sortRules(rules, categories, "pattern"))).toEqual([3, 4, 2, 1]);
    const overlapping = [rule(7, 2, "EDF CLIENTS"), rule(8, 3, "ZZ"), rule(9, 2, "edf")];
    expect(ids(sortRules(overlapping, categories, "pattern"))).toEqual([9, 7, 8]);
  });

  it("sorts by category path, then pattern", () => {
    const mixed = [rule(7, 2, "A"), rule(8, 3, "Z"), rule(9, 3, "B")];
    expect(ids(sortRules(mixed, categories, "category"))).toEqual([9, 8, 7]);
  });

  it("sorts by account with the rules of every account first", () => {
    expect(ids(sortRules(rules, categories, "account"))).toEqual([4, 1, 3, 2]);
  });

  it("sorts by operations, most first", () => {
    expect(ids(sortRules(rules, categories, "operations"))).toEqual([2, 1, 3, 4]);
  });

  it("does not change its input", () => {
    const copy = [...rules];
    sortRules(rules, categories, "operations");
    expect(rules).toEqual(copy);
  });
});

describe("pair view", () => {
  it("lists the rule then the rules its issue refers to", () => {
    expect(pairIds(4, issue("conflict", { rule_ids: [1, 2] }))).toEqual([4, 1, 2]);
  });

  it("narrows the rules to the pair, in list order, and names them", () => {
    expect(ids(narrowToPair(rules, [4, 1]))).toEqual([1, 4]);
    expect(pairLabel(rules, [4, 1])).toBe("EDF CLIENTS, Ecole des fans");
  });
});

describe("badge texts", () => {
  const patternOf = (id: number) => (id === 1 ? "EDF" : `#${id}`);

  it("labels a shadowed rule as masked only when it keeps no operation", () => {
    expect(issueLabel(issue("shadowed", { masked: true }))).toBe("Masquée");
    expect(issueLabel(issue("shadowed"))).toBe("En partie masquée");
    expect(issueLabel(issue("duplicate"))).toBe("Doublon");
  });

  it("names the other rules and counts the operations", () => {
    expect(issueTooltip(issue("conflict", { rule_ids: [1], count: 1 }), patternOf)).toContain("1 opération correspond ");
    expect(issueTooltip(issue("conflict", { rule_ids: [1], count: 3 }), patternOf)).toContain("3 opérations correspondent");
    expect(issueTooltip(issue("shadowed", { rule_ids: [1], count: 2 }), patternOf)).toContain("2 opérations vont à");
    expect(issueTooltip(issue("shadowed", { rule_ids: [1], count: 1 }), patternOf)).toContain("1 opération va à");
    expect(issueTooltip(issue("redundant", { rule_ids: [1, 5] }), patternOf)).toContain("« EDF », « #5 »");
    expect(issueTooltip(issue("unused"), patternOf)).toBe("Cette règle ne classe aucune opération.");
  });
});
