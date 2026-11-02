import { accountColor } from "@/lib/accountColors";
import type { Account } from "@/lib/api";

/** A small coloured dot standing for an account (nothing for an unknown code); the tooltip names it. */
export default function AccountDot({
  accounts,
  code,
}: {
  accounts: Pick<Account, "code" | "label" | "color">[];
  code: string | null | undefined;
}) {
  const color = accountColor(accounts, code);
  if (!color) return null;
  const label = accounts.find((a) => a.code === code)?.label;
  return (
    <span
      className={`mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${color.dot}`}
      title={label}
      aria-hidden="true"
    />
  );
}
