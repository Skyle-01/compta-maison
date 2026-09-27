import { describe, expect, it } from "vitest";
import { busiestColumn, flowColumns, flowLayout } from "./flowLayout";
import type { FlowData } from "./moneyFlow";

// Salaire → Budget → Fixe → {Loyer, EDF}, plus Budget → Reste: four columns, the last one holding
// the three terminal nodes (Reste is pushed there from column 2).
const FLOW: FlowData = {
  nodes: [
    { name: "Salaire", role: "income" },
    { name: "Budget", role: "budget" },
    { name: "Fixe", role: "expense" },
    { name: "Loyer", role: "expense" },
    { name: "EDF", role: "expense" },
    { name: "Reste", role: "net" },
  ],
  links: [
    { source: 0, target: 1, value: 1000, role: "income" },
    { source: 1, target: 2, value: 600, role: "expense" },
    { source: 2, target: 3, value: 400, role: "expense" },
    { source: 2, target: 4, value: 200, role: "expense" },
    { source: 1, target: 5, value: 400, role: "net" },
  ],
};
const OPTIONS = { width: 310, height: 200, nodeWidth: 10, nodePadding: 20 };

describe("flowColumns", () => {
  it("places a node at its longest path from a source, terminal nodes in the last column", () => {
    expect(flowColumns(FLOW)).toEqual([0, 1, 2, 3, 3, 3]);
    expect(busiestColumn(FLOW)).toBe(3);
  });
});

describe("flowLayout", () => {
  const { nodes, links } = flowLayout(FLOW, OPTIONS);
  const byName = (name: string) => nodes.find((n) => n.name === name)!;

  it("fills the height with the busiest column and centres the shorter ones", () => {
    // The last column binds the scale: (200 - 2 gaps × 20) / 1000 = 0.16 px per euro.
    expect(byName("Loyer").y).toBeCloseTo(0);
    expect(byName("Reste").y + byName("Reste").height).toBeCloseTo(200);
    for (const name of ["Salaire", "Budget", "Fixe"]) {
      const n = byName(name);
      expect(n.y).toBeCloseTo(200 - (n.y + n.height)); // same gap above and below
    }
    expect(byName("Budget").height).toBeCloseTo(160);
    expect(byName("Fixe").height).toBeCloseTo(96);
  });

  it("keeps each column in array order and spreads the columns across the width", () => {
    expect(byName("Loyer").y).toBeLessThan(byName("EDF").y);
    expect(byName("EDF").y).toBeLessThan(byName("Reste").y);
    expect(nodes.map((n) => n.x)).toEqual([0, 100, 200, 300, 300, 300]);
  });

  it("flags where a path starts and ends", () => {
    expect(nodes.filter((n) => n.isSource).map((n) => n.name)).toEqual(["Salaire"]);
    expect(nodes.filter((n) => n.isTerminal).map((n) => n.name)).toEqual(["Loyer", "EDF", "Reste"]);
  });

  it("stacks a node's bands in the order of their other end, edge to edge", () => {
    const budget = byName("Budget");
    const [toFixe, toReste] = [links[1], links[4]];
    expect(toFixe.width).toBeCloseTo(96);
    expect(toFixe.sourceY - toFixe.width / 2).toBeCloseTo(budget.y); // Fixe sits above Reste
    expect(toReste.sourceY - toReste.width / 2).toBeCloseTo(toFixe.sourceY + toFixe.width / 2);
    expect(toReste.sourceY + toReste.width / 2).toBeCloseTo(budget.y + budget.height);
    expect(toReste.sourceX).toBe(budget.x + budget.width);
    expect(toReste.targetX).toBe(byName("Reste").x);
    expect(toReste.targetY).toBeCloseTo(byName("Reste").y + byName("Reste").height / 2);
  });

  it("draws nothing tall for a graph without links", () => {
    const empty = flowLayout({ nodes: [{ name: "Budget", role: "budget" }], links: [] }, OPTIONS);
    expect(empty.nodes[0].height).toBe(0);
    expect(empty.links).toEqual([]);
  });
});
