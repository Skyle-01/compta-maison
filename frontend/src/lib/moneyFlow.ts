import type { CategoryNode, Dashboard } from "./api";

// One of the roles a Sankey node plays — drives its colour.
export type FlowRole = "income" | "budget" | "expense" | "savings" | "net";

export interface FlowNodeDatum {
  name: string;
  role: FlowRole;
  /** Filled in by recharts' layout, read back in the custom node renderer. */
  value?: number;
  targetNodes?: number[];
}
export interface FlowLink {
  source: number;
  target: number;
  value: number;
}
export interface FlowData {
  nodes: FlowNodeDatum[];
  links: FlowLink[];
}

const EPS = 0.01;

/** Top-level root child named `name` (real category or synthetic group), if present. */
function topLevel(tree: CategoryNode, name: string): CategoryNode | undefined {
  return tree.children.find((c) => c.name === name);
}

/** Build the money-flow Sankey, symmetric around a central Budget node: income sources fan into a
 *  Revenus hub (alongside uncategorised income and any désépargne) which feeds the Budget; the
 *  Budget then fans out to expense groups → leaves, uncategorised spend, Épargne, and a balancing
 *  Net branch (a surplus flows out on the right; a deficit flows in on the left).
 *  Flow values are rolled UP from the leaves: an expense node is its leaves' net debit
 *  (debit - credit, so refunds offset), an income source is a leaf's net credit. That per-leaf
 *  split is what lets income live inside an otherwise-expense group (e.g. the salary under Fixe)
 *  without hiding that group's expenses or creating a Budget↔group cycle. The uncategorised bucket
 *  is shown gross on both sides (it usually holds both income and spending). Net balances the
 *  Budget node so its inflow and outflow always match. To keep the right edge legible, tiny
 *  expense leaves within a group are folded into a single "Autres" node. Returns indexed
 *  {nodes, links}. */
export function moneyFlow(data: Dashboard): FlowData {
  const tree = data.by_category;
  const nodes: FlowNodeDatum[] = [];
  const links: FlowLink[] = [];
  const add = (name: string, role: FlowRole): number => nodes.push({ name, role }) - 1;
  const link = (source: number, target: number, value: number) => {
    if (value > EPS) links.push({ source, target, value });
  };

  const budget = add("Budget", "budget");
  const SKIP = new Set(["Épargne", "Déficit", "uncategorised"]);
  const unc = topLevel(tree, "uncategorised");
  let incomeShown = 0;
  let expensesShown = 0;

  // Income side: each net-credit category leaf fans into a Revenus hub, which feeds the budget.
  const incomeLeaves: { name: string; value: number }[] = [];
  const collectIncome = (node: CategoryNode) => {
    if (node.synthetic || SKIP.has(node.name)) return;
    if (node.children.length === 0) {
      const net = node.credit - node.debit;
      if (net > EPS) incomeLeaves.push({ name: node.name, value: net });
    } else node.children.forEach(collectIncome);
  };
  tree.children.forEach(collectIncome);
  if (incomeLeaves.length > 0) {
    const revenus = add("Revenus", "income");
    for (const leaf of incomeLeaves) {
      link(add(leaf.name, "income"), revenus, leaf.value);
      incomeShown += leaf.value;
    }
    link(revenus, budget, incomeShown);
  }
  // Uncategorised income (gross credit) and désépargne (money pulled from savings) feed straight in.
  if (unc && unc.credit > EPS) {
    link(add("Non classé", "income"), budget, unc.credit);
    incomeShown += unc.credit;
  }
  const deficit = topLevel(tree, "Déficit");
  const desepargne = deficit ? deficit.credit : 0;
  if (desepargne > EPS) {
    link(add("Désépargne", "income"), budget, desepargne);
    incomeShown += desepargne;
  }

  // Expense side: Budget → top-level group → leaves, recursing through any sub-groups so the
  // hierarchy is preserved. Group values are rolled up from the leaves' net debit (see above).
  const expenseValue = (node: CategoryNode): number => {
    if (node.synthetic || SKIP.has(node.name)) return 0;
    if (node.children.length === 0) return Math.max(0, node.debit - node.credit);
    return node.children.reduce((sum, child) => sum + expenseValue(child), 0);
  };
  // Leaves smaller than this (within their group) collapse into one "Autres" node.
  const totalExpenses =
    tree.children.reduce((sum, g) => sum + expenseValue(g), 0) + (unc ? Math.max(0, unc.debit) : 0);
  const foldThreshold = totalExpenses * 0.025;

  const emit = (node: CategoryNode, parent: number) => {
    for (const child of node.children) {
      if (child.children.length === 0) continue;
      const value = expenseValue(child);
      if (value <= EPS) continue;
      const idx = add(child.name, "expense");
      link(parent, idx, value);
      emit(child, idx);
    }
    const leaves = node.children
      .filter((c) => c.children.length === 0)
      .map((c) => ({ name: c.name, value: expenseValue(c) }))
      .filter((e) => e.value > EPS);
    const kept = leaves.filter((l) => l.value >= foldThreshold);
    const folded = leaves.filter((l) => l.value < foldThreshold);
    for (const leaf of kept) link(parent, add(leaf.name, "expense"), leaf.value);
    if (folded.length === 1) {
      link(parent, add(folded[0].name, "expense"), folded[0].value);
    } else if (folded.length > 1) {
      // Name the rolled-up node after its group so several "Autres" stay distinguishable.
      link(parent, add(`Autres (${node.name})`, "expense"), folded.reduce((s, l) => s + l.value, 0));
    }
  };

  for (const group of tree.children) {
    const value = expenseValue(group);
    if (value <= EPS) continue;
    const idx = add(group.name, "expense");
    link(budget, idx, value);
    expensesShown += value;
    emit(group, idx);
  }
  if (unc && unc.debit > EPS) {
    link(budget, add("Non classé", "expense"), unc.debit);
    expensesShown += unc.debit;
  }

  // Épargne branch (money moved to savings).
  const epargneNode = topLevel(tree, "Épargne");
  const epargne = epargneNode ? epargneNode.debit : 0;
  if (epargne > EPS) link(budget, add("Épargne", "savings"), epargne);

  // The all-in cash balance (= Balance-tree total): a surplus ("Reste") flows out on the right,
  // a deficit ("Découvert", money drawn from reserves) flows in on the left. This intentionally
  // accounts for Épargne too, so it differs from the income−expenses "Net" stat card.
  const net = incomeShown - expensesShown - epargne;
  if (net > EPS) link(budget, add("Reste", "net"), net);
  else if (net < -EPS) link(add("Découvert", "net"), budget, -net);

  return { nodes, links };
}
