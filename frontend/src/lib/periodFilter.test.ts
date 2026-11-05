import { describe, expect, it } from "vitest";
import { applyUrl, DEFAULT_FILTERS, effectiveMonth, monthParam, parseStored, withoutUrlFilters } from "./periodFilter";

const AVAILABLE = ["2026-09", "2026-08", "2026-07"]; // newest first

describe("effectiveMonth", () => {
  it("keeps a picked month that exists", () => {
    expect(effectiveMonth("2026-08", AVAILABLE)).toBe("2026-08");
  });

  it("falls back to the latest month when none was picked or the picked one is gone", () => {
    expect(effectiveMonth(null, AVAILABLE)).toBe("2026-09");
    expect(effectiveMonth("2025-01", AVAILABLE)).toBe("2026-09");
  });

  it("is empty on an empty database", () => {
    expect(effectiveMonth("2026-08", [])).toBe("");
  });
});

describe("monthParam", () => {
  it("sends the month unless every month is wanted", () => {
    expect(monthParam("2026-08", false)).toBe("2026-08");
    expect(monthParam("2026-08", true)).toBeUndefined();
    expect(monthParam("", false)).toBeUndefined();
  });
});

describe("parseStored", () => {
  it("reads what was saved", () => {
    const saved = { month: "2026-08", all: true, account: "PERSO" };
    expect(parseStored(JSON.stringify(saved))).toEqual(saved);
  });

  it("gives the defaults for nothing, garbage or wrong types", () => {
    expect(parseStored(null)).toEqual(DEFAULT_FILTERS);
    expect(parseStored("{not json")).toEqual(DEFAULT_FILTERS);
    expect(parseStored(JSON.stringify({ month: 3, all: "yes", account: false }))).toEqual(DEFAULT_FILTERS);
  });
});

describe("applyUrl", () => {
  const stored = { month: "2026-07", all: true, account: "PERSO" };

  it("a month in the URL wins and ends « Tous les mois »", () => {
    expect(applyUrl(stored, "?uncategorized=1&month=2026-08")).toEqual({
      month: "2026-08",
      all: false,
      account: "PERSO",
    });
  });

  it("an account in the URL wins, the month filter is untouched", () => {
    expect(applyUrl(stored, "account=JOINT")).toEqual({ month: "2026-07", all: true, account: "JOINT" });
  });

  it("leaves the filters alone without either key", () => {
    expect(applyUrl(stored, "?uncategorized=1")).toEqual(stored);
    expect(applyUrl(stored, "")).toEqual(stored);
  });
});

describe("withoutUrlFilters", () => {
  it("drops the filter keys and keeps the others", () => {
    expect(withoutUrlFilters("?uncategorized=1&month=2026-08&account=PERSO")).toBe("?uncategorized=1");
    expect(withoutUrlFilters("?month=2026-08")).toBe("");
    expect(withoutUrlFilters("")).toBe("");
  });
});
