import { describe, expect, it } from "vitest";
import { lastCompleteMonths, parseReportRequest, reportRangeTitle, reportSearch } from "./reportRequest";

// Newest first, like Dashboard.months_available: 2026-09 is still filling.
const available = ["2026-09", "2026-08", "2026-07", "2026-06"];
const plain = (s: string) => s.replace(/[  ]/g, " ");

describe("lastCompleteMonths", () => {
  it("skips the month still filling and keeps the newest `count`", () => {
    expect(lastCompleteMonths(available, 2)).toEqual(["2026-08", "2026-07"]);
    expect(lastCompleteMonths(available, 10)).toEqual(["2026-08", "2026-07", "2026-06"]);
    expect(lastCompleteMonths(["2026-09"], 3)).toEqual([]);
  });
});

describe("parseReportRequest", () => {
  it("reads several months, oldest first, without duplicates or unknown months", () => {
    expect(parseReportRequest("?months=2026-08,2026-06,2026-08,1999-01", available)).toEqual({
      months: ["2026-06", "2026-08"],
      operations: true,
      flow: true,
    });
  });

  it("still reads a single `month`", () => {
    expect(parseReportRequest("?month=2026-07", available).months).toEqual(["2026-07"]);
  });

  it("falls back to the latest complete month, then to the only one", () => {
    expect(parseReportRequest("", available).months).toEqual(["2026-08"]);
    expect(parseReportRequest("?months=nope", available).months).toEqual(["2026-08"]);
    expect(parseReportRequest("", ["2026-09"]).months).toEqual(["2026-09"]);
    expect(parseReportRequest("", []).months).toEqual([]);
  });

  it("switches the options off with 0 only", () => {
    const off = parseReportRequest("?operations=0&flow=0", available);
    expect([off.operations, off.flow]).toEqual([false, false]);
    const on = parseReportRequest("?operations=1", available);
    expect([on.operations, on.flow]).toEqual([true, true]);
  });
});

describe("reportSearch", () => {
  it("round-trips through parseReportRequest and spells only non-default options", () => {
    const request = { months: ["2026-06", "2026-08"], operations: false, flow: true };
    expect(reportSearch(request)).toBe("months=2026-06,2026-08&operations=0");
    expect(parseReportRequest(reportSearch(request), available)).toEqual(request);
  });
});

describe("reportRangeTitle", () => {
  it("names one month, or the count and the newest of several", () => {
    expect(reportRangeTitle(["2026-08"])).toBe("Comptes du foyer - août 2026");
    expect(plain(reportRangeTitle(["2026-06", "2026-08"]))).toBe("Comptes du foyer - 2 mois jusqu'en août 2026");
    expect(reportRangeTitle([])).toBe("Comptes du foyer");
  });
});
