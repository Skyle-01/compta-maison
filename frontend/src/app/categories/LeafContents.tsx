import { useState } from "react";
import type { Category, Rule, Transaction } from "@/lib/api";
import { emptyRuleForm, type RuleForm } from "@/lib/ruleForm";
import ManualRow from "./ManualRow";
import RuleEditor from "./RuleEditor";
import RuleRow from "./RuleRow";

/** What the page does for a leaf's rules and manual operations. The `Promise<boolean>` ones resolve
 *  false when the change failed (the row's editor stays open). */
export type LeafActions = {
  toggleRuleSelected: (id: number) => void;
  toggleTxSelected: (id: number) => void;
  toggleRuleOpen: (id: number) => void;
  createRule: (form: RuleForm) => Promise<boolean>;
  updateRule: (id: number, form: RuleForm) => Promise<boolean>;
  deleteRule: (rule: Rule) => void;
  classAside: (tx: Transaction, categoryId: number) => void;
  saveNote: (id: number, note: string) => Promise<boolean>;
  removeAssignment: (tx: Transaction) => void;
};

/** A leaf's rules (with their add form) and manual operations, already filtered by the search. The
 *  selection and open-rule sets stay on the page: they outlive the leaf being collapsed. */
export default function LeafContents({
  leafId,
  depth,
  categories,
  rules,
  manual,
  selectedRules,
  selectedTx,
  openRules,
  version,
  actions,
}: {
  leafId: number;
  depth: number;
  categories: Category[];
  rules: Rule[];
  manual: Transaction[];
  selectedRules: Set<number>;
  selectedTx: Set<number>;
  openRules: Set<number>;
  version: number;
  actions: LeafActions;
}) {
  const [adding, setAdding] = useState(false);
  const [newRule, setNewRule] = useState<RuleForm>(emptyRuleForm());

  async function addRule() {
    if (await actions.createRule(newRule)) setAdding(false);
  }

  return (
    <div className="space-y-2 pb-3 pr-3 pt-1" style={{ marginLeft: depth * 20 + 32 }}>
      <div className="rounded border border-zinc-200">
        <div className="flex items-center border-b border-zinc-100 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-600">
          ⚙ Règles ({rules.length})
          <button
            onClick={() => {
              setAdding(true);
              setNewRule({ ...emptyRuleForm(), category_id: leafId });
            }}
            className="ml-auto font-normal text-zinc-600 hover:text-zinc-900"
            title="Ajouter une règle dans cette catégorie"
          >
            ＋ règle
          </button>
        </div>
        {rules.length === 0 && !adding && <p className="px-3 py-1 text-zinc-500">Aucune règle.</p>}
        {rules.map((r) => (
          <RuleRow
            key={r.id}
            rule={r}
            categories={categories}
            selected={selectedRules.has(r.id)}
            open={openRules.has(r.id)}
            version={version}
            onToggleSelected={() => actions.toggleRuleSelected(r.id)}
            onToggleOpen={() => actions.toggleRuleOpen(r.id)}
            onSave={(form) => actions.updateRule(r.id, form)}
            onDelete={() => actions.deleteRule(r)}
            onClassAside={actions.classAside}
          />
        ))}
        {adding && (
          <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 bg-zinc-50 px-3 py-2">
            <RuleEditor categories={categories} value={newRule} onChange={setNewRule} />
            <button onClick={addRule} className="btn-primary">
              Ajouter la règle
            </button>
            <button onClick={() => setAdding(false)} className="btn-secondary py-1">
              Annuler
            </button>
          </div>
        )}
      </div>
      <div className="rounded border border-zinc-200">
        <div className="border-b border-zinc-100 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-600">
          ✎ Opérations classées à la main ({manual.length})
        </div>
        {manual.length === 0 ? (
          <p className="px-3 py-1 text-zinc-500">Aucune opération classée à la main.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {manual.map((tx) => (
                <ManualRow
                  key={tx.id}
                  tx={tx}
                  selected={selectedTx.has(tx.id)}
                  onToggleSelected={() => actions.toggleTxSelected(tx.id)}
                  onSaveNote={(note) => actions.saveNote(tx.id, note)}
                  onRemove={() => actions.removeAssignment(tx)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
