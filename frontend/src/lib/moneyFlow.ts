import type { CategoryNode, Dashboard } from "./api";

// One of the roles a Sankey node plays — drives its colour.
export type FlowRole = "income" | "budget" | "expense" | "savings" | "net";

export interface FlowNodeDatum {
  name: string;
  role: FlowRole;
}
export interface FlowLink {
  source: number;
  target: number;
  value: number;
  /** What the flow is (drives its colour): the role of the node it feeds, or of the node it comes
   *  from when it feeds the Revenus hub / Budget (income, désépargne, a deficit). */
  role: FlowRole;
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
 *  Revenus hub (alongside uncategorised income and any désépargne) which feeds the Budget — or
 *  straight into the Budget when there is a single source and nothing else coming in; the
 *  Budget then fans out to expense groups → leaves, uncategorised spend, Épargne, and a balancing
 *  Net branch (a surplus flows out on the right; a deficit flows in on the left).
 *  Flow values are rolled UP from the leaves: an expense node is its leaves' net debit
 *  (debit - credit, so refunds offset), an income source is a leaf's net credit. That per-leaf
 *  split is what lets income live inside an otherwise-expense group (e.g. the salary under Fixe)
 *  without hiding that group's expenses or creating a Budget↔group cycle. The uncategorised bucket
 *  is shown gross on both sides (it usually holds both income and spending). Net balances the
 *  Budget node so its inflow and outflow always match. To keep the right edge legible, tiny
 *  expense leaves within a group are folded into a single "Autres" node, and a leaf name used under
 *  several groups (two "Prêt") gets its parent's name appended.
 *  Node order is meaningful: the layout (lib/flowLayout.ts) keeps each column in array order. Groups and leaves are emitted largest first, a group's sub-groups before
 *  its leaves, and Non classé / Épargne / Reste last, so every column lists its nodes in the same
 *  order as their parents and links don't cross. Returns indexed {nodes, links}. */
export function moneyFlow(data: Dashboard): FlowData {
  const tree = data.by_category;
  const nodes: FlowNodeDatum[] = [];
  const links: FlowLink[] = [];
  const add = (name: string, role: FlowRole): number => nodes.push({ name, role }) - 1;
  let revenus = -1; // the Revenus hub, once added
  const link = (source: number, target: number, value: number) => {
    const into = nodes[target].role;
    const role = into === "budget" || target === revenus ? nodes[source].role : into;
    if (value > EPS) links.push({ source, target, value, role });
  };
  // Parent group of each expense node, to disambiguate repeated leaf names at the end.
  const parentOf = new Map<number, string>();

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
  incomeLeaves.sort((a, b) => b.value - a.value);
  const uncIncome = unc && unc.credit > EPS ? unc.credit : 0;
  const deficit = topLevel(tree, "Déficit");
  const desepargne = deficit ? deficit.credit : 0;
  if (incomeLeaves.length === 1 && uncIncome === 0 && desepargne <= EPS) {
    // A lone source would draw three identical bars in a row (Salaire → Revenus → Budget).
    link(add(incomeLeaves[0].name, "income"), budget, incomeLeaves[0].value);
    incomeShown += incomeLeaves[0].value;
  } else if (incomeLeaves.length > 0) {
    revenus = add("Revenus", "income");
    for (const leaf of incomeLeaves) {
      link(add(leaf.name, "income"), revenus, leaf.value);
      incomeShown += leaf.value;
    }
    link(revenus, budget, incomeShown);
  }
  // Uncategorised income (gross credit) and désépargne (money pulled from savings) feed straight in.
  if (uncIncome > 0) {
    link(add("Non classé", "income"), budget, uncIncome);
    incomeShown += uncIncome;
  }
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

  const byValue = (children: CategoryNode[]) =>
    children
      .map((c) => ({ node: c, value: expenseValue(c) }))
      .filter((e) => e.value > EPS)
      .sort((a, b) => b.value - a.value);
  const addExpense = (name: string, parent: number, value: number): number => {
    const idx = add(name, "expense");
    parentOf.set(idx, nodes[parent].name);
    link(parent, idx, value);
    return idx;
  };
  const emit = (node: CategoryNode, parent: number) => {
    // Sub-groups first, then leaves (largest first, the folded "Autres" last): each column then
    // keeps its parents' order (see the node-order note above).
    for (const sub of byValue(node.children.filter((c) => c.children.length > 0))) {
      emit(sub.node, addExpense(sub.node.name, parent, sub.value));
    }
    const leaves = byValue(node.children.filter((c) => c.children.length === 0));
    const kept = leaves.filter((l) => l.value >= foldThreshold);
    const folded = leaves.filter((l) => l.value < foldThreshold);
    for (const leaf of kept) addExpense(leaf.node.name, parent, leaf.value);
    if (folded.length === 1) {
      addExpense(folded[0].node.name, parent, folded[0].value);
    } else if (folded.length > 1) {
      // Name the rolled-up node after its group so several "Autres" stay distinguishable.
      addExpense(`Autres (${node.name})`, parent, folded.reduce((s, l) => s + l.value, 0));
    }
  };

  for (const group of byValue(tree.children)) {
    const idx = add(group.node.name, "expense");
    link(budget, idx, group.value);
    expensesShown += group.value;
    emit(group.node, idx);
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

  // A leaf name repeated under several groups ("Prêt" under both Résidence principale and
  // Locatif) is ambiguous on the chart: append the parent's name to each occurrence.
  const seen = new Map<string, number>();
  for (const idx of parentOf.keys()) seen.set(nodes[idx].name, (seen.get(nodes[idx].name) ?? 0) + 1);
  for (const [idx, parent] of parentOf) {
    if ((seen.get(nodes[idx].name) ?? 0) > 1) nodes[idx] = { ...nodes[idx], name: `${nodes[idx].name} (${parent})` };
  }

  return { nodes, links };
}
