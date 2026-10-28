"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import HelpLink from "@/components/HelpLink";
import {
  api,
  errorMessage,
  type Category,
  frenchMonth,
  notifyUncategorizedChanged,
  type RulePreview,
  shortPath,
  type Transaction,
  type UncategorizedGroup,
} from "@/lib/api";
import { leafCategories, searchCategories } from "@/lib/categorySearch";
import { DEFAULT_RULE_PRIORITY, ruleFormToPayload } from "@/lib/ruleForm";
import { classedMessage, defaultMode, nextActiveIndex, operations, pairedMessage } from "@/lib/triage";
import GroupEditor, { type Draft } from "./GroupEditor";
import GroupSummary from "./GroupSummary";
import OperationsTable from "./OperationsTable";
import Shortcuts from "./Shortcuts";
import TransferCandidates from "./TransferCandidates";

const UNDO_DELAY_MS = 8000;
const MAX_RESULTS = 8;

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
          <h1 className="text-xl font-semibold">
            À classer
            <HelpLink page="/a-classer" />
          </h1>
          {groups && groups.length > 0 && (
            <p className="text-sm text-zinc-500">
              {operations(total)} sans catégorie, en {groups.length} groupe{groups.length > 1 ? "s" : ""}{" "}
              d’opérations similaires
            </p>
          )}
        </div>
        <select
          className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm"
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

      <Shortcuts />

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
            return (
              <div
                key={g.key}
                ref={(el) => {
                  if (el) rowRefs.current.set(g.key, el);
                  else rowRefs.current.delete(g.key);
                }}
                className={isActive ? "bg-zinc-50 ring-1 ring-zinc-300 ring-inset" : ""}
              >
                <GroupSummary group={g} isActive={isActive} pathOf={pathOf} onSelect={() => setActive(i)} />

                {isActive && d && (
                  <div onKeyDown={onKeyDown} className="space-y-2 px-3 pb-3 text-sm">
                    <GroupEditor
                      group={g}
                      draft={d}
                      update={update}
                      searchRef={searchRef}
                      results={results}
                      suggested={suggested}
                      candidate={candidate}
                      pattern={pattern}
                      currentPreview={currentPreview}
                      pathOf={pathOf}
                      busy={busy}
                      expanded={expanded.has(g.key)}
                      onSubmit={submit}
                      onToggleExpanded={() => toggleExpanded(g.key)}
                    />
                    {g.transfer_candidates.length > 0 && <TransferCandidates group={g} busy={busy} onPair={pair} />}
                    {expanded.has(g.key) && <OperationsTable transactions={g.transactions} />}
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
