"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AccountDot from "@/components/AccountDot";
import AccountSelect from "@/components/AccountSelect";
import HelpLink from "@/components/HelpLink";
import { api, type Category, errorMessage, formatEuro, frenchDate, type Recurrence, type Recurrences, shortPath } from "@/lib/api";
import {
  badgeText,
  badgeTone,
  badgeTooltip,
  emptyFilters,
  filterRecurrences,
  type RecurrenceFilters,
  STATUS_LABELS,
  type StatusFilter,
  summaryText,
} from "@/lib/recurrences";
import { useAccounts } from "@/lib/useAccounts";

const SELECT = "rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm";

export default function RecurrencesPage() {
  const accounts = useAccounts();
  const [account, setAccount] = useState<string | null>(null);
  const [filters, setFilters] = useState<RecurrenceFilters>(emptyFilters());
  const [data, setData] = useState<Recurrences | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    // A slower answer for a previous account is dropped.
    let current = true;
    Promise.all([api.recurrences(account), api.listCategories()])
      .then(([found, cats]) => {
        if (!current) return;
        setData(found);
        setCategories(cats);
        setError(null);
      })
      .catch((e) => current && setError(errorMessage(e)));
    return () => {
      current = false;
    };
  }, [account]);

  const categoryName = (id: number) => {
    const category = categories.find((c) => c.id === id);
    return category ? shortPath(category) : `#${id}`;
  };
  const shown = data ? filterRecurrences(data.items, filters) : [];
  const keyOf = (r: Recurrence) => `${r.account_id}|${r.side}|${r.label}`;

  function toggle(key: string) {
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">
        Récurrents
        <HelpLink page="/recurrents" />
      </h1>

      <p className="text-sm text-zinc-500">
        Les flux qui reviennent chaque mois (loyer, salaire, abonnements, factures), sur tout l&apos;historique, avec ce
        qui cloche : un montant qui change, une opération qui manque, un abonnement qui s&apos;arrête, un prélèvement
        en double. La date attendue est celle de la prochaine opération, pas un solde.
      </p>

      {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <AccountSelect value={account} onChange={setAccount} purpose="filter" />
        <select
          value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as StatusFilter }))}
          aria-label="Écart"
          className={SELECT}
        >
          <option value="">Tous</option>
          <option value="gap">Avec écart</option>
          {Object.entries(STATUS_LABELS).map(([kind, label]) => (
            <option key={kind} value={kind}>
              {label}
            </option>
          ))}
        </select>
        <label
          className="flex items-center gap-2 text-sm text-zinc-600"
          title="Les factures (électricité) et les commerces visités à peu près chaque mois, dont le montant change"
        >
          <input
            type="checkbox"
            checked={filters.withVariable}
            onChange={(e) => setFilters((f) => ({ ...f, withVariable: e.target.checked }))}
          />
          Avec les montants variables
        </label>
      </div>

      {data && data.items.length > 0 && (
        <p className="text-sm text-zinc-700">{summaryText(data.items, data.monthly_expenses, data.monthly_income)}.</p>
      )}

      <div className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 bg-white text-sm">
        {data === null && !error ? (
          <p className="px-3 py-2 text-zinc-500">Chargement…</p>
        ) : data && data.items.length === 0 ? (
          <p className="px-3 py-2 text-zinc-500">
            Aucun flux récurrent détecté. Il faut au moins 3 mois d&apos;opérations avec le même libellé.
          </p>
        ) : shown.length === 0 ? (
          <p className="px-3 py-2 text-zinc-500">Rien à signaler avec ces filtres.</p>
        ) : (
          shown.map((r) => {
            const key = keyOf(r);
            const isOpen = open.has(key);
            return (
              <div key={key}>
                <div className="px-3 py-2">
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => toggle(key)}
                      className="w-4 text-zinc-600 hover:text-zinc-900"
                      aria-label={isOpen ? "Masquer les opérations" : "Voir les opérations"}
                      aria-expanded={isOpen}
                    >
                      {isOpen ? "▾" : "▸"}
                    </button>
                    <span className="min-w-0 flex-1 truncate font-medium">{r.label}</span>
                    <span className="w-20 text-xs text-zinc-500">
                      <AccountDot accounts={accounts} code={r.account_id} />
                      {r.account_id}
                    </span>
                    <span className="w-56 truncate text-xs text-zinc-500">
                      {r.category_id != null ? (
                        categoryName(r.category_id)
                      ) : (
                        <Link href="/a-classer" className="underline hover:text-zinc-900">
                          À classer
                        </Link>
                      )}
                    </span>
                    <span
                      className={`w-28 text-right tabular-nums ${
                        r.amount_kind === "variable"
                          ? "text-zinc-600"
                          : r.side === "credit"
                            ? "text-green-700"
                            : "text-red-700"
                      }`}
                    >
                      {r.amount_kind === "variable"
                        ? "variable"
                        : formatEuro(r.side === "credit" ? r.typical_amount : -r.typical_amount)}
                    </span>
                  </div>
                  <div className="ml-8 mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
                    <span>
                      {r.occurrences} fois, dernière le {frenchDate(r.last_date)}
                    </span>
                    <span>{r.next_expected ? `attendue le ${frenchDate(r.next_expected)}` : "plus attendue"}</span>
                    {r.status.map((s) => (
                      <span
                        key={s.kind}
                        className={`whitespace-nowrap rounded px-1.5 ${badgeTone(s)}`}
                        title={badgeTooltip(s)}
                      >
                        {badgeText(s)}
                      </span>
                    ))}
                  </div>
                </div>
                {isOpen && (
                  <ul className="space-y-0.5 bg-zinc-50 px-12 py-2 text-xs text-zinc-600">
                    {r.last_operations.map((o) => (
                      <li key={o.id} className="flex gap-4">
                        <span className="w-24">{frenchDate(o.date)}</span>
                        <span className="tabular-nums">{formatEuro(r.side === "credit" ? o.amount : -o.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
