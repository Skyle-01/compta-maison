import { useState } from "react";
import SignedAmount from "@/components/SignedAmount";
import { frenchDate, type Transaction } from "@/lib/api";

/** One manual assignment of a leaf: tick to move it, edit its note, or clear the assignment.
 *  `onSaveNote` resolves false when the save failed (the editor stays open). */
export default function ManualRow({
  tx,
  selected,
  onToggleSelected,
  onSaveNote,
  onRemove,
}: {
  tx: Transaction;
  selected: boolean;
  onToggleSelected: () => void;
  onSaveNote: (note: string) => Promise<boolean>;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");

  async function save() {
    if (await onSaveNote(note)) setEditing(false);
  }

  return (
    <tr className="border-t border-zinc-50 first:border-t-0">
      <td className="w-6 py-1 pl-3 pr-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelected}
          aria-label={`Sélectionner « ${tx.libelle} »`}
        />
      </td>
      <td className="whitespace-nowrap py-1 pr-3 text-zinc-500">{frenchDate(tx.date_valeur)}</td>
      <td className="max-w-xs truncate py-1 pr-3" title={tx.libelle}>
        {tx.libelle}
      </td>
      <td className="whitespace-nowrap py-1 pr-3 text-zinc-500">{tx.account_id ?? tx.account}</td>
      <td className="whitespace-nowrap py-1 pr-3 text-right">
        <SignedAmount tx={tx} />
      </td>
      <td className="py-1 pr-3 text-zinc-500">
        {editing ? (
          <input
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setEditing(false);
            }}
            placeholder="Description"
            className="w-full rounded border border-zinc-300 px-2 py-0.5 text-sm"
          />
        ) : (
          (tx.note ?? "")
        )}
      </td>
      <td className="whitespace-nowrap py-1 pr-3 text-right">
        {editing ? (
          <>
            <button onClick={save} className="mr-2 btn-primary px-2 py-0.5 text-xs">
              Enregistrer
            </button>
            <button onClick={() => setEditing(false)} className="text-xs text-zinc-600 hover:text-zinc-900">
              Annuler
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => {
                setNote(tx.note ?? "");
                setEditing(true);
              }}
              className="mr-2 text-zinc-600 hover:text-zinc-900"
              title="Modifier la description"
            >
              ✎
            </button>
            <button onClick={onRemove} className="text-zinc-600 hover:text-red-700" title="Supprimer le classement manuel">
              ✕
            </button>
          </>
        )}
      </td>
    </tr>
  );
}
