import Link from "next/link";
import CategoryPicker from "@/components/CategoryPicker";
import SignedAmount from "@/components/SignedAmount";
import { type Category, type ConflictedOperation, frenchDate, type Transaction } from "@/lib/api";
import { operations, ruleLink } from "@/lib/triage";

/** « Conflit de règles »: operations matched by rules of different categories, left without a
 *  category. Each lists the rules in cause (a link to fix each in Catégories) and a picker to class
 *  it by hand. */
export default function RuleConflicts({
  conflicts,
  categories,
  pathOf,
  onClass,
}: {
  conflicts: ConflictedOperation[];
  categories: Category[];
  pathOf: (categoryId: number) => string;
  onClass: (tx: Transaction, category: Category) => void;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-amber-300 bg-white">
      <div className="bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <span className="font-medium">Conflit de règles</span> : {operations(conflicts.length)} correspond
        {conflicts.length > 1 ? "ent" : ""} à des règles de catégories différentes et reste
        {conflicts.length > 1 ? "nt" : ""} sans catégorie. Classez-la{conflicts.length > 1 ? "s" : ""} à la
        main, ou corrigez une des règles.
      </div>
      <ul className="divide-y divide-zinc-100">
        {conflicts.map(({ transaction: t, rules }) => (
          <li key={t.id} className="space-y-1 px-3 py-2 text-sm">
            <div className="flex items-center gap-3">
              <span className="whitespace-nowrap text-xs text-zinc-500">{frenchDate(t.date_valeur)}</span>
              <span className="min-w-0 flex-1 truncate" title={t.libelle}>
                {t.libelle}
              </span>
              <span className="whitespace-nowrap text-xs text-zinc-500">{t.account_id}</span>
              <SignedAmount tx={t} />
              <CategoryPicker
                categories={categories}
                value={null}
                onChange={(id) => {
                  const category = categories.find((c) => c.id === id);
                  if (category) onClass(t, category);
                }}
                highlight
                placeholder="Catégorie…"
              />
            </div>
            <p className="text-xs text-zinc-500">
              Règles en cause :{" "}
              {rules.map((r, i) => (
                <span key={r.rule_id}>
                  {i > 0 && " ; "}
                  <Link href={ruleLink(r.pattern)} className="font-mono text-zinc-700 underline hover:text-zinc-900">
                    {r.pattern}
                  </Link>{" "}
                  ({pathOf(r.category_id)})
                </span>
              ))}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
