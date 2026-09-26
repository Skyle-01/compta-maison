import { describe, expect, it } from "vitest";
import type { Transaction } from "./api";
import { groupManualTransfers } from "./manualTransfers";

function tx(id: number, fields: Partial<Transaction>): Transaction {
  return {
    id,
    date_operation: "2026-06-12",
    date_valeur: "2026-06-12",
    budget_month: "2026-06",
    libelle: `OP ${id}`,
    debit: 0,
    credit: 0,
    account: "PERSO",
    account_id: "PERSO",
    kind: "expense",
    category_id: null,
    category: null,
    category_manual: false,
    note: null,
    rule_id: null,
    rule_pattern: null,
    transfer_group_id: null,
    kind_manual: true,
    ...fields,
  };
}

describe("groupManualTransfers", () => {
  it("joins the two legs of a manual pair, debit first", () => {
    const credit = tx(1, { kind: "transfer", credit: 50, account_id: "JOINT", transfer_group_id: 7 });
    const debit = tx(2, { kind: "transfer", debit: 50, transfer_group_id: 7 });
    expect(groupManualTransfers([credit, debit])).toEqual([{ type: "pair", debit, credit }]);
  });

  it("tells single-legged transfers from not-a-transfer rows", () => {
    const single = tx(1, { kind: "transfer", debit: 20 });
    const none = tx(2, { kind: "income", credit: 20 });
    expect(groupManualTransfers([single, none])).toEqual([
      { type: "single", tx: single },
      { type: "none", tx: none },
    ]);
  });

  it("falls back to a single row when a pair lost a leg", () => {
    const orphan = tx(1, { kind: "transfer", debit: 50, transfer_group_id: 7 });
    expect(groupManualTransfers([orphan])).toEqual([{ type: "single", tx: orphan }]);
  });
});
