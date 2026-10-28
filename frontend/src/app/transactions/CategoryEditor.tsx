import CategoryPicker from "@/components/CategoryPicker";
import type { Category, Transaction } from "@/lib/api";
import type { RuleForm } from "@/lib/ruleForm";

export type EditMode = "manual" | "rule";

/** The inline categorisation editor of one row: a leaf, then either this operation or a rule. */
export default function CategoryEditor({
  tx,
  categories,
  form,
  onEdit,
  mode,
  onModeChange,
  matchCount,
  submitDisabled,
  onSubmit,
  onCancel,
}: {
  tx: Transaction;
  categories: Category[];
  form: RuleForm;
  onEdit: (patch: Partial<RuleForm>) => void;
  mode: EditMode;
  onModeChange: (mode: EditMode) => void;
  /** Rows the typed pattern would claim; null while unknown. */
  matchCount: number | null;
  submitDisabled: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-2">
      <CategoryPicker
        categories={categories}
        value={form.category_id}
        onChange={(category_id) => onEdit({ category_id })}
        highlight={form.category_id == null}
        placeholder="- catégorie -"
      />
      <div className="flex items-center gap-3 text-xs text-zinc-600">
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name={`mode-${tx.id}`}
            checked={mode === "manual"}
            onChange={() => onModeChange("manual")}
          />
          Cette opération
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name={`mode-${tx.id}`}
            checked={mode === "rule"}
            onChange={() => onModeChange("rule")}
          />
          Règle (opérations similaires)
        </label>
      </div>
      {mode === "rule" && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <input
              value={form.pattern}
              onChange={(e) => onEdit({ pattern: e.target.value })}
              placeholder="texte à rechercher"
              className="w-52 rounded border border-zinc-300 px-1 py-0.5 font-mono text-xs"
            />
            <span className="text-xs text-zinc-500">
              {!form.pattern.trim()
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
              title="Priorité - le plus petit nombre l'emporte"
              value={form.priority}
              onChange={(e) => onEdit({ priority: e.target.value })}
              className="w-16 rounded border border-zinc-300 px-1 py-0.5"
            />
            <label className="flex items-center gap-1 text-zinc-600">
              <input
                type="checkbox"
                checked={form.is_income_anchor}
                onChange={(e) => onEdit({ is_income_anchor: e.target.checked })}
              />
              ancre de revenu
            </label>
          </div>
        </div>
      )}
      <input
        value={form.description}
        onChange={(e) => onEdit({ description: e.target.value })}
        placeholder={mode === "rule" ? "Description de la règle (facultatif)" : "Description (facultatif)"}
        className="w-72 rounded border border-zinc-300 px-2 py-0.5 text-xs"
      />
      <div className="flex items-center gap-2 text-xs">
        <button onClick={onSubmit} disabled={submitDisabled} className="btn-primary py-1">
          Valider
        </button>
        <button onClick={onCancel} className="btn-secondary py-1">
          Annuler
        </button>
      </div>
    </div>
  );
}
