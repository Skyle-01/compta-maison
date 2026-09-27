import { describe, expect, it } from "vitest";
import {
  ApiError,
  errorDetails,
  errorMessage,
  formatEuro,
  frenchDate,
  frenchMonth,
  frenchMonthShort,
  signedAmount,
  statusMessage,
  suggestPattern,
  transactionsExportUrl,
} from "./api";

// Intl's fr-FR output uses (narrow) no-break spaces; compare with plain ones.
const plain = (s: string) => s.replace(/[  ]/g, " ");

describe("formatEuro", () => {
  it("formats French style", () => {
    expect(plain(formatEuro(1234.5))).toBe("1 234,50 €");
    expect(plain(formatEuro(-12))).toBe("-12,00 €");
  });
});

describe("frenchDate", () => {
  it("formats an ISO date the French way", () => {
    expect(frenchDate("2026-09-21")).toBe("21/09/2026");
    expect(frenchDate("2026-01-05")).toBe("05/01/2026");
  });
  it("falls back to the raw value", () => {
    expect(frenchDate("2026-09")).toBe("2026-09");
    expect(frenchDate("")).toBe("");
  });
});

describe("frenchMonth", () => {
  it("names the month and year", () => {
    expect(frenchMonth("2026-06")).toBe("juin 2026");
    expect(frenchMonthShort("2026-02")).toBe("février");
  });
  it("falls back to the raw value", () => {
    expect(frenchMonth("toutes")).toBe("toutes");
    expect(frenchMonthShort("")).toBe("");
  });
});

describe("suggestPattern", () => {
  it("strips the dated card and ATM prefixes", () => {
    expect(suggestPattern("CARTE 26/05 BOULANGERIE DU PORT")).toBe("BOULANGERIE DU PORT");
    expect(suggestPattern("RET DAB 26/05/26 AGENCE CENTRE")).toBe("AGENCE CENTRE");
  });
  it("leaves other labels alone", () => {
    expect(suggestPattern("VIR EMPLOYEUR SALAIRE")).toBe("VIR EMPLOYEUR SALAIRE");
  });
});

describe("errorDetails", () => {
  it("keeps the routers' string details", () => {
    expect(errorDetails("Règle 3 introuvable")).toEqual(["Règle 3 introuvable"]);
    expect(errorDetails(["Ligne 3 : date invalide", "Ligne 7 : montant invalide"])).toEqual([
      "Ligne 3 : date invalide",
      "Ligne 7 : montant invalide",
    ]);
  });
  it("shows a validation error by its msg, not [object Object]", () => {
    const detail = [
      { type: "string_too_short", loc: ["body", "pattern"], msg: "Motif : ne peut pas être vide" },
      "plain",
    ];
    expect(errorDetails(detail)).toEqual(["Motif : ne peut pas être vide", "plain"]);
  });
  it("is empty when there is no detail", () => {
    expect(errorDetails(undefined)).toEqual([]);
    expect(errorDetails("")).toEqual([]);
    expect(errorDetails([])).toEqual([]);
  });
});

describe("errorMessage", () => {
  it("drops the English Error: prefix", () => {
    expect(errorMessage(new ApiError(422, ["a", "b"]))).toBe("a\nb");
    expect(errorMessage(new TypeError("Failed to fetch"))).toBe("Failed to fetch");
  });
  it("stringifies anything else", () => {
    expect(errorMessage("boom")).toBe("boom");
  });
});

describe("statusMessage", () => {
  it("replaces the English status text, pointing at the backend for a server error", () => {
    expect(statusMessage(500)).toBe("Erreur 500 du serveur — le backend est-il démarré ?");
    expect(statusMessage(404)).toBe("La requête a échoué (erreur 404)");
  });
});

describe("signedAmount", () => {
  it("is the credit, or minus the debit", () => {
    expect(signedAmount({ credit: 12.5, debit: 0 })).toBe(12.5);
    expect(signedAmount({ credit: 0, debit: 40 })).toBe(-40);
  });
});

describe("transactionsExportUrl", () => {
  it("carries the list filters", () => {
    expect(transactionsExportUrl({ month: "2026-06", uncategorized: true })).toBe(
      "/api/transactions/export?month=2026-06&uncategorized=true",
    );
  });

  it("exports every month without filters", () => {
    expect(transactionsExportUrl({})).toBe("/api/transactions/export");
  });
});
