import { formatEuro, signedAmount, type Transaction } from "@/lib/api";

/** The rows ticked for a manual transfer decision, with the action that fits their count. */
export default function SelectionBar({
  rows,
  onPair,
  onMarkTransfer,
  onClear,
}: {
  rows: Transaction[];
  onPair: () => void;
  onMarkTransfer: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
      <span className="text-zinc-600">
        {rows.length} sélectionnée(s) :{" "}
        {rows.map((tx) => `${tx.libelle} (${formatEuro(signedAmount(tx))})`).join(" ↔ ")}
      </span>
      {rows.length === 2 ? (
        <button onClick={onPair} className="btn-primary py-0.5 text-xs">
          Associer en virement
        </button>
      ) : (
        <button
          onClick={onMarkTransfer}
          className="btn-primary py-0.5 text-xs"
          title="Virement vers un compte dont le relevé n'est pas importé - exclu des revenus/dépenses"
        >
          Marquer comme virement
        </button>
      )}
      <button onClick={onClear} className="btn-secondary px-2 py-0.5 text-xs">
        Effacer
      </button>
    </div>
  );
}
