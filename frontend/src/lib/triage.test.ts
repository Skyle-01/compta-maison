import { describe, expect, it } from "vitest";
import {
  amountSummary,
  classedMessage,
  defaultMode,
  manualScope,
  nextActiveIndex,
  pairedMessage,
  conflictsMessage,
  previewMessage,
  queryFromSearch,
  ruleLink,
  sortGroups,
  splitIncomplete,
  suggestionReason,
} from "./triage";
import type { Transaction, UncategorizedGroup } from "./api";

const tx = (id: number, debit: number, credit = 0) => ({ id, debit, credit }) as Transaction;
// Intl's fr-FR output uses (narrow) no-break spaces; compare with plain ones.
const plain = (s: string) => s.replace(/[  ]/g, " ");

describe("manualScope", () => {
  const group = { transactions: [tx(1, 5), tx(2, 5), tx(3, 8)] };

  it("is the whole group without a selection", () => {
    expect(manualScope(group, []).map((t) => t.id)).toEqual([1, 2, 3]);
  });

  it("is the ticked operations, in the group's order", () => {
    expect(manualScope(group, [2]).map((t) => t.id)).toEqual([2]);
    expect(manualScope(group, [3, 1]).map((t) => t.id)).toEqual([1, 3]);
  });

  it("ignores ticked operations that left the group, and falls back to the group when none is left", () => {
    expect(manualScope(group, [2, 99]).map((t) => t.id)).toEqual([2]);
    expect(manualScope(group, [99]).map((t) => t.id)).toEqual([1, 2, 3]);
  });
});

describe("splitIncomplete", () => {
  it("needs a category and a positive amount, comma or point", () => {
    expect(splitIncomplete(null)).toBe(false);
    expect(splitIncomplete({ category_id: 4, amount: "12,5" })).toBe(false);
    expect(splitIncomplete({ category_id: 4, amount: "12.5" })).toBe(false);
    expect(splitIncomplete({ category_id: null, amount: "12" })).toBe(true);
    expect(splitIncomplete({ category_id: 4, amount: "" })).toBe(true);
    expect(splitIncomplete({ category_id: 4, amount: "abc" })).toBe(true);
    expect(splitIncomplete({ category_id: 4, amount: "-3" })).toBe(true);
  });
});

describe("amountSummary", () => {
  it("shows the amount of a lone operation", () => {
    expect(plain(amountSummary([tx(1, 12)]))).toBe("-12,00 €");
    expect(plain(amountSummary([tx(1, 0, 30)]))).toBe("30,00 €");
  });

  it("repeats equal amounts instead of summing them", () => {
    expect(plain(amountSummary([tx(1, 12), tx(2, 12), tx(3, 12)]))).toBe("3 × -12,00 €");
  });

  it("gives the range of different amounts, signs included", () => {
    expect(plain(amountSummary([tx(1, 5), tx(2, 40)]))).toBe("de -40,00 € à -5,00 €");
    expect(plain(amountSummary([tx(1, 5), tx(2, 0, 20)]))).toBe("de -5,00 € à 20,00 €");
  });
});

describe("sortGroups", () => {
  const group = (key: string, last_date: string) => ({ key, last_date }) as UncategorizedGroup;
  const groups = [group("big", "2026-05-02"), group("recent", "2026-06-20"), group("small", "2026-05-02")];

  it("keeps the API amount order", () => {
    expect(sortGroups(groups, "amount").map((g) => g.key)).toEqual(["big", "recent", "small"]);
  });

  it("puts the most recent operation first, ties in amount order", () => {
    expect(sortGroups(groups, "date").map((g) => g.key)).toEqual(["recent", "big", "small"]);
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
