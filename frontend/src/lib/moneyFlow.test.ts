import { describe, expect, it } from "vitest";
import type { CategoryNode, Dashboard } from "./api";
import { moneyFlow } from "./moneyFlow";

function node(name: string, credit: number, debit: number, children: CategoryNode[] = []): CategoryNode {
  const sum = (key: "credit" | "debit") => children.reduce((s, c) => s + c[key], 0);
  const [c, d] = children.length ? [sum("credit"), sum("debit")] : [credit, debit];
  return { id: null, name, credit: c, debit: d, balance: c - d, children };
}

/** A dashboard shaped like the backend's: income mixed into an expense group, a savings leaf, an
 *  uncategorised bucket with both sides, and two tiny leaves that fold into "Autres". */
function dashboard(salary: number): Dashboard {
  const tree = node("total", 0, 0, [
    node("Fixe", 0, 0, [node("Salaire", salary, 0), node("Loyer", 0, 800)]),
    node("Variable", 0, 0, [node("Courses", 0, 300), node("Bar", 0, 10), node("Cinéma", 0, 15)]),
    { ...node("Épargne", 0, 0, [{ ...node("Livret A", 0, 200), synthetic: true }]), synthetic: true },
    node("uncategorised", 50, 30),
  ]);
  const income = salary + 50;
  const expenses = 800 + 300 + 10 + 15 + 30;
  return {
    month: "2026-06",
    months_available: ["2026-06"],
    income,
    expenses,
    net: income - expenses,
    epargne: 200,
    desepargne: 0,
    reste: income - expenses - 200,
    by_category: tree,
    uncategorized: { count: 2, credit: 50, debit: 30, difference: 20, balanced: false },
    transfers: {} as Dashboard["transfers"],
    history: [],
  };
}

function flowOf(data: Dashboard) {
  const { nodes, links } = moneyFlow(data);
  const index = (name: string, role?: string) =>
    nodes.findIndex((n) => n.name === name && (role === undefined || n.role === role));
  const into = (i: number) => links.filter((l) => l.target === i).reduce((s, l) => s + l.value, 0);
  const outOf = (i: number) => links.filter((l) => l.source === i).reduce((s, l) => s + l.value, 0);
  return { nodes, index, into, outOf };
}

describe("moneyFlow", () => {
  it("balances the budget and matches the dashboard totals", () => {
    const data = dashboard(2500);
    const { index, into, outOf } = flowOf(data);
    const budget = index("Budget");

    expect(into(budget)).toBeCloseTo(outOf(budget));
    expect(into(budget)).toBeCloseTo(data.income); // Revenus + uncategorised credit
    expect(into(index("Reste"))).toBeCloseTo(data.reste);
    expect(into(index("Épargne", "savings"))).toBeCloseTo(data.epargne);
    expect(outOf(index("Fixe"))).toBeCloseTo(800); // the salary doesn't hide the rent
  });

  it("folds tiny leaves of a group into one Autres node", () => {
    const { index, into } = flowOf(dashboard(2500));
    expect(index("Bar")).toBe(-1);
    expect(into(index("Autres (Variable)"))).toBeCloseTo(25);
    expect(into(index("Courses"))).toBeCloseTo(300);
  });

  it("shows a deficit as Découvert flowing into the budget", () => {
    const data = dashboard(900);
    const { index, into, outOf } = flowOf(data);
    expect(index("Reste")).toBe(-1);
    expect(outOf(index("Découvert"))).toBeCloseTo(-data.reste);
    expect(into(index("Budget"))).toBeCloseTo(outOf(index("Budget")));
  });
});
