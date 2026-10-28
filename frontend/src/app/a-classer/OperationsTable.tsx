import SignedAmount from "@/components/SignedAmount";
import { frenchDate, type Transaction } from "@/lib/api";

/** The operations of the active group, shown on « Voir les opérations ». */
export default function OperationsTable({ transactions }: { transactions: Transaction[] }) {
  return (
    <table className="w-full text-xs">
      <tbody>
        {transactions.map((t) => (
          <tr key={t.id} className="border-t border-zinc-100">
            <td className="whitespace-nowrap py-1 pr-3">{frenchDate(t.date_valeur)}</td>
            <td className="max-w-md truncate py-1 pr-3" title={t.libelle}>
              {t.libelle}
            </td>
            <td className="whitespace-nowrap py-1 pr-3 text-zinc-500">{t.account_id}</td>
            <td className="whitespace-nowrap py-1 text-right">
              <SignedAmount tx={t} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
