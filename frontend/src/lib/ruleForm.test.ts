import { describe, expect, it } from "vitest";
import { emptyRuleForm, ruleFormToPayload, ruleToForm } from "./ruleForm";

describe("ruleFormToPayload", () => {
  it("trims the pattern and blanks the description to null", () => {
    const form = { ...emptyRuleForm(), category_id: 7, pattern: "  BOULANGERIE ", description: "  " };
    expect(ruleFormToPayload(form)).toEqual({
      category_id: 7,
      pattern: "BOULANGERIE",
      is_income_anchor: false,
      description: null,
      account_id: null,
    });
  });
  it("keeps the account a rule is limited to, none by default", () => {
    expect(emptyRuleForm().account_id).toBeNull();
    const form = { ...emptyRuleForm(), category_id: 7, pattern: "X", account_id: "JOINT" };
    expect(ruleFormToPayload(form).account_id).toBe("JOINT");
  });
});

describe("ruleToForm", () => {
  it("round-trips a rule", () => {
    const rule = {
      id: 3,
      category_id: 2,
      pattern: "VIR EMPLOYEUR",
      is_income_anchor: true,
      description: "salaire",
      account_id: "PERSO",
    };
    const form = ruleToForm(rule);
    const { id, ...payload } = rule;
    expect(id).toBe(3);
    expect(ruleFormToPayload(form)).toEqual(payload);
  });
  it("edits a null description as blank", () => {
    const rule = { id: 1, category_id: 2, pattern: "X", is_income_anchor: false, description: null, account_id: null };
    expect(ruleToForm(rule).description).toBe("");
  });
});
