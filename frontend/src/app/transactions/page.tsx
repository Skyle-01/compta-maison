"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type Category, type Transaction, formatEuro, frenchMonth, suggestPattern } from "@/lib/api";
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
  const [matchCount, setMatchCount] = useState<number | null>(null);

  useEffect(() => {
    // Honour a deep-link from the dashboard warning (?uncategorized=1&month=YYYY-MM); the URL month
    // wins over the dashboard's default current month. Read once, client-side (no Suspense needed).
    const params = new URLSearchParams(window.location.search);
    const urlMonth = params.get("month");
    if (params.get("uncategorized")) setOnlyUncategorized(true);
    api.listCategories().then(setCategories).catch((e) => setError(String(e)));
    api
      .dashboard()
      .then((d) => {
        setMonths(d.months_available);
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
    if (editingTxId == null || editMode !== "rule") {
      setMatchCount(null);
      return;
    }
    const pattern = editPattern.trim();
    if (!pattern) {
      setMatchCount(null);
      return;
    }
    setMatchCount(null);
    const timer = setTimeout(() => {
      api
        .listTransactions({ libelleContains: pattern, uncategorized: true, limit: 1 })
        .then((page) => setMatchCount(page.total))
        .catch(() => setMatchCount(null));
    }, 250);
    return () => clearTimeout(timer);
  }, [editPattern, editMode, editingTxId]);

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
    setMatchCount(null);
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
      {flash && <p className="text-sm text-green-700">{flash}</p>}

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-zinc-500">
            <tr>
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
                    <span
                      className="inline-block rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500"
                      title="Virement / mouvement d’épargne — exclu des revenus/dépenses"
                    >
                      ⇄ virement
                    </span>
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
                    <button
                      onClick={() => openEditor(tx)}
                      className="rounded border border-amber-400 bg-amber-50 px-2 py-0.5 text-xs text-amber-800 hover:bg-amber-100"
                    >
                      Classer
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-zinc-500">
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
