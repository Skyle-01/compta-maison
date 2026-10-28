import SignedAmount from "@/components/SignedAmount";
import { frenchDate, type Transaction, type UncategorizedGroup } from "@/lib/api";

/** The active group's possible internal transfers: one line per (operation, partner) pair. */
export default function TransferCandidates({
  group: g,
  busy,
  onPair,
}: {
  group: UncategorizedGroup;
  busy: boolean;
  onPair: (op: Transaction, partner: Transaction) => void;
}) {
  return (
    <div className="space-y-1 text-xs">
      <p className="text-zinc-500">Virement interne ? Autre opération possible :</p>
      <table className="w-full">
        <tbody>
          {g.transfer_candidates.map(({ transaction_id, partner }) => {
            const op = g.transactions.find((t) => t.id === transaction_id);
            if (!op) return null;
            return (
              <tr key={`${op.id}-${partner.id}`} className="border-t border-zinc-100">
                {g.count > 1 && (
                  <td className="whitespace-nowrap py-1 pr-3 text-zinc-500">pour le {frenchDate(op.date_valeur)}</td>
                )}
                <td className="whitespace-nowrap py-1 pr-3">{frenchDate(partner.date_valeur)}</td>
                <td className="max-w-md truncate py-1 pr-3" title={partner.libelle}>
                  {partner.libelle}
                </td>
                <td className="whitespace-nowrap py-1 pr-3 text-zinc-500">{partner.account_id}</td>
                <td className="whitespace-nowrap py-1 pr-3 text-right">
                  <SignedAmount tx={partner} />
                </td>
                <td className="whitespace-nowrap py-1 text-right">
                  <button
                    onClick={() => onPair(op, partner)}
                    disabled={busy}
                    className="font-medium text-zinc-600 hover:text-zinc-900 disabled:opacity-40"
                  >
                    Associer en virement
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
