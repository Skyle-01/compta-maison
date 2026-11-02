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
    });
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
    };
    const form = ruleToForm(rule);
    const { id, ...payload } = rule;
    expect(id).toBe(3);
    expect(ruleFormToPayload(form)).toEqual(payload);
  });
  it("edits a null description as blank", () => {
    const rule = { id: 1, category_id: 2, pattern: "X", is_income_anchor: false, description: null };
    expect(ruleToForm(rule).description).toBe("");
  });
});
