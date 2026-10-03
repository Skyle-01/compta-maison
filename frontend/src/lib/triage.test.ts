import { describe, expect, it } from "vitest";
import { classedMessage, defaultMode, nextActiveIndex, previewMessage, suggestionReason } from "./triage";

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
    const paths: Record<number, string> = { 2: "Variable / Courses" };
    const pathOf = (id: number) => paths[id];
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
