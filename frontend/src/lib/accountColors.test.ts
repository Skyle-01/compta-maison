import { describe, expect, it } from "vitest";
import { ACCOUNT_COLORS, accountColor } from "./accountColors";

const account = (code: string, color: string | null = null) => ({ code, color });

describe("accountColor", () => {
  it("uses the account's own colour", () => {
    expect(accountColor([account("A"), account("B", "teal")], "B")?.name).toBe("teal");
  });

  it("defaults to the palette entry at the account's position", () => {
    const accounts = [account("A"), account("B"), account("C")];
    expect(accountColor(accounts, "A")?.name).toBe(ACCOUNT_COLORS[0].name);
    expect(accountColor(accounts, "C")?.name).toBe(ACCOUNT_COLORS[2].name);
  });

  it("wraps around the palette", () => {
    const accounts = Array.from({ length: ACCOUNT_COLORS.length + 1 }, (_, i) => account(`A${i}`));
    expect(accountColor(accounts, `A${ACCOUNT_COLORS.length}`)?.name).toBe(ACCOUNT_COLORS[0].name);
  });

  it("falls back to the default for a colour outside the palette", () => {
    expect(accountColor([account("A", "mauve")], "A")?.name).toBe(ACCOUNT_COLORS[0].name);
  });

  it("has no colour for an unknown or missing code", () => {
    expect(accountColor([account("A")], "Z")).toBeNull();
    expect(accountColor([account("A")], null)).toBeNull();
  });
});
