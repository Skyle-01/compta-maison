"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api,
  errorMessage,
  type Category,
  type CategoryAverages,
  formatEuro,
  frenchDate,
  notifyUncategorizedChanged,
  type Rule,
  shortPath,
  type Transaction,
} from "@/lib/api";
import CategoryPicker from "@/components/CategoryPicker";
import SignedAmount from "@/components/SignedAmount";
import { periodSummary } from "@/lib/averages";
import { BudgetBalance } from "@/components/BudgetSection";
import { categoryTargets, parseTarget } from "@/lib/budget";
import {
  averageNets,
  buildTree,
  type CategoryTreeNode,
  contentsByCategory,
  type Contents,
  manualMatches,
  movedMessage,
  ruleMatches,
  searchTree,
  targetedAncestor,
  treeTarget,
  undoMoves,
} from "@/lib/categoryTree";
import { fold } from "@/lib/categorySearch";
import { emptyRuleForm, type RuleForm, ruleFormToPayload, ruleToForm } from "@/lib/ruleForm";

const UNDO_DELAY_MS = 8000;
const RULE_PAGE = 20;
// The node amounts: a monthly average over the last 12 complete budget months, to set targets by.
const AVERAGE_PERIOD = "12";

/** The last move's confirmation; `undo` reverts it. */
type Toast = { message: string; undo: () => Promise<unknown> };

/** Every manual assignment (the list endpoint caps a page at 1000 rows). */
async function listAllManual(): Promise<Transaction[]> {
  const items: Transaction[] = [];
  for (;;) {
    const page = await api.listTransactions({ manual: true, limit: 1000, offset: items.length });
    items.push(...page.items);
    if (page.items.length === 0 || items.length >= page.total) return items;
  }
}

/** The editable controls for one rule, shared by the add form and the inline editor. */
function RuleEditor({
  categories,
  value,
  onChange,
}: {
  categories: Category[];
  value: RuleForm;
  onChange: (f: RuleForm) => void;
}) {
  return (
    <>
      <input
        placeholder="Motif (sous-chaîne)"
        value={value.pattern}
        onChange={(e) => onChange({ ...value, pattern: e.target.value })}
        className="w-56 rounded border border-zinc-300 px-2 py-1 font-mono text-xs"
      />
      <CategoryPicker
        categories={categories}
        value={value.category_id}
        onChange={(id) => onChange({ ...value, category_id: id })}
        highlight
        placeholder="Catégorie…"
      />
      <input
        type="number"
        title="Priorité : le plus petit nombre l’emporte"
        value={value.priority}
        onChange={(e) => onChange({ ...value, priority: e.target.value })}
        className="w-20 rounded border border-zinc-300 px-2 py-1"
      />
      <label className="flex items-center gap-1.5 text-sm">
        <input
          type="checkbox"
          checked={value.is_income_anchor}
          onChange={(e) => onChange({ ...value, is_income_anchor: e.target.checked })}
        />
        ancre de revenu
      </label>
      <input
        placeholder="Description (facultatif)"
        value={value.description}
        onChange={(e) => onChange({ ...value, description: e.target.value })}
        className="rounded border border-zinc-300 px-2 py-1 text-sm"
      />
    </>
  );
}

/** A net amount, green when money comes in, red when it goes out. */
function Net({ amount }: { amount: number }) {
  if (amount === 0) return null;
  return <SignedAmount tx={{ credit: Math.max(amount, 0), debit: Math.max(-amount, 0) }} />;
}

/** The operations a rule classifies, newest first, a page at a time; each can be classed aside
 *  (a manual assignment in another leaf). Remounted (key) after every change on the page. */
