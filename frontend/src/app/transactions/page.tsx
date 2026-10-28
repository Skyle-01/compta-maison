"use client";

import { useCallback, useEffect, useState } from "react";
import HelpLink from "@/components/HelpLink";
import {
  api,
  errorMessage,
  type Category,
  type Transaction,
  type TransferMode,
  notifyUncategorizedChanged,
  suggestPattern,
} from "@/lib/api";
import { emptyRuleForm, type RuleForm, ruleFormToPayload } from "@/lib/ruleForm";
import CategoryEditor, { type EditMode } from "./CategoryEditor";
import Filters from "./Filters";
import SelectionBar from "./SelectionBar";
import TransactionRow from "./TransactionRow";

const PAGE_SIZE = 50;

export default function TransactionsPage() {
  const [items, setItems] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [month, setMonth] = useState("");
  const [months, setMonths] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [onlyUncategorized, setOnlyUncategorized] = useState(false);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // Inline categorisation editor — one row open at a time. The same editor handles a one-off
  // manual assignment and creating a reusable rule; the description maps to the transaction note
  // (manual) or the rule's description (rule).
  const [editingTxId, setEditingTxId] = useState<number | null>(null);
  const [editMode, setEditMode] = useState<EditMode>("manual");
  const [form, setForm] = useState<RuleForm>(emptyRuleForm());
  const edit = (patch: Partial<RuleForm>) => setForm((f) => ({ ...f, ...patch }));
  // Last live-preview result, keyed by the pattern it counted (see the preview effect below).
  const [matchResult, setMatchResult] = useState<{ pattern: string; count: number } | null>(null);
  // Rows ticked for a manual transfer decision (kept across pages/months; at most two).
  const [selected, setSelected] = useState<Map<number, Transaction>>(new Map());

  useEffect(() => {
    // Honour a deep-link from the dashboard warning (?uncategorized=1&month=YYYY-MM, or an empty
    // month for every month); the URL month wins over the dashboard's default current month. Read
    // once, client-side (no Suspense needed).
    const params = new URLSearchParams(window.location.search);
    const urlMonth = params.get("month");
    const urlUncategorized = Boolean(params.get("uncategorized"));
    api.listCategories().then(setCategories).catch((e) => setError(errorMessage(e)));
    api
      .dashboard()
      .then((d) => {
        setMonths(d.months_available);
        // Applied with the month, in one render, so the list is fetched once with both filters.
        if (urlUncategorized) setOnlyUncategorized(true);
        if (urlMonth !== null) setMonth(urlMonth);
        else if (d.month) setMonth(d.month);
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setReady(true));
  }, []);

  const load = useCallback(() => {
    if (!ready) return; // wait for the initial month, so the list is fetched once
    api
      .listTransactions({
        month: month || undefined,
        uncategorized: onlyUncategorized,
        limit: PAGE_SIZE,
        offset,
      })
      .then((page) => {
        setItems(page.items);
        setTotal(page.total);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [ready, month, onlyUncategorized, offset]);

  useEffect(load, [load]);

  // Live preview (rule mode only): count the rows the rule would actually claim — currently
  // uncategorised, non-transfer transactions whose label contains the pattern (same case-sensitive
  // instr semantics as the rule engine). Debounced.
  useEffect(() => {
    const pattern = form.pattern.trim();
    if (editingTxId == null || editMode !== "rule" || !pattern) return;
    const timer = setTimeout(() => {
      api
        .listTransactions({ libelleContains: pattern, uncategorized: true, limit: 1 })
        .then((page) => setMatchResult({ pattern, count: page.total }))
        .catch(() => setMatchResult(null));
    }, 250);
    return () => clearTimeout(timer);
  }, [form.pattern, editMode, editingTxId]);
  // Only a count for the pattern currently typed is shown ("…" while the debounce runs), so a
  // late response for an older pattern can't be mistaken for the current one.
  const matchCount =
    editingTxId != null && editMode === "rule" && matchResult?.pattern === form.pattern.trim()
      ? matchResult.count
      : null;

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
    setMatchResult(null);
  }

  async function submitEditor(tx: Transaction) {
    if (form.category_id == null) return;
    setError(null);
    try {
      if (editMode === "manual") {
        await api.updateTransaction(tx.id, {
          category_id: form.category_id,
          note: form.description.trim() || null,
        });
        setFlash("Opération classée.");
      } else {
        const rule = ruleFormToPayload(form);
        const pattern = rule.pattern;
        if (!pattern) return;
        await api.createRule(rule);
        const n = matchCount;
        setFlash(
          `Règle « ${pattern} » créée${n != null ? ` — ${n} opération(s) classée(s)` : ""}.`,
        );
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

  const submitDisabled = form.category_id == null || (editMode === "rule" && !form.pattern.trim());

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
          month={month}
          months={months}
          onMonthChange={(m) => {
            setMonth(m);
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
