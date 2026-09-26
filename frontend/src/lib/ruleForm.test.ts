import { describe, expect, it } from "vitest";
import { emptyRuleForm, ruleFormToPayload, ruleToForm } from "./ruleForm";

describe("ruleFormToPayload", () => {
  it("trims the pattern and blanks the description to null", () => {
    const form = { ...emptyRuleForm(), category_id: 7, pattern: "  BOULANGERIE ", description: "  " };
    expect(ruleFormToPayload(form)).toEqual({
      category_id: 7,
      pattern: "BOULANGERIE",
      priority: 100,
      is_income_anchor: false,
      description: null,
    });
  });
  it("keeps a typed priority and falls back to 100 on blank or garbage", () => {
    const base = { ...emptyRuleForm(), category_id: 1, pattern: "X" };
    expect(ruleFormToPayload({ ...base, priority: "20" }).priority).toBe(20);
    expect(ruleFormToPayload({ ...base, priority: "" }).priority).toBe(100);
    expect(ruleFormToPayload({ ...base, priority: "abc" }).priority).toBe(100);
  });
});

describe("ruleToForm", () => {
  it("round-trips a rule", () => {
    const rule = {
      id: 3,
      category_id: 2,
      pattern: "VIR EMPLOYEUR",
      priority: 10,
      is_income_anchor: true,
      description: "salaire",
    };
    const form = ruleToForm(rule);
    expect(form.priority).toBe("10");
    const { id, ...payload } = rule;
    expect(id).toBe(3);
    expect(ruleFormToPayload(form)).toEqual(payload);
  });
  it("edits a null description as blank", () => {
    const rule = { id: 1, category_id: 2, pattern: "X", priority: 100, is_income_anchor: false, description: null };
    expect(ruleToForm(rule).description).toBe("");
  });
});
