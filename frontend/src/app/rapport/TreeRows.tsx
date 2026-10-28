import SignedAmount from "@/components/SignedAmount";
import { type CategoryNode, formatEuro, type Transaction, treeLabel } from "@/lib/api";
import { dayMonth } from "@/lib/report";
import { NUM } from "./tableStyles";

/** The dashboard's « Détail par catégorie » tree, fully open: paper has no drill-down. */
export default function TreeRows({
  node,
  depth,
  operations,
}: {
  node: CategoryNode;
  depth: number;
  operations: Map<CategoryNode, Transaction[]>;
}) {
  if (node.credit === 0 && node.debit === 0) return null;
  return (
    <>
      <tr className="break-inside-avoid border-b border-zinc-100">
        <td className={`py-0.5 pr-2 ${depth <= 1 ? "font-medium" : ""}`} style={{ paddingLeft: depth * 16 }}>
          {treeLabel(node.name)}
        </td>
        <td className={`${NUM} ${node.balance >= 0 ? "text-green-700" : "text-red-700"}`}>
          {formatEuro(node.balance)}
        </td>
      </tr>
      {operations.get(node)?.map((t) => (
        <tr key={t.id} className="break-inside-avoid text-[10px] leading-tight text-zinc-600">
          <td className="pr-2" style={{ paddingLeft: (depth + 1) * 16 }}>
            <span className="mr-2 tabular-nums text-zinc-500">{dayMonth(t.date_valeur)}</span>
            {t.libelle}
          </td>
          <td className="px-1.5 text-right tabular-nums whitespace-nowrap">
            <SignedAmount tx={t} />
          </td>
        </tr>
      ))}
      {node.children.map((child) => (
        <TreeRows key={child.id ?? child.name} node={child} depth={depth + 1} operations={operations} />
      ))}
    </>
  );
}
