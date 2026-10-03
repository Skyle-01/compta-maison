import { describe, expect, it } from "vitest";
import type { Category } from "./api";
import {
  classedMessage,
  defaultMode,
  fold,
  fuzzyScore,
  leafCategories,
  nextActiveIndex,
  previewMessage,
  searchCategories,
  suggestionReason,
} from "./triage";

const cat = (id: number, path: string, parent_id: number | null = null): Category => ({
  id,
  name: path.split(" / ").at(-1) as string,
  parent_id,
  path,
  is_root: parent_id == null,
  rule_count: 0,
  budget_target: null,
});

const CATEGORIES = [
  cat(1, "Variable"),
  cat(2, "Variable / Courses", 1),
  cat(3, "Variable / Sport", 1),
  cat(4, "Épargne"),
  cat(5, "Fixe"),
  cat(6, "Fixe / Assurance", 5),
];

describe("fuzzyScore", () => {
  it("matches characters in order, ignoring case and accents", () => {
    expect(fold("Épargne")).toBe("epargne");
    expect(fuzzyScore("epa", "Épargne")).not.toBeNull();
    expect(fuzzyScore("vsp", "Variable / Sport")).not.toBeNull();
    expect(fuzzyScore("psv", "Variable / Sport")).toBeNull();
  });
  it("scores word starts and adjacent characters higher", () => {
    expect(fuzzyScore("sp", "Variable / Sport")!).toBeGreaterThan(fuzzyScore("ar", "Variable / Sport")!);
    expect(fuzzyScore("cou", "Variable / Courses")!).toBeGreaterThan(fuzzyScore("cus", "Variable / Courses")!);
  });
});

describe("searchCategories", () => {
  const leaves = leafCategories(CATEGORIES);
  it("keeps leaves only, a childless top-level category included", () => {
    expect(leaves.map((c) => c.id)).toEqual([2, 3, 4, 6]);
  });
  it("ranks the best match first", () => {
    expect(searchCategories("sport", leaves).map((c) => c.id)).toEqual([3]);
    expect(searchCategories("as", leaves)[0].id).toBe(6); // « Assurance » starts with it
    expect(searchCategories("", leaves).map((c) => c.id)).toEqual([4, 6, 2, 3]); // by path, accents folded (Épargne before Fixe)
  });
});

describe("defaultMode", () => {
  it("is a rule for a group, manual for a lone operation or a generic pattern", () => {
    expect(defaultMode({ count: 3, pattern_generic: false })).toBe("rule");
    expect(defaultMode({ count: 1, pattern_generic: false })).toBe("manual");
    expect(defaultMode({ count: 3, pattern_generic: true })).toBe("manual");
  });
});

describe("nextActiveIndex", () => {
  it("follows the next group, else keeps the position", () => {
    expect(nextActiveIndex(["a", "c", "d"], "c", 1)).toBe(1);
    expect(nextActiveIndex(["c", "d"], "d", 1)).toBe(1);
    expect(nextActiveIndex(["a", "b"], "gone", 5)).toBe(1);
    expect(nextActiveIndex(["a"], null, 0)).toBe(0);
    expect(nextActiveIndex([], null, 3)).toBe(0);
  });
});

describe("messages", () => {
  it("agrees with the count", () => {
    expect(classedMessage(1, "Fixe / Assurance")).toBe("1 opération classée en Fixe / Assurance");
    expect(classedMessage(5, "Variable / Sport")).toBe("5 opérations classées en Variable / Sport");
    expect(suggestionReason(4, "BOULANGERIE")).toBe("comme 4 opérations « BOULANGERIE » déjà classées");
    expect(suggestionReason(1, null)).toBe("comme 1 opération similaire déjà classée");
  });
  it("previews a rule and warns about rows taken from other rules", () => {
    const pathOf = (id: number) => CATEGORIES.find((c) => c.id === id)!.path;
    expect(previewMessage({ uncategorized: 3, reclassified: [] }, pathOf)).toBe(
      "classerait 3 opérations sans catégorie",
    );
    expect(previewMessage({ uncategorized: 0, reclassified: [] }, pathOf)).toBe(
      "aucune opération sans catégorie ne correspond",
    );
    expect(
      previewMessage(
        { uncategorized: 3, reclassified: [{ rule_id: 9, pattern: "LECLERC", category_id: 2, count: 2 }] },
        pathOf,
      ),
    ).toBe("3 sans catégorie + 2 déjà classées par la règle « LECLERC » (Variable / Courses) seraient reclassées");
  });
});
