"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFilters } from "@/components/FiltersProvider";
import HelpLink from "@/components/HelpLink";
import { api, errorMessage, type Transaction, type TransferMode, notifyUncategorizedChanged } from "@/lib/api";
import { useAccounts } from "@/lib/useAccounts";
import Filters from "./Filters";
import SelectionBar from "./SelectionBar";
import TransactionRow from "./TransactionRow";

const PAGE_SIZE = 50;

export default function TransactionsPage() {
  const [items, setItems] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const accounts = useAccounts();
  const { ready, monthFilter, account } = useFilters();
  const [onlyUncategorized, setOnlyUncategorized] = useState(false);
  // The page offset belongs to the filters it was reached with: another month or account starts over.
  const scope = `${monthFilter ?? ""}\u0000${account ?? ""}`;
  const [paging, setPaging] = useState({ scope, offset: 0 });
  const offset = paging.scope === scope ? paging.offset : 0;
  const setOffset = (next: number) => setPaging({ scope, offset: next });
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  // Rows ticked for a manual transfer decision (kept across pages/months; at most two).
  const [selected, setSelected] = useState<Map<number, Transaction>>(new Map());

  const request = useRef(0); // a slower answer for previous filters must not overwrite this one
  const load = useCallback(() => {
    if (!ready) return; // wait for the shared filters, so the list is fetched once
    const id = ++request.current;
    api
      .listTransactions({
        month: monthFilter,
        account: account ?? undefined,
        uncategorized: onlyUncategorized,
        limit: PAGE_SIZE,
        offset,
      })
      .then((page) => {
        if (id !== request.current) return;
        setItems(page.items);
        setTotal(page.total);
        setError(null); // the list loaded: drop the notice of an earlier failure
      })
      .catch((e) => {
        if (id === request.current) setError(errorMessage(e));
      });
  }, [ready, monthFilter, account, onlyUncategorized, offset]);

  useEffect(load, [load]);

  // Auto-dismiss the success flash.
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(timer);
  }, [flash]);

  function toggleSelected(tx: Transaction) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(tx.id)) next.delete(tx.id);
      else if (next.size < 2) next.set(tx.id, tx);
      return next;
    });
  }

  async function transferAction(action: () => Promise<unknown>, message: string) {
    setError(null);
    try {
      await action();
      setSelected(new Map());
      setFlash(message);
      notifyUncategorizedChanged();
      load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const setMode = (tx: Transaction, mode: TransferMode, message: string) =>
    transferAction(() => api.setTransferMode(tx.id, mode), message);
  const selectedRows = [...selected.values()];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">
          Transactions
          <HelpLink page="/transactions" />
        </h1>
        <Filters
          onlyUncategorized={onlyUncategorized}
          onOnlyUncategorizedChange={(checked) => {
            setOnlyUncategorized(checked);
            setOffset(0);
          }}
        />
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}
      {selectedRows.length > 0 && (
        <SelectionBar
          rows={selectedRows}
          onPair={() =>
            transferAction(() => api.pairTransfer([selectedRows[0].id, selectedRows[1].id]), "Virement associé.")
          }
          onMarkTransfer={() => setMode(selectedRows[0], "transfer", "Opération marquée comme virement.")}
          onClear={() => setSelected(new Map())}
        />
      )}
      {flash && <p className="text-sm text-green-700">{flash}</p>}

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-zinc-500">
            <tr>
              <th className="w-6 px-2 py-2" title="Sélectionner pour associer deux opérations en virement" />
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Libellé</th>
              <th className="px-3 py-2 font-medium">Compte</th>
              <th className="px-3 py-2 text-right font-medium">Montant</th>
              <th className="px-3 py-2 font-medium">Catégorie</th>
            </tr>
          </thead>
          <tbody>
            {items.map((tx) => (
              <TransactionRow
                key={tx.id}
                tx={tx}
                accounts={accounts}
                checked={selected.has(tx.id)}
                checkDisabled={!selected.has(tx.id) && selected.size >= 2}
                onToggle={() => toggleSelected(tx)}
                onSetMode={(mode, message) => setMode(tx, mode, message)}
              />
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                  Aucune transaction.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-zinc-500">
        <span>
          {total} transaction(s){total > PAGE_SIZE && ` — affichage ${offset + 1}–${Math.min(offset + PAGE_SIZE, total)}`}
        </span>
        <div className="flex gap-2">
          <button
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            className="btn-secondary"
          >
            Précédent
          </button>
          <button
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
            className="btn-secondary"
          >
            Suivant
          </button>
        </div>
      </div>
    </div>
  );
}
