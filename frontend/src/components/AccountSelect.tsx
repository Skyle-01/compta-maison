"use client";

import { useEffect, useState } from "react";
import { type Account, api } from "@/lib/api";

/** What the select is for: a page filter (Transactions, « À classer ») or the account a rule is limited to. */
const PURPOSES = {
  filter: { label: "Compte", title: undefined, padding: "py-1.5" },
  rule: {
    label: "Compte de la règle",
    title: "Limiter la règle à un compte : elle l'emporte alors sur une règle de tous les comptes",
    padding: "py-1",
  },
};

/** « Tous les comptes » or one account (null = all accounts). Loads the accounts itself; external
 *  savings accounts have no operations of their own, so they are left out. */
export default function AccountSelect({
  value,
  onChange,
  purpose,
}: {
  value: string | null;
  onChange: (code: string | null) => void;
  purpose: keyof typeof PURPOSES;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const { label, title, padding } = PURPOSES[purpose];

  useEffect(() => {
    api
      .listAccounts()
      .then((all) => setAccounts(all.filter((a) => !a.deposit_pattern)))
      .catch(() => setAccounts([]));
  }, []);

  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      aria-label={label}
      title={title}
      className={`rounded border border-zinc-300 bg-white px-2 ${padding} text-sm`}
    >
      <option value="">Tous les comptes</option>
      {/* The chosen account stays selectable until the list has loaded. */}
      {value && !accounts.some((a) => a.code === value) && <option value={value}>{value}</option>}
      {accounts.map((a) => (
        <option key={a.code} value={a.code}>
          {a.label}
        </option>
      ))}
    </select>
  );
}
