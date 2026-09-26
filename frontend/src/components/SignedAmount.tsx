import { type Transaction, formatEuro, signedAmount } from "@/lib/api";

/** A transaction's signed amount in euros, green for a credit and red for a debit. */
export default function SignedAmount({ tx }: { tx: Pick<Transaction, "credit" | "debit"> }) {
  return (
    <span className={tx.credit > 0 ? "text-green-700" : "text-red-700"}>
      {formatEuro(signedAmount(tx))}
    </span>
  );
}