function RuleOperations({
  rule,
  categories,
  onClassAside,
}: {
  rule: Rule;
  categories: Category[];
  onClassAside: (tx: Transaction, categoryId: number) => void;
}) {
  const [items, setItems] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [asideId, setAsideId] = useState<number | null>(null);
  const [asideTarget, setAsideTarget] = useState<number | null>(null);

  const fetchPage = useCallback(
    (offset: number) =>
      api
        .listTransactions({ ruleId: rule.id, limit: RULE_PAGE, offset })
        .then((page) => {
          setItems((prev) => (offset === 0 ? page.items : [...prev, ...page.items]));
          setTotal(page.total);
        })
        .catch((e) => setError(errorMessage(e))),
    [rule.id],
  );

  useEffect(() => {
    fetchPage(0);
  }, [fetchPage]);

  if (error) return <p className="px-3 py-1.5 text-sm text-red-700">{error}</p>;
  return (
    <div className="ml-8 border-l-2 border-zinc-100 pl-3">
      <table className="w-full text-sm">
        <tbody>
          {items.map((tx) => (
            <tr key={tx.id} className="border-t border-zinc-50 first:border-t-0">
              <td className="whitespace-nowrap py-1 pr-3 text-zinc-500">{frenchDate(tx.date_valeur)}</td>
              <td className="max-w-xs truncate py-1 pr-3" title={tx.libelle}>
                {tx.libelle}
                {tx.kind === "transfer" && <span className="ml-1.5 text-xs text-zinc-500">⇄ virement</span>}
              </td>
              <td className="whitespace-nowrap py-1 pr-3 text-zinc-500">{tx.account_id ?? tx.account}</td>
              <td className="whitespace-nowrap py-1 pr-3 text-right">
                <SignedAmount tx={tx} />
              </td>
              <td className="whitespace-nowrap py-1 pr-3 text-right">
                {asideId === tx.id ? (
                  <span className="inline-flex items-center gap-2">
                    <CategoryPicker
                      categories={categories}
                      value={asideTarget}
                      onChange={setAsideTarget}
                      highlight
                      placeholder="Classer dans…"
                    />
                    <button
                      disabled={asideTarget == null}
                      onClick={() => asideTarget != null && onClassAside(tx, asideTarget)}
                      className="rounded bg-zinc-900 px-2 py-0.5 text-xs text-white disabled:opacity-40"
                    >
                      Valider
                    </button>
                    <button onClick={() => setAsideId(null)} className="text-xs text-zinc-600 hover:text-zinc-900">
                      Annuler
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => {
                      setAsideId(tx.id);
                      setAsideTarget(null);
                    }}
                    className="text-xs text-zinc-600 hover:text-zinc-900"
                    title="Classer cette opération à la main dans une autre catégorie (exception à la règle)"
                  >
                    Classer à part
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length < total && (
        <button onClick={() => fetchPage(items.length)} className="py-1 text-xs text-zinc-600 hover:text-zinc-900">
          Afficher plus ({total - items.length} restante{total - items.length > 1 ? "s" : ""})
        </button>
      )}
    </div>
  );
}

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [manual, setManual] = useState<Transaction[]>([]);
  const [averages, setAverages] = useState<CategoryAverages | null>(null);
  // Bumped after every reload so the open rules' operation lists refetch.
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const [query, setQuery] = useState("");
  const [openLeaves, setOpenLeaves] = useState<Set<number>>(new Set());
  const [openRules, setOpenRules] = useState<Set<number>>(new Set());

  // Ticked rules and manual operations, and where to move them.
  const [selRules, setSelRules] = useState<Set<number>>(new Set());
  const [selTx, setSelTx] = useState<Set<number>>(new Set());
  const [moveTarget, setMoveTarget] = useState<number | null>(null);

  // Inline category-tree editing state.
  const [newGroup, setNewGroup] = useState("");
  const [addingUnder, setAddingUnder] = useState<number | null>(null);
  const [childName, setChildName] = useState("");
  const [editingCatId, setEditingCatId] = useState<number | null>(null);
  const [editCatName, setEditCatName] = useState("");
  const [editCatParent, setEditCatParent] = useState<number | null>(null);
  const [editingTargetId, setEditingTargetId] = useState<number | null>(null);
  const [targetInput, setTargetInput] = useState("");

  // Rules: inline edit, and the add form of one leaf.
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
  const [editRule, setEditRule] = useState<RuleForm>(emptyRuleForm());
  const [addingRuleIn, setAddingRuleIn] = useState<number | null>(null);
  const [newRule, setNewRule] = useState<RuleForm>(emptyRuleForm());

  // Manual assignments: inline note edit.
  const [editingNoteTxId, setEditingNoteTxId] = useState<number | null>(null);
  const [editNoteValue, setEditNoteValue] = useState("");

  const load = useCallback(
    () =>
      Promise.all([api.listCategories(), api.listRules(), listAllManual(), api.averages(AVERAGE_PERIOD, "all")]).then(
        ([cats, ruleList, manualList, avg]) => {
          setCategories(cats);
          setRules(ruleList);
          setManual(manualList);
          setAverages(avg);
          setVersion((v) => v + 1);
        },
      ),
    [],
  );

  useEffect(() => {
    load().catch((e) => setError(errorMessage(e)));
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), UNDO_DELAY_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  /** Run a change, then reload; false (and the message shown) when it failed. */
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setError(null);
    try {
      await action();
      // Rule and category changes, and clearing a manual assignment, move the « À classer » count.
      notifyUncategorizedChanged();
      await load();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
  }

  /** A change that « Annuler » (the toast, or Alt+Z) can revert. */
  async function act(perform: () => Promise<Toast>): Promise<boolean> {
    let next: Toast | null = null;
    const ok = await run(async () => {
      next = await perform();
    });
    if (ok) setToast(next);
    return ok;
  }

  const undo = useCallback(async () => {
    if (!toast) return;
    setToast(null);
    setError(null);
    try {
      await toast.undo();
      notifyUncategorizedChanged();
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [toast, load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.code === "KeyZ") {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  const byId = new Map(categories.map((c) => [c.id, c]));
  const tree = buildTree(categories);
  const contents = contentsByCategory(tree, rules, manual);
  const targetSums = categoryTargets(categories);
  const nets = averageNets(averages?.groups ?? []);
  const averageTitle = `Moyenne mensuelle ${(averages && periodSummary(averages, AVERAGE_PERIOD)) || "sur 12 mois"}`;
  const search = searchTree(tree, rules, manual, query);
  const q = fold(query.trim());

  // Valid re-parent targets: roots and existing groups (by the leaf-only invariant those carry no
  // direct tx/rules, so reject_populated_parent won't fire), excluding the edited node and its
  // descendants (would create a cycle). Plus "(groupe principal)".
  const parentIdSet = new Set(categories.map((c) => c.parent_id).filter((id): id is number => id != null));
  function descendantIds(rootId: number): Set<number> {
    const kids = new Map<number | null, number[]>();
    for (const c of categories) kids.set(c.parent_id, [...(kids.get(c.parent_id) ?? []), c.id]);
    const out = new Set<number>();
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop()!;
      out.add(id);
      for (const k of kids.get(id) ?? []) stack.push(k);
    }
    return out;
  }
  const forbiddenParents = editingCatId != null ? descendantIds(editingCatId) : null;
  const parentOptions = categories
    .filter((c) => (c.is_root || parentIdSet.has(c.id)) && !forbiddenParents?.has(c.id))
    .sort((a, b) => a.path.localeCompare(b.path));

  const toggle = (set: Set<number>, id: number) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  function startAddChild(id: number) {
    setEditingCatId(null);
    setAddingUnder(id);
    setChildName("");
  }

  function startEditCat(node: Category) {
    setAddingUnder(null);
    setEditingCatId(node.id);
    setEditCatName(node.name);
    setEditCatParent(node.parent_id);
  }

  function saveCat(node: Category) {
    const name = editCatName.trim();
    if (!name) return;
    run(() => api.updateCategory(node.id, { name, parent_id: editCatParent })).then(
      (ok) => ok && setEditingCatId(null),
    );
  }

  function startEditTarget(node: Category) {
    setEditingTargetId(node.id);
    setTargetInput(node.budget_target != null ? String(node.budget_target).replace(".", ",") : "");
  }

  function saveTarget(node: Category) {
    const target = parseTarget(targetInput);
    if (Number.isNaN(target)) {
      setError(`Objectif invalide pour « ${node.name} » : saisissez un montant positif, ou laissez vide.`);
      return;
    }
    run(() => api.setCategoryTarget(node.id, target)).then((ok) => ok && setEditingTargetId(null));
  }

  // One target per branch: on a leaf, or on a group (covering its whole subtree), never both.
  function renderTarget(node: CategoryTreeNode) {
    if (editingTargetId !== node.id && node.budget_target == null) {
      // A group whose sub-categories hold targets shows their sum (read-only).
      const sum = treeTarget(node);
      if (sum > 0)
        return (
          <span
            className="text-xs text-zinc-500"
            title="Somme des objectifs de ses sous-catégories (retirez-les pour fixer un objectif sur le groupe)"
          >
            Σ {formatEuro(sum)} / mois
          </span>
        );
      // Covered by a targeted ancestor: no target of its own.
      if (targetedAncestor(node.id, byId)) return null;
    }
    if (editingTargetId === node.id) {
      return (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            saveTarget(node);
          }}
        >
          <input
            autoFocus
            inputMode="decimal"
            placeholder="aucun"
            value={targetInput}
            onChange={(e) => setTargetInput(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setEditingTargetId(null)}
            className="w-24 rounded border border-zinc-300 px-2 py-0.5 text-right text-sm text-zinc-800"
          />
          <span className="text-xs text-zinc-500">€ / mois</span>
          <button type="submit" className="rounded bg-zinc-900 px-2 py-0.5 text-xs text-white">
            Enregistrer
          </button>
          <button
            type="button"
            onClick={() => setEditingTargetId(null)}
            className="text-xs text-zinc-600 hover:text-zinc-900"
          >
            Annuler
          </button>
        </form>
      );
    }
    return node.budget_target != null ? (
      <button
        onClick={() => startEditTarget(node)}
        className="rounded bg-sky-50 px-1.5 py-0.5 text-xs text-sky-800 hover:bg-sky-100"
        title={
          node.children.length > 0
            ? "Objectif de dépense mensuel du groupe entier : cliquer pour modifier (vide = supprimer)"
            : "Objectif de dépense mensuel : cliquer pour modifier (vide = supprimer)"
        }
      >
        {formatEuro(node.budget_target)} / mois
      </button>
    ) : (
      <button
        onClick={() => startEditTarget(node)}
        className="text-xs text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-zinc-900 focus:opacity-100"
        title={
          node.children.length > 0
            ? "Définir un objectif de dépense mensuel pour tout le groupe"
            : "Définir un objectif de dépense mensuel"
        }
      >
        ＋ objectif
      </button>
    );
  }

  /** « 3 ⚙ (42 op.) · 2 ✎ » (what classifies operations into the node) and its monthly average. */
  function renderContents(c: Contents | undefined, net: number | undefined) {
    if ((!c || (c.rules === 0 && c.manual === 0)) && !net) return null;
    return (
      <span className="flex items-center gap-2 text-xs">
        {c && c.rules > 0 && (
          <span title={`${c.rules} règle(s) classant ${c.ruleOperations} opération(s)`}>
            {c.rules} ⚙ ({c.ruleOperations} op.)
          </span>
        )}
        {c && c.manual > 0 && <span title={`${c.manual} opération(s) classée(s) à la main`}>{c.manual} ✎</span>}
        {net ? (
          <span title={averageTitle}>
            <Net amount={net} /> <span className="text-zinc-500">/ mois</span>
          </span>
        ) : null}
      </span>
    );
  }

  function startEditRule(r: Rule) {
    setEditingRuleId(r.id);
    setEditRule(ruleToForm(r));
  }

  async function saveRule(id: number) {
    if (editRule.category_id == null || !editRule.pattern.trim()) return;
    if (await run(() => api.updateRule(id, ruleFormToPayload(editRule)))) setEditingRuleId(null);
  }

  function startAddRule(leafId: number) {
    setAddingRuleIn(leafId);
    setNewRule({ ...emptyRuleForm(), category_id: leafId });
  }

  async function addRule() {
    if (newRule.category_id == null || !newRule.pattern.trim()) return;
    if (await run(() => api.createRule(ruleFormToPayload(newRule)))) setAddingRuleIn(null);
  }

  function startEditNote(tx: Transaction) {
    setEditingNoteTxId(tx.id);
    setEditNoteValue(tx.note ?? "");
  }

  async function saveNote(id: number) {
    if (await run(() => api.updateTransaction(id, { note: editNoteValue.trim() || null })))
      setEditingNoteTxId(null);
  }

  function removeAssignment(tx: Transaction) {
    // Clearing the category lets the rules engine reclaim the row; the note goes with it.
    if (
      confirm(
        `Supprimer le classement manuel de « ${tx.libelle} » ? L’opération repassera sous les règles automatiques.`,
      )
    )
      run(() => api.updateTransaction(tx.id, { category_id: null, note: null }));
  }

  function clearSelection() {
    setSelRules(new Set());
    setSelTx(new Set());
    setMoveTarget(null);
  }

  async function moveSelected() {
    const target = moveTarget != null ? byId.get(moveTarget) : undefined;
    if (!target || (selRules.size === 0 && selTx.size === 0)) return;
    const ruleIds = [...selRules];
    const txIds = [...selTx];
    const back = undoMoves(ruleIds, txIds, rules, manual);
    const ok = await act(async () => {
      await api.moveToCategory(target.id, { rule_ids: ruleIds, transaction_ids: txIds });
      return {
        message: movedMessage(ruleIds.length, txIds.length, shortPath(target)),
        undo: async () => {
          for (const m of back)
            await api.moveToCategory(m.categoryId, { rule_ids: m.rule_ids, transaction_ids: m.transaction_ids });
        },
      };
    });
    if (ok) {
      clearSelection();
      setOpenLeaves((prev) => new Set(prev).add(target.id));
    }
  }

  function classAside(tx: Transaction, categoryId: number) {
    const target = byId.get(categoryId);
    if (!target) return;
    act(async () => {
      await api.updateTransaction(tx.id, { category_id: categoryId });
      return {
        message: `« ${tx.libelle} » classée à la main dans « ${shortPath(target)} »`,
        // Clearing the manual category hands the row back to its rule.
        undo: () => api.updateTransaction(tx.id, { category_id: null }),
      };
    });
  }

  function renderRule(r: Rule) {
    if (editingRuleId === r.id) {
      return (
        <div key={r.id} className="flex flex-wrap items-center gap-2 bg-zinc-50 px-3 py-2">
          <RuleEditor categories={categories} value={editRule} onChange={setEditRule} />
          <button onClick={() => saveRule(r.id)} className="rounded bg-zinc-900 px-3 py-1 text-sm text-white">
            Enregistrer
          </button>
          <button
            onClick={() => setEditingRuleId(null)}
            className="rounded border border-zinc-300 px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-50"
          >
            Annuler
          </button>
        </div>
      );
    }
    const open = openRules.has(r.id);
    return (
      <div key={r.id}>
        <div className="flex items-center gap-2 px-3 py-1">
          <input
            type="checkbox"
            checked={selRules.has(r.id)}
            onChange={() => setSelRules((s) => toggle(s, r.id))}
            aria-label={`Sélectionner la règle « ${r.pattern} »`}
          />
          <button
            onClick={() => setOpenRules((s) => toggle(s, r.id))}
            disabled={r.operation_count === 0}
            className="w-4 text-zinc-600 hover:text-zinc-900 disabled:invisible"
            title={open ? "Masquer ses opérations" : "Voir ses opérations"}
          >
            {open ? "▾" : "▸"}
          </button>
          <span className="font-mono text-xs">{r.pattern}</span>
          {r.is_income_anchor && <span title="Ancre de revenu : ouvre un mois budgétaire">⚓</span>}
          <span className="text-xs text-zinc-500" title="Priorité : le plus petit nombre l’emporte">
            prio {r.priority}
          </span>
          {r.description && <span className="truncate text-zinc-500">{r.description}</span>}
          <span className="ml-auto flex items-center gap-3 whitespace-nowrap">
            {r.operation_count === 0 ? (
              <span className="text-xs text-amber-700" title="Cette règle ne classe aucune opération">
                aucune opération
              </span>
            ) : (
              <>
                <span className="text-xs text-zinc-500">
                  {r.operation_count} opération{r.operation_count > 1 ? "s" : ""}
                </span>
                <Net amount={Math.round((r.credit - r.debit) * 100) / 100} />
              </>
            )}
            <button onClick={() => startEditRule(r)} className="text-zinc-600 hover:text-zinc-900" title="Modifier la règle">
              ✎
            </button>
            <button
              onClick={() => {
                if (confirm(`Supprimer la règle « ${r.pattern} » ?`)) run(() => api.deleteRule(r.id));
              }}
              className="text-zinc-600 hover:text-red-700"
              title="Supprimer la règle"
            >
              ✕
            </button>
          </span>
        </div>
        {open && (
          <RuleOperations key={`${r.id}-${version}`} rule={r} categories={categories} onClassAside={classAside} />
        )}
      </div>
    );
  }

  function renderManual(tx: Transaction) {
    return (
      <tr key={tx.id} className="border-t border-zinc-50 first:border-t-0">
        <td className="w-6 py-1 pl-3 pr-2">
          <input
            type="checkbox"
            checked={selTx.has(tx.id)}
            onChange={() => setSelTx((s) => toggle(s, tx.id))}
            aria-label={`Sélectionner « ${tx.libelle} »`}
          />
        </td>
        <td className="whitespace-nowrap py-1 pr-3 text-zinc-500">{frenchDate(tx.date_valeur)}</td>
        <td className="max-w-xs truncate py-1 pr-3" title={tx.libelle}>
          {tx.libelle}
        </td>
        <td className="whitespace-nowrap py-1 pr-3 text-zinc-500">{tx.account_id ?? tx.account}</td>
        <td className="whitespace-nowrap py-1 pr-3 text-right">
          <SignedAmount tx={tx} />
        </td>
        <td className="py-1 pr-3 text-zinc-500">
          {editingNoteTxId === tx.id ? (
            <input
              autoFocus
              value={editNoteValue}
              onChange={(e) => setEditNoteValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveNote(tx.id);
                if (e.key === "Escape") setEditingNoteTxId(null);
              }}
              placeholder="Description"
              className="w-full rounded border border-zinc-300 px-2 py-0.5 text-sm"
            />
          ) : (
            (tx.note ?? "")
          )}
        </td>
        <td className="whitespace-nowrap py-1 pr-3 text-right">
          {editingNoteTxId === tx.id ? (
            <>
              <button
                onClick={() => saveNote(tx.id)}
                className="mr-2 rounded bg-zinc-900 px-2 py-0.5 text-xs text-white"
              >
                Enregistrer
              </button>
              <button onClick={() => setEditingNoteTxId(null)} className="text-xs text-zinc-600 hover:text-zinc-900">
                Annuler
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => startEditNote(tx)}
                className="mr-2 text-zinc-600 hover:text-zinc-900"
                title="Modifier la description"
              >
                ✎
              </button>
              <button
                onClick={() => removeAssignment(tx)}
                className="text-zinc-600 hover:text-red-700"
                title="Supprimer le classement manuel"
              >
                ✕
              </button>
            </>
          )}
        </td>
      </tr>
    );
  }

  /** A leaf's rules and manual operations, filtered by the search unless the leaf matched by name. */
  function renderLeafContents(node: CategoryTreeNode, depth: number) {
    const filtered = search != null && !search.whole.has(node.id);
    const leafRules = rules
      .filter((r) => r.category_id === node.id && (!filtered || ruleMatches(r, q)))
      .sort((a, b) => a.priority - b.priority || a.id - b.id);
    const leafManual = manual.filter((tx) => tx.category_id === node.id && (!filtered || manualMatches(tx, q)));
    return (
      <div className="space-y-2 pb-3 pr-3 pt-1" style={{ marginLeft: depth * 20 + 32 }}>
        <div className="rounded border border-zinc-200">
          <div className="flex items-center border-b border-zinc-100 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-600">
            ⚙ Règles ({leafRules.length})
            <button
              onClick={() => startAddRule(node.id)}
              className="ml-auto font-normal text-zinc-600 hover:text-zinc-900"
              title="Ajouter une règle dans cette catégorie"
            >
              ＋ règle
            </button>
          </div>
          {leafRules.length === 0 && addingRuleIn !== node.id && (
            <p className="px-3 py-1 text-zinc-500">Aucune règle.</p>
          )}
          {leafRules.map(renderRule)}
          {addingRuleIn === node.id && (
            <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 bg-zinc-50 px-3 py-2">
              <RuleEditor categories={categories} value={newRule} onChange={setNewRule} />
              <button onClick={addRule} className="rounded bg-zinc-900 px-3 py-1 text-sm text-white">
                Ajouter la règle
              </button>
              <button
                onClick={() => setAddingRuleIn(null)}
                className="rounded border border-zinc-300 px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-50"
              >
                Annuler
              </button>
            </div>
          )}
        </div>
        <div className="rounded border border-zinc-200">
          <div className="border-b border-zinc-100 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-600">
            ✎ Opérations classées à la main ({leafManual.length})
          </div>
          {leafManual.length === 0 ? (
            <p className="px-3 py-1 text-zinc-500">Aucune opération classée à la main.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>{leafManual.map(renderManual)}</tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  function renderNode(node: CategoryTreeNode, depth: number) {
    if (search && !search.visible.has(node.id)) return null;
    const isLeaf = node.children.length === 0;
    const open = isLeaf && (openLeaves.has(node.id) || (search?.open.has(node.id) ?? false));
    const indent = { paddingLeft: depth * 20 };
    return (
      <div key={node.id}>
        <div className="group flex items-center gap-2 border-t border-zinc-100 px-3 py-1.5 first:border-t-0">
          {editingCatId === node.id ? (
            <form
              className="flex flex-wrap items-center gap-2"
              style={indent}
              onSubmit={(e) => {
                e.preventDefault();
                saveCat(node);
              }}
            >
              <input
                autoFocus
                value={editCatName}
                onChange={(e) => setEditCatName(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setEditingCatId(null)}
                className="rounded border border-zinc-300 px-2 py-0.5 text-sm"
              />
              <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                sous
                <select
                  value={editCatParent == null ? "" : String(editCatParent)}
                  onChange={(e) => setEditCatParent(e.target.value ? Number(e.target.value) : null)}
                  className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-sm text-zinc-800"
                >
                  {/* Only groups (and current roots) may sit at the top level: a bare leaf promoted
                      to a root would be hidden by CategoryPicker and become unassignable. */}
                  {(node.children.length > 0 || node.parent_id == null) && (
                    <option value="">(groupe principal)</option>
                  )}
                  {parentOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {shortPath(c)}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="rounded bg-zinc-900 px-2 py-0.5 text-xs text-white">
                Enregistrer
              </button>
              <button
                type="button"
                onClick={() => setEditingCatId(null)}
                className="text-xs text-zinc-600 hover:text-zinc-900"
              >
                Annuler
              </button>
            </form>
          ) : (
            <span style={indent} className="flex items-center gap-1.5">
              {isLeaf ? (
                <button
                  onClick={() => setOpenLeaves((s) => toggle(s, node.id))}
                  className="w-4 text-zinc-600 hover:text-zinc-900"
                  title={open ? "Masquer son contenu" : "Voir ses règles et opérations classées à la main"}
                >
                  {open ? "▾" : "▸"}
                </button>
              ) : (
                <span className="w-4" />
              )}
              <span className={node.is_root ? "font-medium" : ""}>{node.name}</span>
            </span>
          )}
          <span className="ml-auto flex items-center gap-3 text-zinc-500">
            {renderContents(contents.get(node.id), nets.get(node.id))}
            {/* A fixed slot, so the amounts line up whether a row has a target or not. */}
            <span className="flex min-w-32 justify-end">{renderTarget(node)}</span>
            <button
              onClick={() => startAddChild(node.id)}
              className="text-zinc-600 hover:text-zinc-900"
              title="Ajouter une sous-catégorie"
            >
              ＋
            </button>
            <button
              onClick={() => startEditCat(node)}
              className="text-zinc-600 hover:text-zinc-900"
              title="Renommer ou déplacer"
            >
              ✎
            </button>
            <button
              onClick={() => {
                const parent = node.parent_id != null ? byId.get(node.parent_id) : undefined;
                const lastChild =
                  parent != null && categories.filter((c) => c.parent_id === node.parent_id).length === 1;
                const msg =
                  lastChild && parent
                    ? `Supprimer « ${node.name} » ? Ses règles, opérations et son objectif remonteront vers « ${parent.name} ».`
                    : `Supprimer la catégorie « ${node.name} » ? Ses règles seront supprimées et ses opérations déclassées.`;
                if (confirm(msg)) run(() => api.deleteCategory(node.id));
              }}
              className="text-zinc-600 hover:text-red-700"
              title="Supprimer la catégorie"
            >
              ✕
            </button>
          </span>
        </div>
        {addingUnder === node.id && (
          <form
            className="flex items-center gap-2 border-t border-zinc-100 px-3 py-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const name = childName.trim();
              if (!name) return;
              const c = contents.get(node.id);
              // Subdividing a populated leaf moves its rules and operations into the new child (a
              // target stays on the category, which then covers the new child too).
              if (
                isLeaf &&
                c != null &&
                (c.rules > 0 || c.manual > 0) &&
                !confirm(
                  `« ${name} » héritera des règles et opérations de « ${node.name} », à répartir ensuite. Continuer ?`,
                )
              )
                return;
              run(() => api.createCategory({ name, parent_id: node.id })).then((ok) => ok && setAddingUnder(null));
            }}
          >
            <input
              autoFocus
              placeholder={`Nouvelle sous-catégorie dans « ${node.name} »`}
              value={childName}
              onChange={(e) => setChildName(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setAddingUnder(null)}
              style={{ paddingLeft: 8, marginLeft: (depth + 1) * 20 + 22 }}
              className="rounded border border-zinc-300 px-2 py-0.5 text-sm"
            />
            <button type="submit" className="rounded bg-zinc-900 px-2 py-0.5 text-xs text-white">
              Ajouter
            </button>
            <button
              type="button"
              onClick={() => setAddingUnder(null)}
              className="text-xs text-zinc-600 hover:text-zinc-900"
            >
              Annuler
            </button>
          </form>
        )}
        {open && renderLeafContents(node, depth)}
        {node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  }

  const selected = selRules.size + selTx.size;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Catégories</h1>
      {averages && (targetSums.spending > 0 || targetSums.savings !== null) && (
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-2">
          <BudgetBalance
            income={Math.round((averages.totals.income - averages.offset.value) * 100) / 100}
            spending={targetSums.spending}
            savings={targetSums.savings}
          />
        </div>
      )}

      <div className="space-y-1 text-sm text-zinc-500">
        <p>
          Un seul arbre, indépendant du sens : revenu ou dépense dépend de chaque opération. ▸ sur une
          sous-catégorie finale montre ce qui y classe des opérations. ＋ ajoute une sous-catégorie (la
          première hérite du contenu de la catégorie, à répartir ensuite), ✎ renomme ou déplace, ✕
          supprime ; « ＋ objectif » fixe un plafond de dépense mensuel, sur une sous-catégorie ou sur
          tout un groupe (un seul objectif par branche), jamais sur un revenu ; celui du groupe « Épargne »
          est l’épargne visée chaque mois. Le montant d’une catégorie est sa
          moyenne mensuelle {(averages && periodSummary(averages, AVERAGE_PERIOD)) || "sur les 12 derniers mois complets"},
          le mois en cours exclu ; celui d’une règle, le total de ses opérations.
        </p>
        <p>
          <strong className="font-medium text-zinc-700">⚙ Une règle</strong> classe toutes les opérations
          dont le libellé contient son motif (sous-chaîne ; la plus petite priorité l’emporte ; ⚓ = ancre
          de revenu) : la déplacer emporte toutes ses opérations.{" "}
          <strong className="font-medium text-zinc-700">✎ Une opération classée à la main</strong> se
          déplace seule, avec sa description. Une opération suivie par une règle ne se déplace pas seule :
          « Classer à part » la classe à la main ailleurs. Cochez des règles et des opérations, puis
          choisissez où les déplacer.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          <p className="flex-1">{error}</p>
          <button onClick={() => setError(null)} className="text-red-700 hover:text-red-900" title="Fermer" aria-label="Fermer">
            ✕
          </button>
        </div>
      )}

      <div className="sticky top-0 z-10 -mx-6 flex flex-wrap items-center gap-3 border-b border-zinc-200 bg-zinc-50/95 px-6 py-2 backdrop-blur">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setQuery("")}
          placeholder="Rechercher une catégorie, un motif, un libellé, une description…"
          className="w-96 rounded border border-zinc-300 bg-white px-2 py-1 text-sm"
        />
        {selected > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-zinc-700">
              {selRules.size > 0 && `${selRules.size} règle${selRules.size > 1 ? "s" : ""}`}
              {selRules.size > 0 && selTx.size > 0 && ", "}
              {selTx.size > 0 && `${selTx.size} opération${selTx.size > 1 ? "s" : ""}`}
            </span>
            <CategoryPicker
              categories={categories}
              value={moveTarget}
              onChange={setMoveTarget}
              highlight
              placeholder="Déplacer vers…"
            />
            <button
              onClick={moveSelected}
              disabled={moveTarget == null}
              className="rounded bg-zinc-900 px-3 py-1 text-white disabled:opacity-40"
            >
              Déplacer
            </button>
            <button onClick={clearSelection} className="text-zinc-600 hover:text-zinc-900">
              Désélectionner
            </button>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white text-sm">
        {tree.length === 0 ? (
          <p className="px-3 py-2 text-zinc-500">Aucune catégorie pour l’instant.</p>
        ) : search && search.visible.size === 0 ? (
          <p className="px-3 py-2 text-zinc-500">Rien ne correspond.</p>
        ) : (
          tree.map((node) => renderNode(node, 0))
        )}
      </div>

      <form
        className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-200 bg-white p-4 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          const name = newGroup.trim();
          if (!name) return;
          run(() => api.createCategory({ name, parent_id: null })).then((ok) => ok && setNewGroup(""));
        }}
      >
        <input
          required
          placeholder="Nouveau groupe principal"
          value={newGroup}
          onChange={(e) => setNewGroup(e.target.value)}
          className="rounded border border-zinc-300 px-2 py-1"
        />
        <button type="submit" className="rounded bg-zinc-900 px-3 py-1 text-white">
          Ajouter le groupe
        </button>
      </form>

      {toast && (
        <div className="fixed bottom-6 right-6 flex items-center gap-4 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm shadow-lg">
          <span className="text-green-700">{toast.message}</span>
          <button onClick={undo} className="font-medium text-zinc-600 hover:text-zinc-900" title="Alt+Z">
            Annuler
          </button>
        </div>
      )}
    </div>
  );
}
