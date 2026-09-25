"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api,
  type Category,
  type Transaction,
  type TransferMode,
  formatEuro,
  frenchMonth,
  suggestPattern,
} from "@/lib/api";
import CategoryPicker from "@/components/CategoryPicker";

const PAGE_SIZE = 50;

type EditMode = "manual" | "rule";

export default function TransactionsPage() {
  const [items, setItems] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [month, setMonth] = useState("");
  const [months, setMonths] = useState<string[]>([]);
  const [onlyUncategorized, setOnlyUncategorized] = useState(false);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // Inline categorisation editor — one row open at a time. The same editor handles a one-off
  // manual assignment and creating a reusable rule; the description maps to the transaction note
  // (manual) or the rule's description (rule).
  const [editingTxId, setEditingTxId] = useState<number | null>(null);
  const [editCategory, setEditCategory] = useState<number | null>(null);
  const [editMode, setEditMode] = useState<EditMode>("manual");
  const [editNote, setEditNote] = useState("");
  const [editPattern, setEditPattern] = useState("");
  const [editPriority, setEditPriority] = useState("100");
  const [editAnchor, setEditAnchor] = useState(false);
  // Last live-preview result, keyed by the pattern it counted (see the preview effect below).
  const [matchResult, setMatchResult] = useState<{ pattern: string; count: number } | null>(null);
  // Rows ticked for a manual transfer decision (kept across pages/months; at most two).
  const [selected, setSelected] = useState<Map<number, Transaction>>(new Map());

  useEffect(() => {
    // Honour a deep-link from the dashboard warning (?uncategorized=1&month=YYYY-MM); the URL month
    // wins over the dashboard's default current month. Read once, client-side (no Suspense needed).
    const params = new URLSearchParams(window.location.search);
    const urlMonth = params.get("month");
    const urlUncategorized = Boolean(params.get("uncategorized"));
    api.listCategories().then(setCategories).catch((e) => setError(String(e)));
    api
      .dashboard()
      .then((d) => {
        setMonths(d.months_available);
        // Applied with the month, in one render, so the list is fetched once with both filters.
        if (urlUncategorized) setOnlyUncategorized(true);
        if (urlMonth) setMonth(urlMonth);
        else if (d.month) setMonth(d.month);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const load = useCallback(() => {
    if (!month && months.length > 0) return;
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
      .catch((e) => setError(String(e)));
  }, [month, months, onlyUncategorized, offset]);

  useEffect(load, [load]);

  // Live preview (rule mode only): count the rows the rule would actually claim — currently
  // uncategorised, non-transfer transactions whose label contains the pattern (same case-sensitive
  // instr semantics as the rule engine). Debounced.
  useEffect(() => {
    const pattern = editPattern.trim();
    if (editingTxId == null || editMode !== "rule" || !pattern) return;
    const timer = setTimeout(() => {
      api
        .listTransactions({ libelleContains: pattern, uncategorized: true, limit: 1 })
        .then((page) => setMatchResult({ pattern, count: page.total }))
        .catch(() => setMatchResult(null));
    }, 250);
    return () => clearTimeout(timer);
  }, [editPattern, editMode, editingTxId]);
  // Only a count for the pattern currently typed is shown ("…" while the debounce runs), so a
  // late response for an older pattern can't be mistaken for the current one.
  const matchCount =
    editingTxId != null && editMode === "rule" && matchResult?.pattern === editPattern.trim()
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
    setEditCategory(tx.category_id);
    setEditMode("manual");
    setEditNote(tx.note ?? "");
    setEditPattern(suggestPattern(tx.libelle));
    setEditPriority("100");
    setEditAnchor(false);
    setMatchResult(null);
  }

  async function submitEditor(tx: Transaction) {
    if (editCategory == null) return;
    setError(null);
    try {
      if (editMode === "manual") {
        await api.updateTransaction(tx.id, {
          category_id: editCategory,
          note: editNote.trim() || null,
        });
        setFlash("Opération classée.");
      } else {
        const pattern = editPattern.trim();
        if (!pattern) return;
        await api.createRule({
          category_id: editCategory,
          pattern,
          priority: Number(editPriority) || 100,
          is_income_anchor: editAnchor,
          description: editNote.trim() || null,
        });
        const n = matchCount;
        setFlash(
          `Règle « ${pattern} » créée${n != null ? ` — ${n} opération(s) classée(s)` : ""}.`,
        );
      }
      setEditingTxId(null);
      load();
    } catch (e) {
      setError(String(e));
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
      load();
    } catch (e) {
      setError(String(e));
    }
  }

  const setMode = (tx: Transaction, mode: TransferMode, message: string) =>
    transferAction(() => api.setTransferMode(tx.id, mode), message);
  const selectedRows = [...selected.values()];

  const submitDisabled = editCategory == null || (editMode === "rule" && !editPattern.trim());

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Transactions</h1>
        <div className="flex items-center gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={onlyUncategorized}
              onChange={(e) => {
                setOnlyUncategorized(e.target.checked);
                setOffset(0);
              }}
            />
            Sans catégorie uniquement
          </label>
          <select
            className="rounded border border-zinc-300 bg-white px-2 py-1"
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">Tous les mois</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {frenchMonth(m)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}
      {selectedRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
          <span className="text-zinc-600">
            {selectedRows.length} sélectionnée(s) :{" "}
            {selectedRows.map((tx) => `${tx.libelle} (${formatEuro(tx.credit > 0 ? tx.credit : -tx.debit)})`).join(" ↔ ")}
          </span>
          {selectedRows.length === 2 ? (
            <button
              onClick={() =>
                transferAction(
                  () => api.pairTransfer([selectedRows[0].id, selectedRows[1].id]),
                  "Virement associé.",
                )
              }
              className="rounded bg-zinc-800 px-3 py-0.5 text-xs text-white"
            >
              Associer en virement
            </button>
          ) : (
            <button
              onClick={() => setMode(selectedRows[0], "transfer", "Opération marquée comme virement.")}
              className="rounded bg-zinc-800 px-3 py-0.5 text-xs text-white"
              title="Virement vers un compte dont le relevé n’est pas importé — exclu des revenus/dépenses"
            >
              Marquer comme virement
            </button>
          )}
          <button
            onClick={() => setSelected(new Map())}
            className="rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 hover:bg-white"
          >
            Effacer
          </button>
        </div>
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
              <tr key={tx.id} className="border-t border-zinc-100 align-top">
                <td className="px-2 py-1.5">
                  <input
                    type="checkbox"
                    checked={selected.has(tx.id)}
                    disabled={!selected.has(tx.id) && selected.size >= 2}
                    onChange={() => toggleSelected(tx)}
                    aria-label="Sélectionner"
                  />
                </td>
                <td className="whitespace-nowrap px-3 py-1.5">{tx.date_valeur}</td>
                <td className="max-w-md truncate px-3 py-1.5" title={tx.libelle}>
                  {tx.libelle}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-zinc-500">{tx.account}</td>
                <td
                  className={`whitespace-nowrap px-3 py-1.5 text-right ${
                    tx.credit > 0 ? "text-green-700" : "text-red-700"
                  }`}
                >
                  {formatEuro(tx.credit > 0 ? tx.credit : -tx.debit)}
                </td>
                <td className="px-3 py-1.5">
                  {tx.kind === "transfer" ? (
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span
                        className="inline-block rounded bg-zinc-100 px-2 py-0.5 text-zinc-500"
                        title="Virement / mouvement d’épargne — exclu des revenus/dépenses"
                      >
                        ⇄ virement
                      </span>
                      {tx.kind_manual && (
                        <span className="text-zinc-400" title="Décision manuelle">
                          ✎
                        </span>
                      )}
                      {(tx.transfer_group_id != null || tx.kind_manual) && (
                        <button
                          onClick={() => setMode(tx, "none", "Virement dissocié.")}
                          className="text-zinc-400 hover:text-zinc-900"
                          title="Ce n’est pas un virement : compter dans les revenus/dépenses"
                        >
                          Dissocier
                        </button>
                      )}
                      {tx.kind_manual && (
                        <button
                          onClick={() => setMode(tx, "auto", "Détection automatique rétablie.")}
                          className="text-zinc-400 hover:text-zinc-900"
                          title="Revenir à la détection automatique"
                        >
                          Auto
                        </button>
                      )}
                    </div>
                  ) : editingTxId === tx.id ? (
                    <div className="space-y-2">
                      <CategoryPicker
                        categories={categories}
                        value={editCategory}
                        onChange={setEditCategory}
                        highlight={editCategory == null}
                        placeholder="— catégorie —"
                      />
                      <div className="flex items-center gap-3 text-xs text-zinc-600">
                        <label className="flex items-center gap-1">
                          <input
                            type="radio"
                            name={`mode-${tx.id}`}
                            checked={editMode === "manual"}
                            onChange={() => setEditMode("manual")}
                          />
                          Cette opération
                        </label>
                        <label className="flex items-center gap-1">
                          <input
                            type="radio"
                            name={`mode-${tx.id}`}
                            checked={editMode === "rule"}
                            onChange={() => setEditMode("rule")}
                          />
                          Règle (opérations similaires)
                        </label>
                      </div>
                      {editMode === "rule" && (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <input
                              value={editPattern}
                              onChange={(e) => setEditPattern(e.target.value)}
                              placeholder="texte à rechercher"
                              className="w-52 rounded border border-zinc-300 px-1 py-0.5 font-mono text-xs"
                            />
                            <span className="text-xs text-zinc-400">
                              {!editPattern.trim()
                                ? ""
                                : matchCount == null
                                ? "…"
                                : matchCount === 0
                                ? "⚠ aucune opération sans catégorie ne correspond"
                                : `classerait ${matchCount} opération(s)`}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            <input
                              type="number"
                              title="Priorité — le plus petit nombre l’emporte"
                              value={editPriority}
                              onChange={(e) => setEditPriority(e.target.value)}
                              className="w-16 rounded border border-zinc-300 px-1 py-0.5"
                            />
                            <label className="flex items-center gap-1 text-zinc-600">
                              <input
                                type="checkbox"
                                checked={editAnchor}
                                onChange={(e) => setEditAnchor(e.target.checked)}
                              />
                              ancre de revenu
                            </label>
                          </div>
                        </div>
                      )}
                      <input
                        value={editNote}
                        onChange={(e) => setEditNote(e.target.value)}
                        placeholder={
                          editMode === "rule"
                            ? "Description de la règle (facultatif)"
                            : "Description (facultatif)"
                        }
                        className="w-72 rounded border border-zinc-300 px-2 py-0.5 text-xs"
                      />
                      <div className="flex items-center gap-2 text-xs">
                        <button
                          onClick={() => submitEditor(tx)}
                          disabled={submitDisabled}
                          className="rounded bg-zinc-800 px-3 py-0.5 text-white disabled:opacity-40"
                        >
                          Valider
                        </button>
                        <button
                          onClick={() => setEditingTxId(null)}
                          className="rounded border border-zinc-300 px-2 py-0.5 text-zinc-600 hover:bg-zinc-50"
                        >
                          Annuler
                        </button>
                      </div>
                    </div>
                  ) : tx.category_id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{tx.category}</span>
                      <NotTransferBadge tx={tx} onAuto={() => setMode(tx, "auto", "Détection automatique rétablie.")} />
                      {tx.category_manual ? (
                        <span className="text-xs text-zinc-400" title="Assigné manuellement">
                          ✎
                        </span>
                      ) : tx.rule_id != null ? (
                        <span
                          className="text-xs text-zinc-400"
                          title={`Classé par la règle « ${tx.rule_pattern} »`}
                        >
                          ⚙
                        </span>
                      ) : null}
                      {tx.note && <span className="text-xs italic text-zinc-400">— {tx.note}</span>}
                      <button
                        onClick={() => openEditor(tx)}
                        className="text-xs text-zinc-400 hover:text-zinc-900"
                        title="Modifier le classement"
                      >
                        Modifier
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => openEditor(tx)}
                        className="rounded border border-amber-400 bg-amber-50 px-2 py-0.5 text-xs text-amber-800 hover:bg-amber-100"
                      >
                        Classer
                      </button>
                      <NotTransferBadge tx={tx} onAuto={() => setMode(tx, "auto", "Détection automatique rétablie.")} />
                    </div>
                  )}
                </td>
              </tr>
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
            className="rounded border border-zinc-300 px-2 py-1 disabled:opacity-40"
          >
            Précédent
          </button>
          <button
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
            className="rounded border border-zinc-300 px-2 py-1 disabled:opacity-40"
          >
            Suivant
          </button>
        </div>
      </div>
    </div>
  );
}

/** A row the user declared "not a transfer": say so, with a way back to automatic detection. */
function NotTransferBadge({ tx, onAuto }: { tx: Transaction; onAuto: () => void }) {
  if (!tx.kind_manual) return null;
  return (
    <span className="text-xs text-zinc-400" title="Décision manuelle : n’est pas un virement">
      ✎ pas un virement ·{" "}
      <button onClick={onAuto} className="hover:text-zinc-900" title="Revenir à la détection automatique">
        Auto
      </button>
    </span>
  );
}
