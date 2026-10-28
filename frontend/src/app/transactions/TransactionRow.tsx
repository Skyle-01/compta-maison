import type { ReactNode } from "react";
import SignedAmount from "@/components/SignedAmount";
import { frenchDate, type Transaction, type TransferMode } from "@/lib/api";

/** A row the user declared "not a transfer": say so, with a way back to automatic detection. */
function NotTransferBadge({ tx, onAuto }: { tx: Transaction; onAuto: () => void }) {
  if (!tx.kind_manual) return null;
  return (
    <span className="text-xs text-zinc-500" title="Décision manuelle : n'est pas un virement">
      ✎ pas un virement ·{" "}
      <button onClick={onAuto} className="text-zinc-600 hover:text-zinc-900" title="Revenir à la détection automatique">
        Auto
      </button>
    </span>
  );
}

export default function TransactionRow({
  tx,
  checked,
  checkDisabled,
  onToggle,
  onSetMode,
  onOpenEditor,
  editor,
}: {
  tx: Transaction;
  checked: boolean;
  checkDisabled: boolean;
  onToggle: () => void;
  onSetMode: (mode: TransferMode, message: string) => void;
  onOpenEditor: () => void;
  /** The open categorisation editor of this row, else null. */
  editor: ReactNode | null;
}) {
  const backToAuto = () => onSetMode("auto", "Détection automatique rétablie.");
  return (
    <tr className="border-t border-zinc-100 align-top">
      <td className="px-2 py-1.5">
        <input
          type="checkbox"
          checked={checked}
          disabled={checkDisabled}
          onChange={onToggle}
          aria-label="Sélectionner"
        />
      </td>
      <td className="whitespace-nowrap px-3 py-1.5">{frenchDate(tx.date_valeur)}</td>
      <td className="max-w-md truncate px-3 py-1.5" title={tx.libelle}>
        {tx.libelle}
      </td>
      <td className="whitespace-nowrap px-3 py-1.5 text-zinc-500">{tx.account}</td>
      <td className="whitespace-nowrap px-3 py-1.5 text-right">
        <SignedAmount tx={tx} />
      </td>
      <td className="px-3 py-1.5">
        {tx.kind === "transfer" ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              className="inline-block rounded bg-zinc-100 px-2 py-0.5 text-zinc-500"
              title="Virement / mouvement d'épargne - exclu des revenus/dépenses"
            >
              ⇄ virement
            </span>
            {tx.kind_manual && (
              <span className="text-zinc-500" title="Décision manuelle">
                ✎
              </span>
            )}
            {(tx.transfer_group_id != null || tx.kind_manual) && (
              <button
                onClick={() => onSetMode("none", "Virement dissocié.")}
                className="text-zinc-600 hover:text-zinc-900"
                title="Ce n'est pas un virement : compter dans les revenus/dépenses"
              >
                Dissocier
              </button>
            )}
            {tx.kind_manual && (
              <button
                onClick={backToAuto}
                className="text-zinc-600 hover:text-zinc-900"
                title="Revenir à la détection automatique"
              >
                Auto
              </button>
            )}
          </div>
        ) : editor !== null ? (
          editor
        ) : tx.category_id ? (
          <div className="flex flex-wrap items-center gap-2">
            <span>{tx.category}</span>
            <NotTransferBadge tx={tx} onAuto={backToAuto} />
            {tx.category_manual ? (
              <span className="text-xs text-zinc-500" title="Assigné manuellement">
                ✎
              </span>
            ) : tx.rule_id != null ? (
              <span className="text-xs text-zinc-500" title={`Classé par la règle « ${tx.rule_pattern} »`}>
                ⚙
              </span>
            ) : null}
            {tx.note && <span className="text-xs italic text-zinc-500">- {tx.note}</span>}
            <button
              onClick={onOpenEditor}
              className="text-xs text-zinc-600 hover:text-zinc-900"
              title="Modifier le classement"
            >
              Modifier
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onOpenEditor}
              className="rounded border border-amber-400 bg-amber-50 px-2 py-0.5 text-xs text-amber-800 hover:bg-amber-100"
            >
              Classer
            </button>
            <NotTransferBadge tx={tx} onAuto={backToAuto} />
          </div>
        )}
      </td>
    </tr>
  );
}
