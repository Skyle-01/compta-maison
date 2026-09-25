"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type Category, type Rule, type Transaction, formatEuro, shortPath } from "@/lib/api";
import CategoryPicker from "@/components/CategoryPicker";

type CategoryNode = Category & { children: CategoryNode[] };

/** Editable mirror of a Rule (numbers kept as strings while typing). */
type RuleForm = {
  category_id: number | null;
  pattern: string;
  priority: string;
  is_income_anchor: boolean;
  description: string;
};

const emptyRuleForm = (): RuleForm => ({
  category_id: null,
  pattern: "",
  priority: "100",
  is_income_anchor: false,
  description: "",
});

const ruleFormToPayload = (f: RuleForm): Omit<Rule, "id"> => ({
  category_id: f.category_id as number,
  pattern: f.pattern.trim(),
  priority: Number(f.priority) || 100,
  is_income_anchor: f.is_income_anchor,
  description: f.description.trim() || null,
});

function buildTree(cats: Category[]): CategoryNode[] {
  const map = new Map<number, CategoryNode>(cats.map((c) => [c.id, { ...c, children: [] }]));
  const roots: CategoryNode[] = [];
  for (const n of map.values()) {
    const parent = n.parent_id != null ? map.get(n.parent_id) : undefined;
    if (parent) parent.children.push(n);
    else roots.push(n);
  }
  const sortRec = (ns: CategoryNode[]) => {
    ns.sort((a, b) => a.name.localeCompare(b.name));
    ns.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
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
        placeholder="— catégorie —"
      />
      <input
        type="number"
        title="Priorité — le plus petit nombre l’emporte"
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

export default function SettingsPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Inline category-tree editing state.
  const [newGroup, setNewGroup] = useState("");
  const [addingUnder, setAddingUnder] = useState<number | null>(null);
  const [childName, setChildName] = useState("");
  const [editingCatId, setEditingCatId] = useState<number | null>(null);
  const [editCatName, setEditCatName] = useState("");
  const [editCatParent, setEditCatParent] = useState<number | null>(null);

  // Rules: search, sort, inline edit, and a brief flash on the just-touched row.
  const [ruleQuery, setRuleQuery] = useState("");
  const [sortKey, setSortKey] = useState<"priority" | "pattern" | "category">("priority");
  const [sortAsc, setSortAsc] = useState(true);
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
  const [editRule, setEditRule] = useState<RuleForm>(emptyRuleForm());
  const [newRule, setNewRule] = useState<RuleForm>(emptyRuleForm());
  const [flashRuleId, setFlashRuleId] = useState<number | null>(null);

  // Manual assignments: list, search, inline note edit, and a brief flash on the just-edited row.
  const [manualTx, setManualTx] = useState<Transaction[]>([]);
  const [manualQuery, setManualQuery] = useState("");
  const [editingNoteTxId, setEditingNoteTxId] = useState<number | null>(null);
  const [editNoteValue, setEditNoteValue] = useState("");
  const [flashTxId, setFlashTxId] = useState<number | null>(null);

  const load = useCallback(() => {
    Promise.all([
      api.listCategories(),
      api.listRules(),
      api.listTransactions({ manual: true, limit: 1000 }),
    ])
      .then(([cats, ruleList, manual]) => {
        setCategories(cats);
        setRules(ruleList);
        setManualTx(manual.items);
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(load, [load]);

  // Clear the row highlight shortly after a create/edit so it reads as a transient "here it is".
  useEffect(() => {
    if (flashRuleId == null) return;
    const timer = setTimeout(() => setFlashRuleId(null), 1600);
    return () => clearTimeout(timer);
  }, [flashRuleId]);

  useEffect(() => {
    if (flashTxId == null) return;
    const timer = setTimeout(() => setFlashTxId(null), 1600);
    return () => clearTimeout(timer);
  }, [flashTxId]);

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setError(null);
    try {
      await action();
      load();
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  }

  const byId = new Map(categories.map((c) => [c.id, c]));
  const tree = buildTree(categories);

  // Valid re-parent targets: roots and existing groups (nodes that already have children — by the
  // leaf-only invariant those carry no direct tx/rules, so reject_populated_parent won't fire),
  // excluding the edited node and its descendants (would create a cycle). Plus "— groupe principal —".
  const parentIdSet = new Set(
    categories.map((c) => c.parent_id).filter((id): id is number => id != null),
  );
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

  function startEditRule(r: Rule) {
    setEditingRuleId(r.id);
    setEditRule({
      category_id: r.category_id,
      pattern: r.pattern,
      priority: String(r.priority),
      is_income_anchor: r.is_income_anchor,
      description: r.description ?? "",
    });
  }

  async function saveRule(id: number) {
    if (editRule.category_id == null || !editRule.pattern.trim()) return;
    const ok = await run(() => api.updateRule(id, ruleFormToPayload(editRule)));
    if (ok) {
      setEditingRuleId(null);
      setFlashRuleId(id);
    }
  }

  async function addRule() {
    if (newRule.category_id == null || !newRule.pattern.trim()) return;
    setError(null);
    try {
      const created = await api.createRule(ruleFormToPayload(newRule));
      setNewRule(emptyRuleForm());
      load();
      setFlashRuleId(created.id); // surface where the new rule landed in the sorted list
    } catch (e) {
      setError(String(e));
    }
  }

  function startEditNote(tx: Transaction) {
    setEditingNoteTxId(tx.id);
    setEditNoteValue(tx.note ?? "");
  }

  async function saveNote(id: number) {
    const ok = await run(() => api.updateTransaction(id, { note: editNoteValue.trim() || null }));
    if (ok) {
      setEditingNoteTxId(null);
      setFlashTxId(id);
    }
  }

  function deleteAssignment(tx: Transaction) {
    // Clearing the category lets the rules engine reclaim the row; the note goes with it.
    if (
      confirm(
        `Supprimer le classement manuel de « ${tx.libelle} » ? L’opération repassera sous les règles automatiques.`,
      )
    )
      run(() => api.updateTransaction(tx.id, { category_id: null, note: null }));
  }

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  }
  const sortArrow = (key: typeof sortKey) => (sortKey === key ? (sortAsc ? " ▲" : " ▼") : "");

  const query = ruleQuery.trim().toLowerCase();
  const visibleRules = rules
    .filter((r) => {
      if (!query) return true;
      const path = (byId.get(r.category_id)?.path ?? "").toLowerCase();
      return (
        r.pattern.toLowerCase().includes(query) ||
        path.includes(query) ||
        (r.description ?? "").toLowerCase().includes(query)
      );
    })
    .sort((a, b) => {
      let cmp: number;
      if (sortKey === "priority") cmp = a.priority - b.priority || a.id - b.id;
      else if (sortKey === "pattern") cmp = a.pattern.localeCompare(b.pattern);
      else
        cmp = (byId.get(a.category_id)?.path ?? "").localeCompare(byId.get(b.category_id)?.path ?? "");
      return sortAsc ? cmp : -cmp;
    });

  const manualPath = (tx: Transaction) =>
    (tx.category_id != null ? byId.get(tx.category_id)?.path : null) ?? tx.category ?? "";
  const mQuery = manualQuery.trim().toLowerCase();
  const visibleManual = manualTx.filter((tx) => {
    if (!mQuery) return true;
    return (
      tx.libelle.toLowerCase().includes(mQuery) ||
      manualPath(tx).toLowerCase().includes(mQuery) ||
      (tx.note ?? "").toLowerCase().includes(mQuery)
    );
  });

  function renderNode(node: CategoryNode, depth: number) {
    const indent = { paddingLeft: depth * 20 + 12 };
    return (
      <div key={node.id}>
        <div className="flex items-center gap-2 border-t border-zinc-100 px-3 py-1.5 first:border-t-0">
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
                  {/* Only groups (and current roots) may sit at the top level — a bare leaf promoted
                      to a root would be hidden by CategoryPicker and become unassignable. */}
                  {(node.children.length > 0 || node.parent_id == null) && (
                    <option value="">— groupe principal —</option>
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
                className="text-xs text-zinc-400 hover:text-zinc-700"
              >
                Annuler
              </button>
            </form>
          ) : (
            <span style={indent} className={node.is_root ? "font-medium" : ""}>
              {node.name}
            </span>
          )}
          <span className="ml-auto flex items-center gap-2 text-zinc-400">
            {node.rule_count > 0 && (
              <span className="text-xs" title={`${node.rule_count} règle(s)`}>
                {node.rule_count} ⚙
              </span>
            )}
            <button
              onClick={() => startAddChild(node.id)}
              className="hover:text-zinc-900"
              title="Ajouter une sous-catégorie"
            >
              ＋
            </button>
            <button
              onClick={() => startEditCat(node)}
              className="hover:text-zinc-900"
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
                    ? `Supprimer « ${node.name} » ? Ses règles et opérations remonteront vers « ${parent.name} ».`
                    : `Supprimer la catégorie « ${node.name} » ? Ses règles seront supprimées et ses opérations déclassées.`;
                if (confirm(msg)) run(() => api.deleteCategory(node.id));
              }}
              className="hover:text-red-700"
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
              // Subdividing a populated leaf moves its rules + operations into the new child.
              if (
                node.rule_count > 0 &&
                !confirm(`« ${name} » héritera des règles et opérations de « ${node.name} ». Continuer ?`)
              )
                return;
              run(() => api.createCategory({ name, parent_id: node.id })).then(
                (ok) => ok && setAddingUnder(null)
              );
            }}
          >
            <input
              autoFocus
              placeholder={`Nouvelle sous-catégorie dans « ${node.name} »`}
              value={childName}
              onChange={(e) => setChildName(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setAddingUnder(null)}
              style={{ paddingLeft: 8, marginLeft: (depth + 1) * 20 + 12 }}
              className="rounded border border-zinc-300 px-2 py-0.5 text-sm"
            />
            <button type="submit" className="rounded bg-zinc-900 px-2 py-0.5 text-xs text-white">
              Ajouter
            </button>
            <button
              type="button"
              onClick={() => setAddingUnder(null)}
              className="text-xs text-zinc-400 hover:text-zinc-700"
            >
              Annuler
            </button>
          </form>
        )}
        {node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {error && <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      <section className="space-y-3">
        <div className="flex items-center">
          <h1 className="text-xl font-semibold">Catégories</h1>
          <a
            href="/api/categories/export"
            download
            className="ml-auto rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50"
          >
            Exporter CSV
          </a>
        </div>
        <p className="text-sm text-zinc-500">
          Un seul arbre, indépendant du sens — revenu ou dépense dépend de chaque opération, pas de
          la catégorie. ＋ pour imbriquer une sous-catégorie sous n’importe quel nœud (sans limite de
          profondeur), ✎ pour renommer ou déplacer sous un autre groupe, ✕ pour supprimer (un groupe
          doit d’abord être vidé de ses enfants).
        </p>
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white text-sm">
          {tree.length === 0 ? (
            <p className="px-3 py-2 text-zinc-400">Aucune catégorie pour l’instant.</p>
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
      </section>

      <section className="space-y-3">
        <div className="flex items-center">
          <h1 className="text-xl font-semibold">Règles de classement</h1>
          <a
            href="/api/rules/export"
            download
            className="ml-auto rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50"
          >
            Exporter CSV
          </a>
        </div>
        <p className="text-sm text-zinc-500">
          Les règles sont de simples sous-chaînes comparées au libellé bancaire (pas de regex). En
          cas de correspondance multiple, la règle au plus petit numéro de priorité l’emporte. ⚓
          signale les ancres de revenu : ces dépôts ouvrent un nouveau mois budgétaire (périodes de
          paie à paie). ✎ pour modifier une règle ; cliquez un en-tête pour trier.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <input
            value={ruleQuery}
            onChange={(e) => setRuleQuery(e.target.value)}
            placeholder="Rechercher un motif, une catégorie, une description…"
            className="w-full max-w-sm rounded border border-zinc-300 px-2 py-1 text-sm"
          />
          <span className="text-sm text-zinc-400">
            {visibleRules.length}
            {visibleRules.length !== rules.length ? ` / ${rules.length}` : ""} règle(s)
          </span>
        </div>

        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-zinc-500">
              <tr>
                <th
                  onClick={() => toggleSort("priority")}
                  className="cursor-pointer select-none px-3 py-2 text-right font-medium hover:text-zinc-800"
                >
                  Prio{sortArrow("priority")}
                </th>
                <th
                  onClick={() => toggleSort("pattern")}
                  className="cursor-pointer select-none px-3 py-2 font-medium hover:text-zinc-800"
                >
                  Motif{sortArrow("pattern")}
                </th>
                <th
                  onClick={() => toggleSort("category")}
                  className="cursor-pointer select-none px-3 py-2 font-medium hover:text-zinc-800"
                >
                  Catégorie{sortArrow("category")}
                </th>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {visibleRules.map((r) => {
                const category = byId.get(r.category_id);
                if (editingRuleId === r.id) {
                  return (
                    <tr key={r.id} className="border-t border-zinc-100 bg-zinc-50">
                      <td colSpan={5} className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <RuleEditor categories={categories} value={editRule} onChange={setEditRule} />
                          <button
                            onClick={() => saveRule(r.id)}
                            className="rounded bg-zinc-900 px-3 py-1 text-sm text-white"
                          >
                            Enregistrer
                          </button>
                          <button
                            onClick={() => setEditingRuleId(null)}
                            className="rounded border border-zinc-300 px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-50"
                          >
                            Annuler
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr
                    key={r.id}
                    className={`border-t border-zinc-100 ${flashRuleId === r.id ? "bg-amber-50" : ""}`}
                  >
                    <td className="px-3 py-1.5 text-right text-zinc-400">{r.priority}</td>
                    <td className="px-3 py-1.5 font-mono text-xs">
                      {r.pattern}
                      {r.is_income_anchor && (
                        <span className="ml-1" title="Ancre de revenu — ouvre un mois budgétaire">
                          ⚓
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">{category ? shortPath(category) : r.category_id}</td>
                    <td className="px-3 py-1.5 text-zinc-500">{r.description ?? ""}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right">
                      <button
                        onClick={() => startEditRule(r)}
                        className="mr-2 text-zinc-400 hover:text-zinc-900"
                        title="Modifier la règle"
                      >
                        ✎
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Supprimer la règle « ${r.pattern} » ?`)) run(() => api.deleteRule(r.id));
                        }}
                        className="text-zinc-400 hover:text-red-700"
                        title="Supprimer la règle"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
              {visibleRules.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-zinc-500">
                    {rules.length === 0 ? "Aucune règle pour l’instant." : "Aucune règle ne correspond."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-200 bg-white p-4">
          <RuleEditor categories={categories} value={newRule} onChange={setNewRule} />
          <button onClick={addRule} className="rounded bg-zinc-900 px-3 py-1 text-sm text-white">
            Ajouter la règle
          </button>
        </div>
      </section>

      <TransferMarkersSection />

      <section className="space-y-3">
        <div className="flex items-center">
          <h1 className="text-xl font-semibold">Modifications manuelles</h1>
          <a
            href="/api/transactions/export-overrides"
            download
            className="ml-auto rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50"
          >
            Exporter CSV
          </a>
        </div>
        <p className="text-sm text-zinc-500">
          Les opérations que vous avez classées à la main (catégorie choisie directement plutôt que
          par une règle), avec leur description. ✎ pour modifier la description, ✕ pour supprimer le
          classement — l’opération repassera alors sous les règles automatiques. Exportez-les avant
          de réinitialiser la base — ils sont indexés par une empreinte d’opération stable, donc les
          restaurer avec <span className="font-mono text-xs">import_csv.py --overrides</span> les
          réapplique après un nouveau seed.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <input
            value={manualQuery}
            onChange={(e) => setManualQuery(e.target.value)}
            placeholder="Rechercher un libellé, une catégorie, une description…"
            className="w-full max-w-sm rounded border border-zinc-300 px-2 py-1 text-sm"
          />
          <span className="text-sm text-zinc-400">
            {visibleManual.length}
            {visibleManual.length !== manualTx.length ? ` / ${manualTx.length}` : ""} opération(s)
          </span>
        </div>

        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Libellé</th>
                <th className="px-3 py-2 font-medium">Compte</th>
                <th className="px-3 py-2 text-right font-medium">Montant</th>
                <th className="px-3 py-2 font-medium">Catégorie</th>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {visibleManual.map((tx) => (
                <tr
                  key={tx.id}
                  className={`border-t border-zinc-100 ${flashTxId === tx.id ? "bg-amber-50" : ""}`}
                >
                  <td className="whitespace-nowrap px-3 py-1.5 text-zinc-500">{tx.date_valeur}</td>
                  <td className="max-w-xs truncate px-3 py-1.5" title={tx.libelle}>
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
                  <td className="px-3 py-1.5">{manualPath(tx)}</td>
                  <td className="px-3 py-1.5 text-zinc-500">
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
                      tx.note ?? ""
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right">
                    {editingNoteTxId === tx.id ? (
                      <>
                        <button
                          onClick={() => saveNote(tx.id)}
                          className="mr-2 text-zinc-600 hover:text-zinc-900"
                        >
                          Enregistrer
                        </button>
                        <button
                          onClick={() => setEditingNoteTxId(null)}
                          className="text-zinc-400 hover:text-zinc-700"
                        >
                          Annuler
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => startEditNote(tx)}
                          className="mr-2 text-zinc-400 hover:text-zinc-900"
                          title="Modifier la description"
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => deleteAssignment(tx)}
                          className="text-zinc-400 hover:text-red-700"
                          title="Supprimer le classement manuel"
                        >
                          ✕
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {visibleManual.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-zinc-500">
                    {manualTx.length === 0
                      ? "Aucune modification manuelle pour l’instant."
                      : "Aucune opération ne correspond."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/** Label prefixes that identify a virement for automatic transfer pairing. */
function TransferMarkersSection() {
  const [text, setText] = useState("");
  const [isDefault, setIsDefault] = useState(true);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    api
      .getTransferMarkers()
      .then((m) => {
        setText(m.markers.join("\n"));
        setIsDefault(m.is_default);
      })
      .catch((e) => setStatus(String(e)));
  }, []);

  async function save() {
    try {
      const m = await api.setTransferMarkers(text.split("\n"));
      setText(m.markers.join("\n"));
      setIsDefault(m.is_default);
      setStatus("Enregistré — virements recalculés.");
    } catch (e) {
      setStatus(String(e));
    }
  }

  return (
    <section className="space-y-3">
      <h1 className="text-xl font-semibold">Virements internes</h1>
      <p className="text-sm text-zinc-500">
        Un débit et un crédit de même montant sur deux comptes, à 3 jours d’écart au plus, sont
        associés en virement (exclus des revenus/dépenses) si les deux libellés commencent par l’un
        de ces préfixes (un par ligne, sans distinction de casse ; « * » = tout libellé). Liste vide =
        valeur par défaut. Pour corriger un cas précis, utilisez la page Transactions (Associer /
        Dissocier).
      </p>
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 bg-white p-4 text-sm">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          className="w-48 rounded border border-zinc-300 px-2 py-1 font-mono text-xs"
        />
        <button onClick={save} className="rounded bg-zinc-900 px-3 py-1 text-white">
          Enregistrer
        </button>
        {isDefault && <span className="text-xs text-zinc-400">(par défaut)</span>}
        {status && <span className="text-xs text-zinc-500">{status}</span>}
      </div>
    </section>
  );
}
