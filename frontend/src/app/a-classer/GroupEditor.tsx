import type { RefObject } from "react";
import AccountSelect from "@/components/AccountSelect";
import CategoryPicker from "@/components/CategoryPicker";
import { type Category, type RulePreview, shortPath, type Transaction, type UncategorizedGroup } from "@/lib/api";
import { previewMessage, type SplitForm, splitIncomplete, suggestionReason, type TriageMode } from "@/lib/triage";

/** The active group's editor state; `key` ties it to its group, so moving to another group starts
 *  from that group's defaults. */
export type Draft = {
  key: string;
  query: string;
  highlight: number;
  mode: TriageMode;
  pattern: string;
  description: string;
  /** The account the rule is limited to, null = all accounts (the group does not split by account). */
  account_id: string | null;
  /** The category picked but not yet validated (« Valider » classes), null = none picked. */
  chosen: number | null;
  /** The operations ticked in the list (« Classer seule » ticks one), empty = the whole group. */
  selected: number[];
  /** The 2nd part of a split, only for a manual classification of one operation; null = no split. */
  split: SplitForm | null;
};

/** The active group's category search, rule / manual choice, rule fields, split and « Valider » step.
 *  State and keyboard handling stay on the page. */
export default function GroupEditor({
  group: g,
  draft: d,
  scope,
  categories,
  update,
  searchRef,
  results,
  suggested,
  chosen,
  pattern,
  currentPreview,
  pathOf,
  busy,
  onChoose,
  onSubmit,
}: {
  group: UncategorizedGroup;
  draft: Draft;
  /** The operations a manual classification applies to (see `manualScope`). */
  scope: Transaction[];
  /** For the split's 2nd category. */
  categories: Category[];
  update: (patch: Partial<Draft>) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  /** The search results shown under the query. */
  results: Category[];
  suggested: Category | null;
  /** The category picked, waiting for « Valider ». */
  chosen: Category | null;
  /** The trimmed rule pattern, empty outside the rule mode. */
  pattern: string;
  currentPreview: RulePreview | null;
  pathOf: (id: number) => string;
  busy: boolean;
  /** Picks a category (a search result or the suggestion) without classing anything. */
  onChoose: (category: Category) => void;
  /** Classes in the chosen category. */
  onSubmit: (category: Category) => void;
}) {
  const single = scope.length === 1; // a manual classification of one operation (lone or ticked)
  const subset = scope.length < g.count; // some operations ticked, not all of them
  const canSplit = d.mode === "manual" && single;
  const what = d.mode === "rule" ? `la règle « ${pattern} »` : single ? "cette opération" : `ces ${scope.length} opérations`;
  return (
    <>
      <div className="flex flex-wrap items-start gap-4">
        <div className="w-80">
          <input
            ref={searchRef}
            value={d.query}
            onChange={(e) => update({ query: e.target.value, highlight: 0 })}
            // The pick stays visible, greyed, while it waits for « Valider »; typing replaces it.
            placeholder={chosen ? shortPath(chosen) : "Catégorie : tapez pour chercher…"}
            aria-label="Chercher une catégorie"
            className={`w-full rounded border px-2 py-1 ${
              chosen
                ? "border-zinc-300 bg-zinc-100 placeholder:text-zinc-600"
                : "border-amber-400 bg-white"
            }`}
          />
          {d.query && (
            <ul className="mt-1 rounded border border-zinc-200 bg-white py-0.5">
              {results.map((c, j) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onChoose(c)}
                    className={`block w-full px-2 py-1 text-left ${
                      j === d.highlight ? "bg-zinc-100 text-zinc-900" : "text-zinc-700 hover:bg-zinc-50"
                    }`}
                  >
                    {shortPath(c)}
                  </button>
                </li>
              ))}
              {results.length === 0 && <li className="px-2 py-1 text-zinc-500">Aucune catégorie</li>}
            </ul>
          )}
          {!d.query &&
            !chosen &&
            (suggested && g.suggestion ? (
              <button
                type="button"
                onClick={() => onChoose(suggested)}
                className="mt-1 text-left text-xs text-zinc-600 hover:text-zinc-900"
              >
                Suggestion : <span className="font-medium">{shortPath(suggested)}</span> (
                {suggestionReason(g.suggestion.count, g.suggestion.token)}) · Entrée
              </button>
            ) : (
              <p className="mt-1 text-xs text-zinc-500">Pas de suggestion : tapez une catégorie.</p>
            ))}
        </div>

        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-3 text-xs text-zinc-600">
            <label className="flex items-center gap-1">
              <input type="radio" checked={d.mode === "rule"} onChange={() => update({ mode: "rule" })} />
              Règle (opérations similaires)
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" checked={d.mode === "manual"} onChange={() => update({ mode: "manual" })} />
              {single ? "Cette opération" : subset ? `Ces ${scope.length} opérations cochées` : `Ces ${g.count} opérations`}
            </label>
            <span className="text-zinc-500">Alt+M</span>
            {subset && (
              <button
                type="button"
                onClick={() => update({ selected: [], split: null })}
                className="text-zinc-600 hover:text-zinc-900"
              >
                Revenir aux {g.count} opérations
              </button>
            )}
          </div>
          {canSplit && (
            // Its fields keep their own Enter and arrow keys (the page's handler would class the group).
            <div onKeyDown={(e) => e.stopPropagation()} className="text-xs text-zinc-600">
              {d.split === null ? (
                <button
                  type="button"
                  onClick={() => update({ split: { category_id: null, amount: "" } })}
                  className="text-zinc-600 hover:text-zinc-900"
                  title="Répartir l'opération entre deux catégories"
                >
                  Scinder
                </button>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span>Deuxième part :</span>
                  <input
                    value={d.split.amount}
                    onChange={(e) => d.split && update({ split: { ...d.split, amount: e.target.value } })}
                    inputMode="decimal"
                    placeholder="montant"
                    aria-label="Montant de la deuxième part"
                    className="w-20 rounded border border-zinc-300 bg-white px-1 py-0.5 text-right"
                  />
                  <span>€ dans</span>
                  <CategoryPicker
                    categories={categories}
                    value={d.split.category_id}
                    onChange={(category_id) => d.split && update({ split: { ...d.split, category_id } })}
                    highlight={d.split.category_id == null}
                    placeholder="- catégorie -"
                  />
                  <button
                    type="button"
                    onClick={() => update({ split: null })}
                    className="text-zinc-600 hover:text-zinc-900"
                  >
                    Annuler le split
                  </button>
                </div>
              )}
            </div>
          )}
          {d.mode === "rule" && (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <input
                  value={d.pattern}
                  onChange={(e) => update({ pattern: e.target.value })}
                  placeholder="texte à rechercher"
                  aria-label="Motif de la règle"
                  className="w-64 rounded border border-zinc-300 bg-white px-2 py-1 font-mono text-xs"
                />
                <AccountSelect
                  purpose="rule"
                  value={d.account_id}
                  onChange={(account_id) => update({ account_id })}
                />
              </div>
              <p
                className={`text-xs ${currentPreview?.conflicts.length ? "text-amber-800" : "text-zinc-500"}`}
              >
                {!pattern
                  ? "Saisissez un motif."
                  : currentPreview
                    ? `${currentPreview.conflicts.length ? "⚠ " : ""}${previewMessage(currentPreview, pathOf)}`
                    : "…"}
                {g.pattern_generic && d.pattern === g.pattern && " · ⚠ motif trop générique"}
              </p>
            </div>
          )}
          <input
            value={d.description}
            onChange={(e) => update({ description: e.target.value })}
            placeholder={d.mode === "rule" ? "Description de la règle (facultatif)" : "Description (facultatif)"}
            className="w-80 rounded border border-zinc-300 bg-white px-2 py-1 text-xs"
          />
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs">
        {chosen ? (
          <>
            <span className="text-zinc-700">
              Classer {what} en <span className="font-medium">{shortPath(chosen)}</span>
            </span>
            <button
              onClick={() => onSubmit(chosen)}
              disabled={busy || (d.mode === "rule" && !pattern) || (canSplit && splitIncomplete(d.split))}
              className="btn-primary py-1"
              title="Entrée"
            >
              Valider
            </button>
            <button
              type="button"
              onClick={() => {
                update({ chosen: null });
                searchRef.current?.focus({ preventScroll: true });
              }}
              className="text-zinc-600 hover:text-zinc-900"
              title="Échap"
            >
              Changer
            </button>
          </>
        ) : (
          <span className="text-zinc-500">Choisissez une catégorie, puis validez.</span>
        )}
      </div>
    </>
  );
}
