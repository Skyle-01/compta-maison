import { describe, expect, it } from "vitest";
import { formatEuro, frenchMonth, frenchMonthShort, suggestPattern } from "./api";

// Intl's fr-FR output uses (narrow) no-break spaces; compare with plain ones.
const plain = (s: string) => s.replace(/[  ]/g, " ");

describe("formatEuro", () => {
  it("formats French style", () => {
    expect(plain(formatEuro(1234.5))).toBe("1 234,50 €");
    expect(plain(formatEuro(-12))).toBe("-12,00 €");
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
