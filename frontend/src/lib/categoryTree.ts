import type { Category, Rule, Transaction } from "./api";
import { fold } from "./categorySearch";

/** The Catégories page's pure helpers: the tree, what each node holds, search, and move undo. */

export type CategoryTreeNode = Category & { children: CategoryTreeNode[] };

/** Nest the flat category list, siblings sorted by name. */
export function buildTree(cats: Category[]): CategoryTreeNode[] {
  const map = new Map<number, CategoryTreeNode>(cats.map((c) => [c.id, { ...c, children: [] }]));
  const roots: CategoryTreeNode[] = [];
  for (const n of map.values()) {
    const parent = n.parent_id != null ? map.get(n.parent_id) : undefined;
    if (parent) parent.children.push(n);
    else roots.push(n);
  }
  const sortRec = (ns: CategoryTreeNode[]) => {
    ns.sort((a, b) => a.name.localeCompare(b.name));
    ns.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

/** What classifies operations into a node: a leaf's own rules and manual assignments, a group's
 *  the sum of its leaves'. `net` = credits − debits of all those operations, in euros. */
export type Contents = { rules: number; ruleOperations: number; manual: number; net: number };

const round = (euros: number) => Math.round(euros * 100) / 100;

export function contentsByCategory(
  tree: CategoryTreeNode[],
  rules: Rule[],
  manual: Transaction[],
): Map<number, Contents> {
  const out = new Map<number, Contents>();
  const visit = (node: CategoryTreeNode): Contents => {
    let contents: Contents = { rules: 0, ruleOperations: 0, manual: 0, net: 0 };
    if (node.children.length === 0) {
      for (const r of rules)
        if (r.category_id === node.id) {
          contents.rules += 1;
          contents.ruleOperations += r.operation_count;
          contents.net += r.credit - r.debit;
        }
      for (const tx of manual)
        if (tx.category_id === node.id) {
          contents.manual += 1;
          contents.net += tx.credit - tx.debit;
        }
    } else {
      for (const child of node.children) {
        const c = visit(child);
        contents = {
          rules: contents.rules + c.rules,
          ruleOperations: contents.ruleOperations + c.ruleOperations,
          manual: contents.manual + c.manual,
          net: contents.net + c.net,
        };
      }
    }
    contents.net = round(contents.net);
    out.set(node.id, contents);
    return contents;
  };
  tree.forEach(visit);
  return out;
}

export const ruleMatches = (r: Rule, q: string) => fold(`${r.pattern} ${r.description ?? ""}`).includes(q);
export const manualMatches = (tx: Transaction, q: string) => fold(`${tx.libelle} ${tx.note ?? ""}`).includes(q);

/** The tree filtered by a search (accents and case ignored): nodes to show, leaves to open, and the
 *  nodes matched by name, which show everything they hold (other open leaves show only their
 *  matching rules and manual operations). null for a blank query. */
export type TreeSearch = { visible: Set<number>; open: Set<number>; whole: Set<number> };

export function searchTree(
  tree: CategoryTreeNode[],
  rules: Rule[],
  manual: Transaction[],
  query: string,
): TreeSearch | null {
  const q = fold(query.trim());
  if (!q) return null;
  const result: TreeSearch = { visible: new Set(), open: new Set(), whole: new Set() };
  const visit = (node: CategoryTreeNode, inMatchedBranch: boolean): boolean => {
    const whole = inMatchedBranch || fold(node.name).includes(q);
    if (whole) result.whole.add(node.id);
    let shown = whole;
    if (node.children.length === 0) {
      const holdsMatch =
        rules.some((r) => r.category_id === node.id && ruleMatches(r, q)) ||
        manual.some((tx) => tx.category_id === node.id && manualMatches(tx, q));
      if (holdsMatch) {
        result.open.add(node.id);
        shown = true;
      }
    }
    for (const child of node.children) if (visit(child, whole)) shown = true;
    if (shown) result.visible.add(node.id);
    return shown;
  };
  tree.forEach((node) => visit(node, false));
  return result;
}

/** One move request: rules and manual operations into the leaf `categoryId`. */
export type Move = { categoryId: number; rule_ids: number[]; transaction_ids: number[] };

/** The moves undoing a move of `ruleIds` and `transactionIds`: each back to the leaf it is in now. */
export function undoMoves(ruleIds: number[], transactionIds: number[], rules: Rule[], manual: Transaction[]): Move[] {
  const byCategory = new Map<number, Move>();
  const moveFor = (categoryId: number) => {
    let move = byCategory.get(categoryId);
    if (!move) byCategory.set(categoryId, (move = { categoryId, rule_ids: [], transaction_ids: [] }));
    return move;
  };
  for (const id of ruleIds) {
    const rule = rules.find((r) => r.id === id);
    if (rule) moveFor(rule.category_id).rule_ids.push(id);
  }
  for (const id of transactionIds) {
    const tx = manual.find((t) => t.id === id);
    if (tx?.category_id != null) moveFor(tx.category_id).transaction_ids.push(id);
  }
  return [...byCategory.values()];
}

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;

/** « 2 règles et 1 opération déplacées vers « Courses / Marché » ». */
export function movedMessage(rules: number, operations: number, path: string): string {
  const parts = [];
  if (rules) parts.push(plural(rules, "règle"));
  if (operations) parts.push(plural(operations, "opération"));
  return `${parts.join(" et ")} déplacée${rules + operations > 1 ? "s" : ""} vers « ${path} »`;
}
