import { useState } from "react";
import { api, type Category, shortPath } from "@/lib/api";
import { type CategoryTreeNode, type Contents, reparentOptions } from "@/lib/categoryTree";
import CategoryTarget from "./CategoryTarget";
import Net from "./Net";

/** « 3 ⚙ (42 op.) · 2 ✎ » (what classifies operations into the node) and its monthly average. */
function NodeSummary({
  contents,
  net,
  averageTitle,
}: {
  contents: Contents | undefined;
  net: number | undefined;
  averageTitle: string;
}) {
  if ((!contents || (contents.rules === 0 && contents.manual === 0)) && !net) return null;
  return (
    <span className="flex items-center gap-2 text-xs">
      {contents && contents.rules > 0 && (
        <span title={`${contents.rules} règle(s) classant ${contents.ruleOperations} opération(s)`}>
          {contents.rules} ⚙ ({contents.ruleOperations} op.)
        </span>
      )}
      {contents && contents.manual > 0 && (
        <span title={`${contents.manual} opération(s) classée(s) à la main`}>{contents.manual} ✎</span>
      )}
      {net ? (
        <span title={averageTitle}>
          <Net amount={net} /> <span className="text-zinc-500">/ mois</span>
        </span>
      ) : null}
    </span>
  );
}

/** One category line of the tree (rename / move, target, add a sub-category, delete) and its
 *  add-child form. `run` performs a change then reloads the page, resolving false when it failed. */
export default function CategoryRow({
  node,
  depth,
  categories,
  byId,
  open,
  contents,
  net,
  averageTitle,
  onToggleOpen,
  run,
  onError,
}: {
  node: CategoryTreeNode;
  depth: number;
  categories: Category[];
  byId: Map<number, Category>;
  open: boolean;
  contents: Contents | undefined;
  net: number | undefined;
  averageTitle: string;
  onToggleOpen: () => void;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  onError: (message: string) => void;
}) {
  const isLeaf = node.children.length === 0;
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editParent, setEditParent] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [childName, setChildName] = useState("");
  const indent = { paddingLeft: depth * 20 };

  function startAddChild() {
    setEditing(false);
    setAdding(true);
    setChildName("");
  }

  function startEdit() {
    setAdding(false);
    setEditing(true);
    setEditName(node.name);
    setEditParent(node.parent_id);
  }

  async function save() {
    const name = editName.trim();
    if (!name) return;
    if (await run(() => api.updateCategory(node.id, { name, parent_id: editParent }))) setEditing(false);
  }

  async function addChild() {
    const name = childName.trim();
    if (!name) return;
    // Subdividing a populated leaf moves its rules and operations into the new child (a target
    // stays on the category, which then covers the new child too).
    if (
      isLeaf &&
      contents != null &&
      (contents.rules > 0 || contents.manual > 0) &&
      !confirm(`« ${name} » héritera des règles et opérations de « ${node.name} », à répartir ensuite. Continuer ?`)
    )
      return;
    if (await run(() => api.createCategory({ name, parent_id: node.id }))) setAdding(false);
  }

  function remove() {
    const parent = node.parent_id != null ? byId.get(node.parent_id) : undefined;
    const lastChild = parent != null && categories.filter((c) => c.parent_id === node.parent_id).length === 1;
    const msg =
      lastChild && parent
        ? `Supprimer « ${node.name} » ? Ses règles, opérations et son objectif remonteront vers « ${parent.name} ».`
        : `Supprimer la catégorie « ${node.name} » ? Ses règles seront supprimées et ses opérations déclassées.`;
    if (confirm(msg)) run(() => api.deleteCategory(node.id));
  }

  return (
    <>
      <div className="group flex items-center gap-2 border-t border-zinc-100 px-3 py-1.5 first:border-t-0">
        {editing ? (
          <form
            className="flex flex-wrap items-center gap-2"
            style={indent}
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <input
              autoFocus
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
              className="rounded border border-zinc-300 px-2 py-0.5 text-sm"
            />
            <label className="flex items-center gap-1.5 text-xs text-zinc-500">
              sous
              <select
                value={editParent == null ? "" : String(editParent)}
                onChange={(e) => setEditParent(e.target.value ? Number(e.target.value) : null)}
                className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-sm text-zinc-800"
              >
                {/* Only groups (and current roots) may sit at the top level: a bare leaf promoted
                    to a root would be hidden by CategoryPicker and become unassignable. */}
                {(!isLeaf || node.parent_id == null) && <option value="">(groupe principal)</option>}
                {reparentOptions(categories, node.id).map((c) => (
                  <option key={c.id} value={c.id}>
                    {shortPath(c)}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn-primary px-2 py-0.5 text-xs">
              Enregistrer
            </button>
            <button type="button" onClick={() => setEditing(false)} className="text-xs text-zinc-600 hover:text-zinc-900">
              Annuler
            </button>
          </form>
        ) : (
          <span style={indent} className="flex items-center gap-1.5">
            {isLeaf ? (
              <button
                onClick={onToggleOpen}
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
          <NodeSummary contents={contents} net={net} averageTitle={averageTitle} />
          {/* A fixed slot, so the amounts line up whether a row has a target or not. */}
          <span className="flex min-w-32 justify-end">
            <CategoryTarget
              node={node}
              byId={byId}
              onSave={(target) => run(() => api.setCategoryTarget(node.id, target))}
              onInvalid={onError}
            />
          </span>
          <button onClick={startAddChild} className="text-zinc-600 hover:text-zinc-900" title="Ajouter une sous-catégorie">
            ＋
          </button>
          <button onClick={startEdit} className="text-zinc-600 hover:text-zinc-900" title="Renommer ou déplacer">
            ✎
          </button>
          <button onClick={remove} className="text-zinc-600 hover:text-red-700" title="Supprimer la catégorie">
            ✕
          </button>
        </span>
      </div>
      {adding && (
        <form
          className="flex items-center gap-2 border-t border-zinc-100 px-3 py-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            addChild();
          }}
        >
          <input
            autoFocus
            placeholder={`Nouvelle sous-catégorie dans « ${node.name} »`}
            value={childName}
            onChange={(e) => setChildName(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
            style={{ paddingLeft: 8, marginLeft: (depth + 1) * 20 + 22 }}
            className="rounded border border-zinc-300 px-2 py-0.5 text-sm"
          />
          <button type="submit" className="btn-primary px-2 py-0.5 text-xs">
            Ajouter
          </button>
          <button type="button" onClick={() => setAdding(false)} className="text-xs text-zinc-600 hover:text-zinc-900">
            Annuler
          </button>
        </form>
      )}
    </>
  );
}
