import { useState } from "react";
import type { Category, Rule, Transaction } from "@/lib/api";
import { emptyRuleForm, type RuleForm, ruleToForm } from "@/lib/ruleForm";
import Net from "./Net";
import RuleEditor from "./RuleEditor";
import RuleOperations from "./RuleOperations";

/** One rule of a leaf: its summary line (tick, expand to its operations, edit, delete), or its
 *  inline editor. `onSave` resolves false when the save failed (the editor stays open). */
export default function RuleRow({
  rule,
  categories,
  selected,
  open,
  version,
  onToggleSelected,
  onToggleOpen,
  onSave,
  onDelete,
  onClassAside,
}: {
  rule: Rule;
  categories: Category[];
  selected: boolean;
  open: boolean;
  /** Bumped after every reload, so the open operation list refetches. */
  version: number;
  onToggleSelected: () => void;
  onToggleOpen: () => void;
  onSave: (form: RuleForm) => Promise<boolean>;
  onDelete: () => void;
  onClassAside: (tx: Transaction, categoryId: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<RuleForm>(emptyRuleForm());

  if (editing) {
    return (
      <div className="flex flex-wrap items-center gap-2 bg-zinc-50 px-3 py-2">
        <RuleEditor categories={categories} value={form} onChange={setForm} />
        <button
          onClick={async () => {
            if (await onSave(form)) setEditing(false);
          }}
          className="btn-primary"
        >
          Enregistrer
        </button>
        <button onClick={() => setEditing(false)} className="btn-secondary py-1">
          Annuler
        </button>
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-center gap-2 px-3 py-1">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelected}
          aria-label={`Sélectionner la règle « ${rule.pattern} »`}
        />
        <button
          onClick={onToggleOpen}
          disabled={rule.operation_count === 0}
          className="w-4 text-zinc-600 hover:text-zinc-900 disabled:invisible"
          title={open ? "Masquer ses opérations" : "Voir ses opérations"}
        >
          {open ? "▾" : "▸"}
        </button>
        <span className="font-mono text-xs">{rule.pattern}</span>
        {rule.is_income_anchor && <span title="Ancre de revenu : ouvre un mois budgétaire">⚓</span>}
        <span className="text-xs text-zinc-500" title="Priorité : le plus petit nombre l'emporte">
          prio {rule.priority}
        </span>
        {rule.description && <span className="truncate text-zinc-500">{rule.description}</span>}
        <span className="ml-auto flex items-center gap-3 whitespace-nowrap">
          {rule.operation_count === 0 ? (
            <span className="text-xs text-amber-700" title="Cette règle ne classe aucune opération">
              aucune opération
            </span>
          ) : (
            <>
              <span className="text-xs text-zinc-500">
                {rule.operation_count} opération{rule.operation_count > 1 ? "s" : ""}
              </span>
              <Net amount={Math.round((rule.credit - rule.debit) * 100) / 100} />
            </>
          )}
          <button
            onClick={() => {
              setForm(ruleToForm(rule));
              setEditing(true);
            }}
            className="text-zinc-600 hover:text-zinc-900"
            title="Modifier la règle"
          >
            ✎
          </button>
          <button onClick={onDelete} className="text-zinc-600 hover:text-red-700" title="Supprimer la règle">
            ✕
          </button>
        </span>
      </div>
      {open && <RuleOperations key={`${rule.id}-${version}`} rule={rule} categories={categories} onClassAside={onClassAside} />}
    </div>
  );
}
