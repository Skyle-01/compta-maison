"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  errorMessage,
  type Category,
  formatEuro,
  frenchDate,
  frenchMonth,
  notifyUncategorizedChanged,
  type RulePreview,
  shortPath,
  type Transaction,
  type UncategorizedGroup,
} from "@/lib/api";
import SignedAmount from "@/components/SignedAmount";
import { leafCategories, searchCategories } from "@/lib/categorySearch";
import { DEFAULT_RULE_PRIORITY, ruleFormToPayload } from "@/lib/ruleForm";
import {
  classedMessage,
  defaultMode,
  nextActiveIndex,
  operations,
  pairedMessage,
  previewMessage,
  suggestionReason,
  type TriageMode,
} from "@/lib/triage";

const UNDO_DELAY_MS = 8000;
const MAX_RESULTS = 8;

/** The active group's editor state; `key` ties it to its group, so moving to another group starts
 *  from that group's defaults. */
type Draft = {
  key: string;
  query: string;
  highlight: number;
  mode: TriageMode;
  pattern: string;
  priority: string;
  description: string;
};

const draftFor = (g: UncategorizedGroup): Draft => ({
  key: g.key,
  query: "",
  highlight: 0,
  mode: defaultMode(g),
  pattern: g.pattern,
  priority: String(DEFAULT_RULE_PRIORITY),
  description: "",
});

/** The last action's confirmation: `undo` reverts it, `key` is the group to reactivate then. */
type Toast = { message: string; key: string; undo: () => Promise<unknown> };

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

function dateRange(g: UncategorizedGroup): string {
  return g.first_date === g.last_date
    ? frenchDate(g.first_date)
    : `${frenchDate(g.first_date)} – ${frenchDate(g.last_date)}`;
}

