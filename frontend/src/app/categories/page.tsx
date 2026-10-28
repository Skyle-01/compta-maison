"use client";

import { useCallback, useEffect, useState } from "react";
import HelpLink from "@/components/HelpLink";
import {
  api,
  errorMessage,
  type Category,
  type CategoryAverages,
  notifyUncategorizedChanged,
  type Rule,
  shortPath,
  type Transaction,
} from "@/lib/api";
import CategoryPicker from "@/components/CategoryPicker";
import { periodSummary } from "@/lib/averages";
import { BudgetBalance } from "@/components/BudgetSection";
import { categoryTargets, incomeReference } from "@/lib/budget";
import {
  averageNets,
  buildTree,
  type CategoryTreeNode,
  contentsByCategory,
  manualMatches,
  movedMessage,
  ruleMatches,
  searchTree,
  undoMoves,
} from "@/lib/categoryTree";
import { fold } from "@/lib/categorySearch";
import { type RuleForm, ruleFormToPayload } from "@/lib/ruleForm";
import CategoryRow from "./CategoryRow";
import LeafContents, { type LeafActions } from "./LeafContents";

const UNDO_DELAY_MS = 8000;
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

const toggled = (set: Set<number>, id: number) => {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

export default function CategoriesPage() {
  // null until the first load ends, so the empty-tree message never shows while loading.
  const [loadedCategories, setCategories] = useState<Category[] | null>(null);
  const categories = loadedCategories ?? [];
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

  const [newGroup, setNewGroup] = useState("");

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

  const leafActions: LeafActions = {
    toggleRuleSelected: (id) => setSelRules((s) => toggled(s, id)),
    toggleTxSelected: (id) => setSelTx((s) => toggled(s, id)),
    toggleRuleOpen: (id) => setOpenRules((s) => toggled(s, id)),
    async createRule(form: RuleForm) {
      if (form.category_id == null || !form.pattern.trim()) return false;
      return run(() => api.createRule(ruleFormToPayload(form)));
    },
    async updateRule(id: number, form: RuleForm) {
      if (form.category_id == null || !form.pattern.trim()) return false;
      return run(() => api.updateRule(id, ruleFormToPayload(form)));
    },
    deleteRule(rule) {
      if (confirm(`Supprimer la règle « ${rule.pattern} » ?`)) run(() => api.deleteRule(rule.id));
    },
    classAside(tx, categoryId) {
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
    },
    saveNote: (id, note) => run(() => api.updateTransaction(id, { note: note.trim() || null })),
    removeAssignment(tx) {
      // Clearing the category lets the rules engine reclaim the row; the note goes with it.
      if (
        confirm(
          `Supprimer le classement manuel de « ${tx.libelle} » ? L'opération repassera sous les règles automatiques.`,
        )
      )
        run(() => api.updateTransaction(tx.id, { category_id: null, note: null }));
    },
  };

  /** A leaf's rules and manual operations, filtered by the search unless the leaf matched by name. */
  function renderLeafContents(node: CategoryTreeNode, depth: number) {
    const filtered = search != null && !search.whole.has(node.id);
    const leafRules = rules
      .filter((r) => r.category_id === node.id && (!filtered || ruleMatches(r, q)))
      .sort((a, b) => a.priority - b.priority || a.id - b.id);
    const leafManual = manual.filter((tx) => tx.category_id === node.id && (!filtered || manualMatches(tx, q)));
    return (
      <LeafContents
        leafId={node.id}
        depth={depth}
        categories={categories}
        rules={leafRules}
        manual={leafManual}
        selectedRules={selRules}
        selectedTx={selTx}
        openRules={openRules}
        version={version}
        actions={leafActions}
      />
    );
  }

  function renderNode(node: CategoryTreeNode, depth: number) {
    if (search && !search.visible.has(node.id)) return null;
    const isLeaf = node.children.length === 0;
    const open = isLeaf && (openLeaves.has(node.id) || (search?.open.has(node.id) ?? false));
    return (
      <div key={node.id}>
        <CategoryRow
          node={node}
          depth={depth}
          categories={categories}
          byId={byId}
          open={open}
          contents={contents.get(node.id)}
          net={nets.get(node.id)}
          averageTitle={averageTitle}
          onToggleOpen={() => setOpenLeaves((s) => toggled(s, node.id))}
          run={run}
          onError={setError}
        />
        {open && renderLeafContents(node, depth)}
        {node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  }

  const selected = selRules.size + selTx.size;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">
        Catégories
        <HelpLink page="/categories" />
      </h1>
      {averages && (targetSums.spending > 0 || targetSums.savings !== null) && (
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-2">
          <BudgetBalance
            income={incomeReference(averages)}
            spending={targetSums.spending}
            savings={targetSums.savings}
          />
        </div>
      )}

      <details className="text-sm text-zinc-500">
        <summary className="w-fit cursor-pointer text-zinc-600 hover:text-zinc-900">Comment ça marche</summary>
        <div className="mt-2 space-y-1">
          <p>
            Un seul arbre, indépendant du sens : revenu ou dépense dépend de chaque opération. ▸ sur une
            sous-catégorie finale montre ce qui y classe des opérations. ＋ ajoute une sous-catégorie (la
            première hérite du contenu de la catégorie, à répartir ensuite), ✎ renomme ou déplace, ✕
            supprime ; « ＋ objectif » fixe un plafond de dépense mensuel, sur une sous-catégorie ou sur
            tout un groupe (un seul objectif par branche), jamais sur un revenu ; celui du groupe « Épargne »
            est l&apos;épargne visée chaque mois. Le montant d&apos;une catégorie est sa
            moyenne mensuelle {(averages && periodSummary(averages, AVERAGE_PERIOD)) || "sur les 12 derniers mois complets"},
            le mois en cours exclu ; celui d&apos;une règle, le total de ses opérations.
          </p>
          <p>
            <strong className="font-medium text-zinc-700">⚙ Une règle</strong> classe toutes les opérations
            dont le libellé contient son motif (sous-chaîne ; la plus petite priorité l&apos;emporte ; ⚓ = ancre
            de revenu) : la déplacer emporte toutes ses opérations.{" "}
            <strong className="font-medium text-zinc-700">✎ Une opération classée à la main</strong> se
            déplace seule, avec sa description. Une opération suivie par une règle ne se déplace pas seule :
            « Classer à part » la classe à la main ailleurs. Cochez des règles et des opérations, puis
            choisissez où les déplacer.
          </p>
        </div>
      </details>

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
          className="w-[28rem] rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm"
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
            <button onClick={moveSelected} disabled={moveTarget == null} className="btn-primary">
              Déplacer
            </button>
            <button onClick={clearSelection} className="text-zinc-600 hover:text-zinc-900">
              Désélectionner
            </button>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white text-sm">
        {loadedCategories === null && !error ? (
          <p className="px-3 py-2 text-zinc-500">Chargement…</p>
        ) : tree.length === 0 ? (
          <p className="px-3 py-2 text-zinc-500">Aucune catégorie pour l&apos;instant.</p>
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
          className="w-64 rounded border border-zinc-300 px-2 py-1.5"
        />
        <button type="submit" className="btn-primary">
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
