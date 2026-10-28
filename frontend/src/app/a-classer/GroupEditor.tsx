import type { RefObject } from "react";
import { type Category, type RulePreview, shortPath, type UncategorizedGroup } from "@/lib/api";
import { previewMessage, suggestionReason, type TriageMode } from "@/lib/triage";

/** The active group's editor state; `key` ties it to its group, so moving to another group starts
 *  from that group's defaults. */
export type Draft = {
  key: string;
  query: string;
  highlight: number;
  mode: TriageMode;
  pattern: string;
  priority: string;
  description: string;
};

/** The active group's category search, rule / manual choice, rule fields and « Classer » button.
 *  State and keyboard handling stay on the page. */
export default function GroupEditor({
  group: g,
  draft: d,
  update,
  searchRef,
  results,
  suggested,
  candidate,
  pattern,
  currentPreview,
  pathOf,
  busy,
  expanded,
  onSubmit,
  onToggleExpanded,
}: {
  group: UncategorizedGroup;
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  /** The search results shown under the query. */
  results: Category[];
  suggested: Category | null;
  /** What Enter (or « Classer ») classes the group in. */
  candidate: Category | null;
  /** The trimmed rule pattern, empty outside the rule mode. */
  pattern: string;
  currentPreview: RulePreview | null;
  pathOf: (id: number) => string;
  busy: boolean;
  expanded: boolean;
  onSubmit: (category: Category | null) => void;
  onToggleExpanded: () => void;
}) {
  return (
    <>
      <div className="flex flex-wrap items-start gap-4">
        <div className="w-80">
          <input
            ref={searchRef}
            value={d.query}
            onChange={(e) => update({ query: e.target.value, highlight: 0 })}
            placeholder="Catégorie : tapez pour chercher…"
            aria-label="Chercher une catégorie"
            className="w-full rounded border border-amber-400 bg-white px-2 py-1"
          />
          {d.query && (
            <ul className="mt-1 rounded border border-zinc-200 bg-white py-0.5">
              {results.map((c, j) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onSubmit(c)}
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
            (suggested && g.suggestion ? (
              <button
                type="button"
                onClick={() => onSubmit(suggested)}
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
              {g.count > 1 ? `Ces ${g.count} opérations` : "Cette opération"}
            </label>
            <span className="text-zinc-500">Alt+M</span>
          </div>
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
                <input
                  value={d.priority}
                  onChange={(e) => update({ priority: e.target.value })}
                  inputMode="numeric"
                  title="Priorité : le plus petit nombre l'emporte"
                  aria-label="Priorité"
                  className="w-14 rounded border border-zinc-300 bg-white px-2 py-1 text-xs"
                />
              </div>
              <p
                className={`text-xs ${currentPreview?.reclassified.length ? "text-amber-800" : "text-zinc-500"}`}
              >
                {!pattern
                  ? "Saisissez un motif."
                  : currentPreview
                    ? `${currentPreview.reclassified.length ? "⚠ " : ""}${previewMessage(currentPreview, pathOf)}`
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
        <button
          onClick={() => onSubmit(candidate)}
          disabled={!candidate || busy || (d.mode === "rule" && !pattern)}
          className="btn-primary py-1"
        >
          {candidate ? `Classer en ${shortPath(candidate)}` : "Classer"}
        </button>
        <button onClick={onToggleExpanded} className="text-zinc-600 hover:text-zinc-900">
          {expanded ? "Masquer les opérations" : "Voir les opérations"}
        </button>
      </div>
    </>
  );
}