export default function TriagePage() {
  const [groups, setGroups] = useState<UncategorizedGroup[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [months, setMonths] = useState<string[]>([]);
  const [month, setMonth] = useState("");
  const [active, setActive] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ query: string; result: RulePreview } | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    api.listCategories().then(setCategories).catch((e) => setError(errorMessage(e)));
    api
      .dashboard()
      .then((d) => setMonths(d.months_available))
      .catch((e) => setError(errorMessage(e)));
  }, []);

  /** Refetch the groups, then activate the group `followingKey` if it is still listed, else the
   *  one now at `fallback`. */
  const load = useCallback(
    (followingKey: string | null, fallback: number) =>
      api.uncategorizedGroups(month || undefined).then((next) => {
        setGroups(next);
        setActive(nextActiveIndex(next.map((g) => g.key), followingKey, fallback));
      }),
    [month],
  );

  useEffect(() => {
    load(null, 0).catch((e) => setError(errorMessage(e)));
  }, [load]);

  const current = groups?.[active] ?? null;
  const d = current ? (draft?.key === current.key ? draft : draftFor(current)) : null;
  const update = (patch: Partial<Draft>) => d && setDraft({ ...d, ...patch });

  const leaves = useMemo(() => leafCategories(categories), [categories]);
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const pathOf = (id: number) => {
    const c = byId.get(id);
    return c ? shortPath(c) : `#${id}`;
  };
  const results = d?.query ? searchCategories(d.query, leaves).slice(0, MAX_RESULTS) : [];
  const suggested = current?.suggestion
    ? (leaves.find((c) => c.id === current.suggestion?.category_id) ?? null)
    : null;
  // What Enter (or « Valider ») classes the group in: the highlighted search result, else the suggestion.
  const candidate = d?.query ? (results[d.highlight] ?? null) : suggested;

  // Keep the active group on screen and the keyboard in its category search.
  useEffect(() => {
    if (!current) return;
    rowRefs.current.get(current.key)?.scrollIntoView({ block: "nearest" });
    searchRef.current?.focus({ preventScroll: true });
  }, [current]);

  // Debounced rule preview: rows the rule would classify, and rows it would take from other rules.
  const pattern = d?.mode === "rule" ? d.pattern.trim() : "";
  const priority = Number(d?.priority) || DEFAULT_RULE_PRIORITY;
  const previewQuery = pattern ? `${pattern}\u0000${priority}\u0000${candidate?.id ?? ""}` : "";
  useEffect(() => {
    if (!previewQuery) return;
    const [p, prio, categoryId] = previewQuery.split("\u0000");
    const timer = setTimeout(() => {
      api
        .previewRule(p, Number(prio), categoryId ? Number(categoryId) : null)
        .then((result) => setPreview({ query: previewQuery, result }))
        .catch(() => setPreview(null));
    }, 250);
    return () => clearTimeout(timer);
  }, [previewQuery]);
  const currentPreview = preview?.query === previewQuery ? preview.result : null;

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), UNDO_DELAY_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  /** Run an action on the active group, show its toast, then activate `followingKey` (or the
   *  group now at the same position). */
  async function act(followingKey: string | null, perform: () => Promise<Toast>) {
    setBusy(true);
    setError(null);
    try {
      setToast(await perform());
      notifyUncategorizedChanged();
      await load(followingKey, active);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function submit(category: Category | null) {
    if (!groups || !current || !d || !category || busy) return;
    if (d.mode === "rule" && !pattern) return;
    const path = shortPath(category);
    return act(groups[active + 1]?.key ?? null, async () => {
      if (d.mode === "manual") {
        const ids = current.transactions.map((t) => t.id);
        await api.updateTransactions(ids, category.id, d.description.trim() || null);
        return {
          message: classedMessage(ids.length, path),
          key: current.key,
          undo: () => api.updateTransactions(ids, null, null),
        };
      }
      const before = await api.uncategorizedCount();
      const rule = await api.createRule(
        ruleFormToPayload({
          category_id: category.id,
          pattern,
          priority: d.priority,
          is_income_anchor: false,
          description: d.description,
        }),
      );
      const after = await api.uncategorizedCount();
      return {
        message: `Règle « ${pattern} » créée : ${classedMessage(before - after, path)}`,
        key: current.key,
        undo: () => api.deleteRule(rule.id),
      };
    });
  }

  /** Pair one of the active group's operations with `partner` as a transfer. A group with other
   *  operations stays active; « Annuler » hands both legs back to automatic detection. */
  function pair(op: Transaction, partner: Transaction) {
    if (!groups || !current || busy) return;
    const following = current.count > 1 ? current.key : (groups[active + 1]?.key ?? null);
    return act(following, async () => {
      await api.pairTransfer([op.id, partner.id]);
      return {
        message: pairedMessage(op, partner),
        key: current.key,
        undo: () => api.setTransferMode(op.id, "auto"),
      };
    });
  }

  async function undo() {
    if (!toast) return;
    const { key, undo: revert } = toast;
    setToast(null);
    setError(null);
    try {
      await revert();
      notifyUncategorizedChanged();
      await load(key, active);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!groups || !current || !d) return;
    const inSearch = e.target === searchRef.current;
    if (e.altKey && e.code === "KeyM") {
      e.preventDefault();
      update({ mode: d.mode === "rule" ? "manual" : "rule" });
      return;
    }
    if (e.altKey && e.code === "KeyZ") {
      e.preventDefault();
      undo();
      return;
    }
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        e.preventDefault();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        if (inSearch && d.query) update({ highlight: clamp(d.highlight + delta, 0, results.length - 1) });
        else setActive(clamp(active + delta, 0, groups.length - 1));
        return;
      }
      case "ArrowRight":
      case "ArrowLeft":
        if (inSearch && !d.query) {
          e.preventDefault();
          if (expanded.has(current.key) !== (e.key === "ArrowRight")) toggleExpanded(current.key);
        }
        return;
      case "Enter":
        // In a field only: Enter on a button keeps its own action.
        if (!(e.target instanceof HTMLInputElement)) return;
        e.preventDefault();
        submit(candidate);
        return;
      case "Escape":
        e.preventDefault();
        if (d.query) update({ query: "", highlight: 0 });
        else setDraft(draftFor(current));
        return;
    }
  }

  const total = groups?.reduce((n, g) => n + g.count, 0) ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">À classer</h1>
          {groups && groups.length > 0 && (
            <p className="text-sm text-zinc-500">
              {operations(total)} sans catégorie, en {groups.length} groupe{groups.length > 1 ? "s" : ""}{" "}
              d’opérations similaires
            </p>
          )}
        </div>
        <select
          className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        >
          <option value="">Tous les mois</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {frenchMonth(m)}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-zinc-500">
        ↑ ↓ changer de groupe · tapez pour chercher une catégorie · Entrée valider (la suggestion si rien
        n’est tapé) · Alt+M règle / opérations · → ← détails · Échap effacer · Alt+Z annuler le dernier classement
      </p>

      {error && <p className="text-sm text-red-700">{error}</p>}

      {groups && groups.length === 0 && (
        <p className="rounded-lg border border-zinc-200 bg-white px-3 py-6 text-center text-sm text-zinc-500">
          Aucune opération à classer{month ? " ce mois-ci" : ""}.
        </p>
      )}

      {groups && groups.length > 0 && (
        <div className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 bg-white">
          {groups.map((g, i) => {
            const isActive = i === active;
            const net = g.credit - g.debit;
            return (
              <div
                key={g.key}
                ref={(el) => {
                  if (el) rowRefs.current.set(g.key, el);
                  else rowRefs.current.delete(g.key);
                }}
                className={isActive ? "bg-zinc-50" : ""}
              >
                <div
                  onClick={() => setActive(i)}
                  className={`flex cursor-pointer items-center gap-4 px-3 py-2 text-sm ${
                    isActive ? "border-l-2 border-zinc-800" : "border-l-2 border-transparent hover:bg-zinc-50"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium" title={g.transactions[0].libelle}>
                      {g.transactions[0].libelle}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {operations(g.count)} · {dateRange(g)} · {g.accounts.join(", ")}
                    </div>
                  </div>
                  {!isActive && g.suggestion && (
                    <span className="truncate text-xs text-zinc-500">→ {pathOf(g.suggestion.category_id)}</span>
                  )}
                  <span className={`whitespace-nowrap ${net >= 0 ? "text-green-700" : "text-red-700"}`}>
                    {formatEuro(net)}
                  </span>
                </div>

                {isActive && d && (
                  <div onKeyDown={onKeyDown} className="space-y-2 border-l-2 border-zinc-800 px-3 pb-3 text-sm">
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
                                  onClick={() => submit(c)}
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
                              onClick={() => submit(suggested)}
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
                            <input
                              type="radio"
                              checked={d.mode === "rule"}
                              onChange={() => update({ mode: "rule" })}
                            />
                            Règle (opérations similaires)
                          </label>
                          <label className="flex items-center gap-1">
                            <input
                              type="radio"
                              checked={d.mode === "manual"}
                              onChange={() => update({ mode: "manual" })}
                            />
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
                                className="w-64 rounded border border-zinc-300 px-1 py-0.5 font-mono text-xs"
                              />
                              <input
                                value={d.priority}
                                onChange={(e) => update({ priority: e.target.value })}
                                inputMode="numeric"
                                title="Priorité : le plus petit nombre l’emporte"
                                aria-label="Priorité"
                                className="w-14 rounded border border-zinc-300 px-1 py-0.5 text-xs"
                              />
                            </div>
                            <p
                              className={`text-xs ${
                                currentPreview?.reclassified.length ? "text-amber-800" : "text-zinc-500"
                              }`}
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
                          className="w-80 rounded border border-zinc-300 px-2 py-0.5 text-xs"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-3 text-xs">
                      <button
                        onClick={() => submit(candidate)}
                        disabled={!candidate || busy || (d.mode === "rule" && !pattern)}
                        className="rounded bg-zinc-800 px-3 py-0.5 text-white disabled:opacity-40"
                      >
                        {candidate ? `Classer en ${shortPath(candidate)}` : "Classer"}
                      </button>
                      <button
                        onClick={() => toggleExpanded(g.key)}
                        className="text-zinc-600 hover:text-zinc-900"
                      >
                        {expanded.has(g.key) ? "Masquer les opérations" : "Voir les opérations"}
                      </button>
                    </div>

                    {g.transfer_candidates.length > 0 && (
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
                                    <td className="whitespace-nowrap py-1 pr-3 text-zinc-500">
                                      pour le {frenchDate(op.date_valeur)}
                                    </td>
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
                                      onClick={() => pair(op, partner)}
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
                    )}

                    {expanded.has(g.key) && (
                      <table className="w-full text-xs">
                        <tbody>
                          {g.transactions.map((t) => (
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
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 flex items-center gap-4 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm shadow-lg">
          <span className="text-green-700">{toast.message}</span>
          <button onClick={undo} className="font-medium text-zinc-600 hover:text-zinc-900" title="Alt+Z">
            Annuler
          </button>
        </div>
      )}
    </div>
  );
}
