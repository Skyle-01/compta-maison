"use client";

import { useEffect, useState } from "react";
import { type Account, api } from "@/lib/api";

/** « Tous les comptes » or one account: the scope of a rule (null = all accounts). Loads the
 *  accounts itself; external savings accounts have no operations of their own, so they are left out. */
export default function AccountSelect({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (code: string | null) => void;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);

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
      aria-label="Compte de la règle"
      title="Limiter la règle à un compte : elle l'emporte alors sur une règle de tous les comptes"
      className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm"
    >
      <option value="">Tous les comptes</option>
      {/* The rule's own account stays selectable until the list has loaded. */}
      {value && !accounts.some((a) => a.code === value) && <option value={value}>{value}</option>}
      {accounts.map((a) => (
        <option key={a.code} value={a.code}>
          {a.label}
        </option>
      ))}
    </select>
  );
}
