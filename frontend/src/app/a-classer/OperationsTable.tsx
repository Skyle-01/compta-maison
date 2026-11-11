import AccountDot from "@/components/AccountDot";
import SignedAmount from "@/components/SignedAmount";
import { type Account, frenchDate, type Transaction } from "@/lib/api";

/** The operations of the active group, each with a checkbox and its own « Classer seule » button. */
export default function OperationsTable({
  transactions,
  accounts,
  selected,
  onToggle,
  onToggleAll,
  onTarget,
  oldestFirst,
  onToggleOrder,
}: {
  /** Newest first, as the API sends them. */
  transactions: Transaction[];
  accounts: Account[];
  /** The ticked operations the editor is aimed at, empty = the whole group. */
  selected: number[];
  onToggle: (id: number) => void;
  /** Ticks every operation, or none when all are ticked. */
  onToggleAll: () => void;
  /** Aims the editor at one operation, null = back to the group. */
  onTarget: (id: number | null) => void;
  /** Date order of the list: oldest first when true, else newest first. */
  oldestFirst: boolean;
  onToggleOrder: () => void;
}) {
  const ordered = oldestFirst ? [...transactions].reverse() : transactions;
  const allTicked = transactions.every((t) => selected.includes(t.id));
  return (
    <table className="w-full text-xs">
      <thead>
        <tr>
          <th className="w-6 py-1 pl-1 text-left font-normal">
            <input
              type="checkbox"
              checked={allTicked}
              onChange={onToggleAll}
              aria-label="Cocher toutes les opérations"
              title="Cocher / décocher tout"
            />
          </th>
          <th className="py-1 pl-1 pr-3 text-left font-normal">
            <button
              type="button"
              onClick={onToggleOrder}
              className="text-zinc-600 hover:text-zinc-900"
              title={oldestFirst ? "Trier les plus récentes d'abord" : "Trier les plus anciennes d'abord"}
            >
              Date {oldestFirst ? "↑" : "↓"}
            </button>
          </th>
          <th colSpan={4} className="text-left font-normal text-zinc-500">
            {selected.length > 0 && `${selected.length} cochée${selected.length > 1 ? "s" : ""}`}
          </th>
        </tr>
      </thead>
      <tbody>
        {ordered.map((t) => {
          const ticked = selected.includes(t.id);
          const alone = ticked && selected.length === 1;
          return (
            <tr key={t.id} className={`border-t border-zinc-100 ${ticked ? "bg-amber-50" : ""}`}>
              <td className="py-1 pl-1">
                <input
                  type="checkbox"
                  checked={ticked}
                  onChange={() => onToggle(t.id)}
                  aria-label={`Cocher ${t.libelle}`}
                />
              </td>
              <td className="whitespace-nowrap py-1 pl-1 pr-3">{frenchDate(t.date_valeur)}</td>
              <td className="max-w-md truncate py-1 pr-3" title={t.libelle}>
                {t.libelle}
              </td>
              <td className="whitespace-nowrap py-1 pr-3 text-zinc-500">
                <AccountDot accounts={accounts} code={t.account_id} />
                {t.account_id}
              </td>
              <td className="whitespace-nowrap py-1 pr-3 text-right">
                <SignedAmount tx={t} />
              </td>
              <td className="whitespace-nowrap py-1 pr-1 text-right">
                <button
                  type="button"
                  onClick={() => onTarget(alone ? null : t.id)}
                  className="text-zinc-600 hover:text-zinc-900"
                  title={alone ? "Revenir à tout le groupe" : "Classer cette opération seule, dans sa propre catégorie"}
                >
                  {alone ? "Annuler" : "Classer seule"}
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
