import CategoryPicker from "@/components/CategoryPicker";
import type { Category } from "@/lib/api";
import type { RuleForm } from "@/lib/ruleForm";

/** The editable controls for one rule, shared by the add form and the inline editor. */
export default function RuleEditor({
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
        title="Priorité : le plus petit nombre l'emporte"
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
