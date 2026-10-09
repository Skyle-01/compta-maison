import { describe, expect, it } from "vitest";
import type { AverageNode, Category, Rule, Transaction } from "./api";
import { averageNets, buildTree, contentsByCategory, movedMessage, searchTree, undoMoves } from "./categoryTree";

function cat(id: number, name: string, parent_id: number | null): Category {
  return { id, name, parent_id, path: name, is_root: parent_id == null, rule_count: 0, budget_target: null };
}

function rule(id: number, category_id: number, fields: Partial<Rule> = {}): Rule {
  return {
    id,
    category_id,
    pattern: `MOTIF ${id}`,
    priority: 100,
    is_income_anchor: false,
    description: null,
    operation_count: 0,
    debit: 0,
    credit: 0,
    ...fields,
  };
}

function tx(id: number, category_id: number, fields: Partial<Transaction> = {}): Transaction {
  return {
    id,
    date_operation: "2026-06-12",
    date_valeur: "2026-06-12",
    budget_month: "2026-06",
    libelle: `OP ${id}`,
    debit: 0,
    credit: 0,
    account: "PERSO",
    account_id: "PERSO",
    kind: "expense",
    category_id,
    category: null,
    category_manual: true,
    note: null,
    rule_id: null,
    rule_pattern: null,
    transfer_group_id: null,
    kind_manual: false,
    ...fields,
  };
}

// Variable > Courses (leaf), Variable > Sortie > Bar (leaf), Fixe (top-level leaf).
const CATS = [cat(1, "Variable", null), cat(2, "Courses", 1), cat(3, "Sortie", 1), cat(4, "Bar", 3), cat(5, "Fixe", null)];
const TREE = buildTree(CATS);

describe("buildTree", () => {
  it("nests and sorts siblings by name", () => {
    expect(TREE.map((n) => n.name)).toEqual(["Fixe", "Variable"]);
    expect(TREE[1].children.map((n) => n.name)).toEqual(["Courses", "Sortie"]);
    expect(TREE[1].children[1].children.map((n) => n.name)).toEqual(["Bar"]);
  });
});

describe("contentsByCategory", () => {
  it("counts a leaf's rules and manual operations and rolls them up to its groups", () => {
    const rules = [
      rule(10, 2, { operation_count: 3, debit: 120.5 }),
      rule(11, 4, { operation_count: 2, debit: 20, credit: 5 }),
      rule(12, 4, { operation_count: 0 }),
    ];
    const manual = [tx(20, 2, { debit: 9.5 }), tx(21, 5, { credit: 2500 })];
    const contents = contentsByCategory(TREE, rules, manual);
    expect(contents.get(2)).toEqual({ rules: 1, ruleOperations: 3, manual: 1 });
    expect(contents.get(4)).toEqual({ rules: 2, ruleOperations: 2, manual: 0 });
    expect(contents.get(3)).toEqual(contents.get(4));
    expect(contents.get(1)).toEqual({ rules: 3, ruleOperations: 5, manual: 1 });
    expect(contents.get(5)).toEqual({ rules: 0, ruleOperations: 0, manual: 1 });
  });

});

describe("averageNets", () => {
  it("maps every node, groups included, to its signed average", () => {
    const node = (id: number, expenses: number, income: number, children: AverageNode[] = []): AverageNode => ({
      id,
      name: String(id),
      expenses,
      income,
      month_expenses: null,
      month_income: null,
      target: null,
      children,
    });
    const nets = averageNets([node(1, 300.1, 2500, [node(2, 300.1, 0), node(5, 0, 2500)])]);
    expect(nets.get(1)).toBe(2199.9);
    expect(nets.get(2)).toBe(-300.1);
    expect(nets.get(5)).toBe(2500);
  });
});

describe("searchTree", () => {
  const rules = [rule(10, 2, { pattern: "CARTE LECLERC" }), rule(11, 4, { description: "Café du coin" })];
  const manual = [tx(20, 5, { libelle: "VIR LOYER", note: "juin" })];

  it("is null for a blank query", () => {
    expect(searchTree(TREE, rules, manual, "  ")).toBeNull();
  });

  it("opens the leaves holding a match and shows their ancestors", () => {
    const search = searchTree(TREE, rules, manual, "cafe")!;
    expect([...search.open]).toEqual([4]);
    expect([...search.visible].sort()).toEqual([1, 3, 4]);
    expect(search.whole.size).toBe(0);
  });

  it("matches manual libellés and notes", () => {
    expect([...searchTree(TREE, rules, manual, "JUIN")!.open]).toEqual([5]);
    expect([...searchTree(TREE, rules, manual, "loyer")!.open]).toEqual([5]);
  });

  it("shows a name-matched group with everything below it", () => {
    const search = searchTree(TREE, rules, manual, "sorti")!;
    expect([...search.whole].sort()).toEqual([3, 4]);
    expect([...search.visible].sort()).toEqual([1, 3, 4]);
    expect(search.open.size).toBe(0);
  });
});

describe("undoMoves", () => {
  it("sends each item back to the leaf it is in now, one move per leaf", () => {
    const rules = [rule(10, 2), rule(11, 4), rule(12, 2)];
    const manual = [tx(20, 4), tx(21, 5)];
    expect(undoMoves([10, 11, 12], [20, 21], rules, manual)).toEqual([
      { categoryId: 2, rule_ids: [10, 12], transaction_ids: [] },
      { categoryId: 4, rule_ids: [11], transaction_ids: [20] },
      { categoryId: 5, rule_ids: [], transaction_ids: [21] },
    ]);
  });
});

describe("movedMessage", () => {
  it("agrees in number", () => {
    expect(movedMessage(1, 0, "Courses")).toBe("1 règle déplacée vers « Courses »");
    expect(movedMessage(0, 2, "Courses")).toBe("2 opérations déplacées vers « Courses »");
    expect(movedMessage(2, 1, "Courses")).toBe("2 règles et 1 opération déplacées vers « Courses »");
  });
});
