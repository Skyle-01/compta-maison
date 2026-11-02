import type { RuleInput } from "./api";

/** Editable mirror of a Rule (numbers kept as strings while typing). Shared by the Catégories rule
 *  editor and the Transactions categorise editor, whose description doubles as the manual note.
 *  `account_id` is the account the rule is limited to, null = all accounts. */
export type RuleForm = {
  category_id: number | null;
  pattern: string;
  is_income_anchor: boolean;
  description: string;
  account_id: string | null;
};

export const emptyRuleForm = (): RuleForm => ({
  category_id: null,
  pattern: "",
  is_income_anchor: false,
  description: "",
  account_id: null,
});

export const ruleToForm = (r: RuleInput): RuleForm => ({
  category_id: r.category_id,
  pattern: r.pattern,
  is_income_anchor: r.is_income_anchor,
  description: r.description ?? "",
  account_id: r.account_id,
});

/** Trimmed pattern, blank description -> null. The caller
 *  checks a category is set first. */
export const ruleFormToPayload = (f: RuleForm): RuleInput => ({
  category_id: f.category_id as number,
  pattern: f.pattern.trim(),
  is_income_anchor: f.is_income_anchor,
  description: f.description.trim() || null,
  account_id: f.account_id,
});
