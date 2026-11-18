import { describe, expect, it } from "vitest";
import { formatEuro, type Recurrence, type RecurrenceStatus } from "./api";
import {
  badgeText,
  badgeTone,
  counted,
  emptyFilters,
  filterRecurrences,
  gapCount,
  summaryText,
} from "./recurrences";

const flag = (kind: RecurrenceStatus["kind"], fields: Partial<RecurrenceStatus> = {}): RecurrenceStatus => ({
  kind,
  old_amount: null,
  new_amount: null,
  since: null,
  ...fields,
});

function flow(label: string, fields: Partial<Recurrence> = {}): Recurrence {
  return {
    label,
    account_id: "PERSO",
    side: "debit",
    category_id: null,
    amount_kind: "fixed",
    typical_amount: 10,
    last_amount: 10,
    occurrences: 4,
    first_date: "2026-01-05",
    last_date: "2026-04-05",
    next_expected: "2026-05-05",
    status: [],
    last_operations: [],
    ...fields,
  };
}

const NETFLIX = flow("NETFLIX", { status: [flag("price_change", { old_amount: 13.49, new_amount: 15.99 })] });
const EDF = flow("EDF", { amount_kind: "variable", status: [flag("missing")] });
const SPOTIFY = flow("SPOTIFY", { next_expected: null, status: [flag("ended")] });
const LOYER = flow("LOYER", { typical_amount: 700 });
const items = [LOYER, NETFLIX, EDF, SPOTIFY];

describe("filterRecurrences", () => {
  it("hides the variable amounts by default", () => {
    expect(filterRecurrences(items, emptyFilters()).map((i) => i.label)).toEqual(["LOYER", "NETFLIX", "SPOTIFY"]);
  });

  it("shows them on request, in the API order", () => {
    const filters = { ...emptyFilters(), withVariable: true };
    expect(filterRecurrences(items, filters).map((i) => i.label)).toEqual(["LOYER", "NETFLIX", "EDF", "SPOTIFY"]);
  });

  it("keeps the flows with a gap, an ended flow is not one", () => {
    const filters = { status: "gap" as const, withVariable: true };
    expect(filterRecurrences(items, filters).map((i) => i.label)).toEqual(["NETFLIX", "EDF"]);
  });

  it("keeps one kind of flag", () => {
    const filters = { status: "ended" as const, withVariable: true };
    expect(filterRecurrences(items, filters).map((i) => i.label)).toEqual(["SPOTIFY"]);
  });
});

describe("counts and summary", () => {
  it("counts the fixed flows that have not ended", () => {
    expect(counted(items).map((i) => i.label)).toEqual(["LOYER", "NETFLIX"]);
  });

  it("counts the gaps of the fixed flows only", () => {
    expect(gapCount(items)).toBe(1);
    expect(gapCount([LOYER, SPOTIFY])).toBe(0);
  });

  it("writes the summary line", () => {
    expect(summaryText(items, 713.49, 2650)).toBe(
      `2 flux récurrents : ${formatEuro(713.49)} de dépenses et ${formatEuro(2650)} de revenus par mois`,
    );
    expect(summaryText([LOYER], 700, 0)).toContain("1 flux récurrent :");
  });
});

describe("badges", () => {
  it("shows both amounts of a price change", () => {
    expect(badgeText(NETFLIX.status[0])).toBe(`${formatEuro(13.49)} → ${formatEuro(15.99)}`);
  });

  it("names the other flags", () => {
    expect(badgeText(flag("missing"))).toBe("Manquant");
    expect(badgeText(flag("ended"))).toBe("Terminé");
    expect(badgeText(flag("doubled"))).toBe("Doublé");
  });

  it("is grey for an ended flow and amber for the others", () => {
    expect(badgeTone(flag("ended"))).toContain("zinc");
    expect(badgeTone(flag("missing"))).toContain("amber");
  });
});
