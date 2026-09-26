import type { Transaction } from "./api";

/** One manual transfer decision, as listed in Settings. */
export type ManualTransfer =
  | { type: "pair"; debit: Transaction; credit: Transaction }
  | { type: "single"; tx: Transaction }
  | { type: "none"; tx: Transaction };

/**
 * Group the `kind_manual` rows (`?manual_transfer=true`) into decisions: the two legs of a manual
 * pair share a transfer_group_id and become one "pair"; a transfer without a group is a
 * single-legged transfer; any other kind is a "not a transfer". A group missing a leg (e.g. cut
 * by the page limit) falls back to single rows. Keeps the input order (the first leg's position).
 */
export function groupManualTransfers(rows: Transaction[]): ManualTransfer[] {
  const legs = new Map<number, Transaction[]>();
  for (const tx of rows) {
    if (tx.kind === "transfer" && tx.transfer_group_id != null) {
      const group = legs.get(tx.transfer_group_id) ?? [];
      group.push(tx);
      legs.set(tx.transfer_group_id, group);
    }
  }
  const out: ManualTransfer[] = [];
  const seen = new Set<number>();
  for (const tx of rows) {
    if (tx.kind !== "transfer") {
      out.push({ type: "none", tx });
      continue;
    }
    const group = tx.transfer_group_id != null ? legs.get(tx.transfer_group_id) : undefined;
    const debit = group?.find((t) => t.debit > 0);
    const credit = group?.find((t) => t.credit > 0);
    if (group?.length === 2 && debit && credit) {
      if (seen.has(tx.transfer_group_id as number)) continue;
      seen.add(tx.transfer_group_id as number);
      out.push({ type: "pair", debit, credit });
    } else {
      out.push({ type: "single", tx });
    }
  }
  return out;
}
