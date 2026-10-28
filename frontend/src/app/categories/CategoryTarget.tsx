import { useState } from "react";
import { type Category, formatEuro } from "@/lib/api";
import { parseTarget } from "@/lib/budget";
import { type CategoryTreeNode, targetedAncestor, treeTarget } from "@/lib/categoryTree";

/** A node's budget target slot. One target per branch: on a leaf, or on a group (covering its whole
 *  subtree), never both. `onSave` resolves false when the save failed (the editor stays open). */
export default function CategoryTarget({
  node,
  byId,
  onSave,
  onInvalid,
}: {
  node: CategoryTreeNode;
  byId: Map<number, Category>;
  onSave: (target: number | null) => Promise<boolean>;
  onInvalid: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");

  function startEdit() {
    setEditing(true);
    setInput(node.budget_target != null ? String(node.budget_target).replace(".", ",") : "");
  }

  async function save() {
    const target = parseTarget(input);
    if (Number.isNaN(target)) {
      onInvalid(`Objectif invalide pour « ${node.name} » : saisissez un montant positif, ou laissez vide.`);
      return;
    }
    if (await onSave(target)) setEditing(false);
  }

  if (!editing && node.budget_target == null) {
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
  if (editing) {
    return (
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input
          autoFocus
          inputMode="decimal"
          placeholder="aucun"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          className="w-24 rounded border border-zinc-300 px-2 py-0.5 text-right text-sm text-zinc-800"
        />
        <span className="text-xs text-zinc-500">€ / mois</span>
        <button type="submit" className="btn-primary px-2 py-0.5 text-xs">
          Enregistrer
        </button>
        <button type="button" onClick={() => setEditing(false)} className="text-xs text-zinc-600 hover:text-zinc-900">
          Annuler
        </button>
      </form>
    );
  }
  return node.budget_target != null ? (
    <button
      onClick={startEdit}
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
      onClick={startEdit}
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
