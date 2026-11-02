import { describe, expect, it } from "vitest";
import {
  classedMessage,
  defaultMode,
  nextActiveIndex,
  pairedMessage,
  conflictsMessage,
  previewMessage,
  queryFromSearch,
  ruleLink,
  suggestionReason,
} from "./triage";

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
  it("previews a rule and warns about the conflicts it would create", () => {
    const paths: Record<number, string> = { 2: "Variable / Courses" };
    const pathOf = (id: number) => paths[id];
    expect(previewMessage({ uncategorized: 3, conflicts: [] }, pathOf)).toBe(
      "classerait 3 opérations sans catégorie",
    );
    expect(previewMessage({ uncategorized: 0, conflicts: [] }, pathOf)).toBe(
      "aucune opération sans catégorie ne correspond",
    );
    expect(
      previewMessage(
        { uncategorized: 3, conflicts: [{ rule_id: 9, pattern: "LECLERC", category_id: 2, count: 2 }] },
        pathOf,
      ),
    ).toBe(
      "classerait 3 opérations sans catégorie ; 2 opérations correspondent aussi à la règle « LECLERC » (Variable / Courses)",
    );
  });
  it("words a conflict in the singular and the plural", () => {
    const pathOf = () => "Variable / Courses";
    expect(conflictsMessage([{ rule_id: 9, pattern: "LECLERC", category_id: 2, count: 1 }], pathOf)).toBe(
      "1 opération correspond aussi à la règle « LECLERC » (Variable / Courses)",
    );
  });
  it("links a rule to the Catégories search and reads the link back", () => {
    expect(ruleLink("CARTE & CO")).toBe("/categories?q=CARTE%20%26%20CO");
    expect(queryFromSearch("?q=CARTE%20%26%20CO")).toBe("CARTE & CO");
    expect(queryFromSearch("")).toBe("");
  });
});

describe("pairedMessage", () => {
  it("names both legs with their account", () => {
    expect(
      pairedMessage(
        { libelle: "VIR vers LOGEMENT", account_id: "PERSO" },
        { libelle: "VIR de MOI MEME", account_id: "LOCATIF" },
      ),
    ).toBe("Virement associé : VIR vers LOGEMENT (PERSO) ↔ VIR de MOI MEME (LOCATIF)");
  });
});
