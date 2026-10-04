import type { RuleInput } from "./api";

/** Editable mirror of a Rule (numbers kept as strings while typing). Shared by the Catégories rule
 *  editor and the Transactions categorise editor, whose description doubles as the manual note. */
export type RuleForm = {
  category_id: number | null;
  pattern: string;
  priority: string;
  is_income_anchor: boolean;
  description: string;
};

export const DEFAULT_RULE_PRIORITY = 100;

export const emptyRuleForm = (): RuleForm => ({
  category_id: null,
  pattern: "",
  priority: String(DEFAULT_RULE_PRIORITY),
  is_income_anchor: false,
  description: "",
});

export const ruleToForm = (r: RuleInput): RuleForm => ({
  category_id: r.category_id,
  pattern: r.pattern,
  priority: String(r.priority),
  is_income_anchor: r.is_income_anchor,
  description: r.description ?? "",
});

/** Trimmed pattern, priority falling back to the default, blank description -> null. The caller
 *  checks a category is set first. */
export const ruleFormToPayload = (f: RuleForm): RuleInput => ({
  category_id: f.category_id as number,
  pattern: f.pattern.trim(),
  priority: Number(f.priority) || DEFAULT_RULE_PRIORITY,
  is_income_anchor: f.is_income_anchor,
  description: f.description.trim() || null,
});
