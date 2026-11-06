"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFilters } from "@/components/FiltersProvider";
import HelpLink from "@/components/HelpLink";
import {
  api,
  errorMessage,
  type Category,
  type Transaction,
  type TransferMode,
  notifyUncategorizedChanged,
  shortPath,
  suggestPattern,
} from "@/lib/api";
import { conflictsMessage } from "@/lib/triage";
import { emptyRuleForm, type RuleForm, ruleFormToPayload } from "@/lib/ruleForm";
import { useAccounts } from "@/lib/useAccounts";
import CategoryEditor, { type EditMode, type SplitForm } from "./CategoryEditor";
import Filters from "./Filters";
import SelectionBar from "./SelectionBar";
import TransactionRow from "./TransactionRow";

const PAGE_SIZE = 50;

export default function TransactionsPage() {
  const [items, setItems] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const accounts = useAccounts();
  const { ready, monthFilter, account } = useFilters();
  // The dashboard warning's deep-link (?uncategorized=1&month=YYYY-MM): the month is the shared
  // filter's business (FiltersProvider), this one is the page's own, read once.
  const urlUncategorized = useSearchParams().get("uncategorized");
  const [onlyUncategorized, setOnlyUncategorized] = useState(Boolean(urlUncategorized));
  // The page offset belongs to the filters it was reached with: another month or account starts over.
  const scope = `${monthFilter ?? ""}\u0000${account ?? ""}`;
  const [paging, setPaging] = useState({ scope, offset: 0 });
  const offset = paging.scope === scope ? paging.offset : 0;
  const setOffset = (next: number) => setPaging({ scope, offset: next });
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  // Conflicts a saved rule created: kept until dismissed, since the operations need a decision.
  const [warning, setWarning] = useState<string | null>(null);

  // Inline categorisation editor — one row open at a time. The same editor handles a one-off
  // manual assignment and creating a reusable rule; the description maps to the transaction note
  // (manual) or the rule's description (rule).
  const [editingTxId, setEditingTxId] = useState<number | null>(null);
  const [editMode, setEditMode] = useState<EditMode>("manual");
  const [form, setForm] = useState<RuleForm>(emptyRuleForm());
  const edit = (patch: Partial<RuleForm>) => setForm((f) => ({ ...f, ...patch }));
  const [split, setSplit] = useState<SplitForm | null>(null);
  // Last live-preview result, keyed by the pattern and account it counted (see the preview effect below).
  const [matchResult, setMatchResult] = useState<{ key: string; count: number } | null>(null);
  // Rows ticked for a manual transfer decision (kept across pages/months; at most two).
  const [selected, setSelected] = useState<Map<number, Transaction>>(new Map());

  useEffect(() => {
    api.listCategories().then(setCategories).catch((e) => setError(errorMessage(e)));
  }, []);

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
      })
      .catch((e) => {
        if (id === request.current) setError(errorMessage(e));
      });
  }, [ready, monthFilter, account, onlyUncategorized, offset]);

  useEffect(load, [load]);

  // Live preview (rule mode only): count the rows the rule would actually claim — currently
  // uncategorised, non-transfer transactions whose label contains the pattern (same case-sensitive
  // instr semantics as the rule engine), of the rule's account when it is limited to one. Debounced.
  const matchKey = `${form.pattern.trim()}\u0000${form.account_id ?? ""}`;
  useEffect(() => {
    const pattern = form.pattern.trim();
    if (editingTxId == null || editMode !== "rule" || !pattern) return;
    const timer = setTimeout(() => {
      api
        .listTransactions({
          libelleContains: pattern,
          account: form.account_id ?? undefined,
          uncategorized: true,
          limit: 1,
        })
        .then((page) => setMatchResult({ key: matchKey, count: page.total }))
        .catch(() => setMatchResult(null));
    }, 250);
    return () => clearTimeout(timer);
  }, [form.pattern, form.account_id, matchKey, editMode, editingTxId]);
  // Only a count for the pattern and account currently set is shown ("…" while the debounce runs),
  // so a late response for an older one can't be mistaken for the current one.
  const matchCount =
    editingTxId != null && editMode === "rule" && matchResult?.key === matchKey ? matchResult.count : null;

  // Auto-dismiss the success flash.
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(timer);
  }, [flash]);

  function openEditor(tx: Transaction) {
    setEditingTxId(tx.id);
    setEditMode("manual");
    setForm({
      ...emptyRuleForm(),
      category_id: tx.category_id,
      pattern: suggestPattern(tx.libelle),
      description: tx.note ?? "",
    });
    setSplit(
      tx.split_category_id == null
        ? null
        : { category_id: tx.split_category_id, amount: String(tx.split_amount ?? "").replace(".", ",") },
    );
    setMatchResult(null);
  }

  async function submitEditor(tx: Transaction) {
    if (form.category_id == null) return;
    setError(null);
    setWarning(null);
    try {
      if (editMode === "manual") {
        // A category_id drops any split server-side, so a split is always sent along with it.
        await api.updateTransaction(tx.id, {
          category_id: form.category_id,
          note: form.description.trim() || null,
          ...(split && { split_category_id: split.category_id, split_amount: Number(split.amount.replace(",", ".")) }),
        });
        setFlash(split ? "Opération scindée." : "Opération classée.");
      } else {
        const rule = ruleFormToPayload(form);
        const pattern = rule.pattern;
        if (!pattern) return;
        const created = await api.createRule(rule);
        const n = matchCount;
        setFlash(`Règle « ${pattern} » créée${n != null ? ` — ${n} opération(s) classée(s)` : ""}.`);
        if (created.conflicts.length) {
          setWarning(
            `${conflictsMessage(created.conflicts, (id) => {
              const c = categories.find((x) => x.id === id);
              return c ? shortPath(c) : `#${id}`;
            })} : ces opérations restent sans catégorie, à classer dans « À classer ».`,
          );
        }
      }
      setEditingTxId(null);
      notifyUncategorizedChanged();
      load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

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

  const splitIncomplete =
    editMode === "manual" &&
    split !== null &&
    (split.category_id == null || !(Number(split.amount.replace(",", ".")) > 0));
  const submitDisabled =
    form.category_id == null || (editMode === "rule" && !form.pattern.trim()) || splitIncomplete;

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
      {warning && (
        <p
          role="status"
          className="flex items-start justify-between gap-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          <span>⚠ {warning}</span>
          <button
            type="button"
            onClick={() => setWarning(null)}
            className="shrink-0 text-amber-800 hover:text-amber-950"
            aria-label="Fermer l'avertissement"
          >
            ✕
          </button>
        </p>
      )}

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
                onOpenEditor={() => openEditor(tx)}
                editor={
                  editingTxId === tx.id ? (
                    <CategoryEditor
                      tx={tx}
                      categories={categories}
                      form={form}
                      onEdit={edit}
                      mode={editMode}
                      onModeChange={setEditMode}
                      split={split}
                      onSplitChange={setSplit}
                      matchCount={matchCount}
                      submitDisabled={submitDisabled}
                      onSubmit={() => submitEditor(tx)}
                      onCancel={() => setEditingTxId(null)}
                    />
                  ) : null
                }
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
