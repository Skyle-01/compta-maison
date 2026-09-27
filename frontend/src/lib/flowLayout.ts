import type { FlowData, FlowLink, FlowNodeDatum } from "./moneyFlow";

/** A node placed on the chart, in the layout box's coordinates. */
export interface PlacedNode extends FlowNodeDatum {
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The larger of its inflow and outflow (the two match everywhere but at the edges). */
  value: number;
  /** No incoming link: the left edge of a path (labelled to its left). */
  isSource: boolean;
  /** No outgoing link: sits in the last column (labelled to its right). */
  isTerminal: boolean;
}

/** A link drawn as a band of `width` whose centre line runs from (sourceX, sourceY) on the right
 *  side of its source to (targetX, targetY) on the left side of its target. */
export interface PlacedLink extends FlowLink {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  width: number;
}

export interface FlowLayout {
  nodes: PlacedNode[];
  links: PlacedLink[];
}

export interface FlowLayoutOptions {
  width: number;
  height: number;
  nodeWidth: number;
  /** Vertical gap between two nodes of a column. */
  nodePadding: number;
}

/** Column of each node: its longest path from a source, except that a node feeding nothing goes
 *  to the last column, so every leaf lines up on the right edge. */
export function flowColumns(flow: FlowData): number[] {
  const depth = new Array<number>(flow.nodes.length).fill(0);
  // Links run left to right, so relaxing them as many times as there are nodes settles every depth.
  for (let pass = 0; pass < flow.nodes.length; pass++) {
    let changed = false;
    for (const l of flow.links) {
      if (depth[l.target] < depth[l.source] + 1) {
        depth[l.target] = depth[l.source] + 1;
        changed = true;
      }
    }
    if (!changed) break;
  }
  const last = Math.max(0, ...depth);
  const hasOut = new Set(flow.links.map((l) => l.source));
  return depth.map((d, i) => (hasOut.has(i) ? d : last));
}

/** Nodes in the busiest column, which sets the chart height. */
export function busiestColumn(flow: FlowData): number {
  const counts = new Map<number, number>();
  for (const col of flowColumns(flow)) counts.set(col, (counts.get(col) ?? 0) + 1);
  return Math.max(0, ...counts.values());
}

/** Lay the Sankey out in a width × height box. Columns are spread evenly across the width; one
 *  value scale serves the whole chart, the largest that lets every column fit, so the busiest
 *  column fills the height and every other column is centred on it (recharts' own layout offers
 *  only relaxation, which let the short income columns drift to the bottom, or top alignment).
 *  Each column keeps the nodes in array order, the non-crossing order `moneyFlow` emits. At each
 *  node, links are stacked in the order of the node at their other end, so bands don't cross
 *  where they leave or enter it. */
export function flowLayout(flow: FlowData, { width, height, nodeWidth, nodePadding }: FlowLayoutOptions): FlowLayout {
  const columnOf = flowColumns(flow);
  const last = Math.max(0, ...columnOf);
  const inflow = new Array<number>(flow.nodes.length).fill(0);
  const outflow = new Array<number>(flow.nodes.length).fill(0);
  for (const l of flow.links) {
    outflow[l.source] += l.value;
    inflow[l.target] += l.value;
  }
  const value = flow.nodes.map((_, i) => Math.max(inflow[i], outflow[i]));

  const columns: number[][] = Array.from({ length: last + 1 }, () => []);
  columnOf.forEach((col, i) => columns[col].push(i));
  // The value scale that lets each column fit: its nodes' total over the height left by its gaps.
  const fits = columns
    .map((col) => ({ room: height - (col.length - 1) * nodePadding, total: col.reduce((s, i) => s + value[i], 0) }))
    .filter((c) => c.total > 0)
    .map((c) => c.room / c.total);
  const scale = fits.length > 0 ? Math.max(0, Math.min(...fits)) : 0;

  const nodes: PlacedNode[] = flow.nodes.map((n, i) => ({
    ...n,
    column: columnOf[i],
    x: last > 0 ? (columnOf[i] * (width - nodeWidth)) / last : 0,
    y: 0,
    width: nodeWidth,
    height: value[i] * scale,
    value: value[i],
    isSource: inflow[i] === 0,
    isTerminal: outflow[i] === 0,
  }));
  for (const col of columns) {
    const extent = col.reduce((s, i) => s + nodes[i].height, 0) + (col.length - 1) * nodePadding;
    let y = (height - extent) / 2;
    for (const i of col) {
      nodes[i].y = y;
      y += nodes[i].height + nodePadding;
    }
  }

  // Where each band leaves its source and enters its target, measured from the node's top.
  const leaveAt = new Array<number>(flow.links.length).fill(0);
  const enterAt = new Array<number>(flow.links.length).fill(0);
  const byY = (end: (l: FlowLink) => number) => (a: number, b: number) =>
    nodes[end(flow.links[a])].y - nodes[end(flow.links[b])].y;
  flow.nodes.forEach((_, i) => {
    const out = flow.links.flatMap((l, k) => (l.source === i ? [k] : [])).sort(byY((l) => l.target));
    const into = flow.links.flatMap((l, k) => (l.target === i ? [k] : [])).sort(byY((l) => l.source));
    let offset = 0;
    for (const k of out) {
      leaveAt[k] = offset;
      offset += flow.links[k].value * scale;
    }
    offset = 0;
    for (const k of into) {
      enterAt[k] = offset;
      offset += flow.links[k].value * scale;
    }
  });

  const links: PlacedLink[] = flow.links.map((l, k) => {
    const band = l.value * scale;
    const source = nodes[l.source];
    const target = nodes[l.target];
    return {
      ...l,
      sourceX: source.x + source.width,
      sourceY: source.y + leaveAt[k] + band / 2,
      targetX: target.x,
      targetY: target.y + enterAt[k] + band / 2,
      width: band,
    };
  });
  return { nodes, links };
}
