import { useCallback, useEffect, useState } from "react";
import CategoryPicker from "@/components/CategoryPicker";
import SignedAmount from "@/components/SignedAmount";
import { api, type Category, errorMessage, frenchDate, type Rule, type Transaction } from "@/lib/api";

const RULE_PAGE = 20;

/** The operations a rule classifies, newest first, a page at a time; each can be classed aside
 *  (a manual assignment in another leaf). Remounted (key) after every change on the page. */
export default function RuleOperations({
  rule,
  categories,
  onClassAside,
}: {
  rule: Rule;
  categories: Category[];
  onClassAside: (tx: Transaction, categoryId: number) => void;
}) {
  const [items, setItems] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [asideId, setAsideId] = useState<number | null>(null);
  const [asideTarget, setAsideTarget] = useState<number | null>(null);

  const fetchPage = useCallback(
    (offset: number) =>
      api
        .listTransactions({ ruleId: rule.id, limit: RULE_PAGE, offset })
        .then((page) => {
          setItems((prev) => (offset === 0 ? page.items : [...prev, ...page.items]));
          setTotal(page.total);
        })
        .catch((e) => setError(errorMessage(e))),
    [rule.id],
  );

  useEffect(() => {
    fetchPage(0);
  }, [fetchPage]);

  if (error) return <p className="px-3 py-1.5 text-sm text-red-700">{error}</p>;
  return (
    <div className="ml-8 border-l-2 border-zinc-100 pl-3">
      <table className="w-full text-sm">
        <tbody>
          {items.map((tx) => (
            <tr key={tx.id} className="border-t border-zinc-50 first:border-t-0">
              <td className="whitespace-nowrap py-1 pr-3 text-zinc-500">{frenchDate(tx.date_valeur)}</td>
              <td className="max-w-xs truncate py-1 pr-3" title={tx.libelle}>
                {tx.libelle}
                {tx.kind === "transfer" && <span className="ml-1.5 text-xs text-zinc-500">⇄ virement</span>}
              </td>
              <td className="whitespace-nowrap py-1 pr-3 text-zinc-500">{tx.account_id ?? tx.account}</td>
              <td className="whitespace-nowrap py-1 pr-3 text-right">
                <SignedAmount tx={tx} />
              </td>
              <td className="whitespace-nowrap py-1 pr-3 text-right">
                {asideId === tx.id ? (
                  <span className="inline-flex items-center gap-2">
                    <CategoryPicker
                      categories={categories}
                      value={asideTarget}
                      onChange={setAsideTarget}
                      highlight
                      placeholder="Classer dans…"
                    />
                    <button
                      disabled={asideTarget == null}
                      onClick={() => asideTarget != null && onClassAside(tx, asideTarget)}
                      className="btn-primary px-2 py-0.5 text-xs"
                    >
                      Valider
                    </button>
                    <button onClick={() => setAsideId(null)} className="text-xs text-zinc-600 hover:text-zinc-900">
                      Annuler
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => {
                      setAsideId(tx.id);
                      setAsideTarget(null);
                    }}
                    className="text-xs text-zinc-600 hover:text-zinc-900"
                    title="Classer cette opération à la main dans une autre catégorie (exception à la règle)"
                  >
                    Classer à part
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length < total && (
        <button onClick={() => fetchPage(items.length)} className="py-1 text-xs text-zinc-600 hover:text-zinc-900">
          Afficher plus ({total - items.length} restante{total - items.length > 1 ? "s" : ""})
        </button>
      )}
    </div>
  );
}
