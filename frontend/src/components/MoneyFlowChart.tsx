"use client";

import { type MouseEvent, useEffect, useMemo, useState } from "react";
import { formatEuro } from "@/lib/api";
import { busiestColumn, flowLayout, type PlacedLink, type PlacedNode } from "@/lib/flowLayout";
import type { FlowData, FlowRole } from "@/lib/moneyFlow";

// Sankey node colour per role (the graph comes from lib/moneyFlow.ts, its layout from lib/flowLayout.ts).
const ROLE_COLORS: Record<FlowRole, string> = {
  income: "#15803d", // green — money coming in
  budget: "#0284c7", // sky — the central pool
  savings: "#7c3aed", // violet — épargne set aside
  expense: "#dc2626", // red — money going out
  net: "#0d9488", // teal — the balancing surplus / deficit
};

// Pointer handlers shared by the chart's nodes and links: show `text` in the tooltip, hide it.
interface FlowHover {
  onHover: (e: MouseEvent, text: string) => void;
  onLeave: () => void;
}

// Label length caps: a one-line label also carries the amount, so its name gets less room.
const FLOW_LABEL_MAX = 26;
const FLOW_LABEL_MAX_ONE_LINE = 18;
const TWO_LINE_MIN_HEIGHT = 22;
// White outline behind label text (drawn under the fill), readable over links.
const HALO = { stroke: "#ffffff", strokeWidth: 3, strokeLinejoin: "round", paintOrder: "stroke" } as const;

/** Sankey node: a coloured rectangle plus its label. Sources (no incoming links) label to the left
 *  into the left gutter, terminal nodes (no outgoing links, in the last column) to the right;
 *  middle-column nodes label to the left of their bar over a white halo so the links passing
 *  through don't cover the text. A node tall enough for two lines shows name over amount; a short
 *  one gets a single line (name + amount at the edges, name only in the middle — the tooltip
 *  still has the amount). */
function FlowNode({ node, onHover, onLeave }: { node: PlacedNode } & FlowHover) {
  const { x, y, width, height } = node;
  const isMiddle = !node.isTerminal && !node.isSource;
  const labelX = node.isTerminal ? x + width + 6 : x - 6;
  const anchor = node.isTerminal ? "start" : "end";
  const midY = y + height / 2;
  const twoLines = height >= TWO_LINE_MIN_HEIGHT;
  const max = twoLines || isMiddle ? FLOW_LABEL_MAX : FLOW_LABEL_MAX_ONE_LINE;
  const name = node.name.length > max ? `${node.name.slice(0, max - 1)}…` : node.name;
  const amount = formatEuro(node.value);
  return (
    <g onMouseMove={(e) => onHover(e, `${node.name} : ${amount}`)} onMouseLeave={onLeave}>
      <rect x={x} y={y} width={width} height={height} fill={ROLE_COLORS[node.role]} fillOpacity={0.9} />
      {twoLines ? (
        <>
          <text x={labelX} y={midY - 3} textAnchor={anchor} fontSize={11} fill="#3f3f46" {...HALO}>
            {name}
          </text>
          <text x={labelX} y={midY + 10} textAnchor={anchor} fontSize={10} fill="#71717a" {...HALO}>
            {amount}
          </text>
        </>
      ) : (
        <text x={labelX} y={midY + 4} textAnchor={anchor} fontSize={11} fill="#3f3f46" {...HALO}>
          {name}
          {!isMiddle && (
            <tspan fontSize={10} fill="#71717a">
              {"  "}
              {amount}
            </tspan>
          )}
        </text>
      )}
    </g>
  );
}

/** Sankey link: a cubic band, tinted by what the flow carries (income green, expenses red,
 *  épargne violet, reste teal) so a flow can be followed from Budget to its leaf. */
function FlowLinkPath({ link, label, onHover, onLeave }: { link: PlacedLink; label: string } & FlowHover) {
  const { sourceX, sourceY, targetX, targetY } = link;
  const midX = (sourceX + targetX) / 2;
  return (
    <path
      d={`M${sourceX},${sourceY} C${midX},${sourceY} ${midX},${targetY} ${targetX},${targetY}`}
      fill="none"
      stroke={ROLE_COLORS[link.role]}
      strokeOpacity={0.2}
      strokeWidth={Math.max(1, link.width)}
      onMouseMove={(e) => onHover(e, label)}
      onMouseLeave={onLeave}
    />
  );
}

// Room around the bars: the first and last columns carry their labels outside them.
const FLOW_MARGIN = { left: 180, right: 180, top: 12, bottom: 12 };

/** Width of an element, kept current by a ResizeObserver (0 until it is mounted). */
function useElementWidth(el: HTMLElement | null): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return width;
}

/** The money-flow Sankey as plain SVG, laid out by lib/flowLayout.ts (recharts' <Sankey> can't
 *  centre its short columns), with a tooltip that follows the pointer. The height follows the
 *  busiest column; above `maxHeight` (a printed page) the whole chart is scaled down to fit, laid
 *  out wider so it still fills the width once shrunk. */
export default function MoneyFlowChart({ flow, maxHeight }: { flow: FlowData; maxHeight?: number }) {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const width = useElementWidth(box);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const natural = Math.max(360, busiestColumn(flow) * 40);
  const scale = maxHeight && natural > maxHeight ? maxHeight / natural : 1;
  const height = natural * scale; // on screen
  const layoutWidth = width / scale;
  const layout = useMemo(
    () =>
      width > 0
        ? flowLayout(flow, {
            width: layoutWidth - FLOW_MARGIN.left - FLOW_MARGIN.right,
            height: natural - FLOW_MARGIN.top - FLOW_MARGIN.bottom,
            nodeWidth: 12,
            nodePadding: 24,
          })
        : null,
    [flow, width, layoutWidth, natural],
  );
  const hover: FlowHover = {
    onHover: (e, text) => {
      const r = box?.getBoundingClientRect();
      if (r) setTip({ x: e.clientX - r.left, y: e.clientY - r.top, text });
    },
    onLeave: () => setTip(null),
  };
  return (
    <div ref={setBox} className="relative" style={{ height }}>
      {layout && (
        <svg width={width} height={height} viewBox={`0 0 ${layoutWidth} ${natural}`}>
          <g transform={`translate(${FLOW_MARGIN.left},${FLOW_MARGIN.top})`}>
            {layout.links.map((l, i) => (
              <FlowLinkPath
                key={i}
                link={l}
                label={`${flow.nodes[l.source].name} → ${flow.nodes[l.target].name} : ${formatEuro(l.value)}`}
                {...hover}
              />
            ))}
            {layout.nodes.map((n, i) => (
              <FlowNode key={i} node={n} {...hover} />
            ))}
          </g>
        </svg>
      )}
      {tip && (
        // Opens away from the nearest edges so it never spills out of the card.
        <div
          className="pointer-events-none absolute whitespace-nowrap rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-800 shadow-sm"
          style={{
            ...(tip.x < width / 2 ? { left: tip.x + 12 } : { right: width - tip.x + 12 }),
            ...(tip.y < height / 2 ? { top: tip.y + 12 } : { bottom: height - tip.y + 12 }),
          }}
        >
          {tip.text}
        </div>
      )}
    </div>
  );
}
