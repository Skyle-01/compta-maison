import SignedAmount from "@/components/SignedAmount";

/** A net amount, green when money comes in, red when it goes out. */
export default function Net({ amount }: { amount: number }) {
  if (amount === 0) return null;
  return <SignedAmount tx={{ credit: Math.max(amount, 0), debit: Math.max(-amount, 0) }} />;
}
