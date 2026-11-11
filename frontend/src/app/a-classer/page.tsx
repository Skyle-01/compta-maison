"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AccountSelect from "@/components/AccountSelect";
import { useFilters } from "@/components/FiltersProvider";
import HelpLink from "@/components/HelpLink";
import PeriodFilter from "@/components/PeriodFilter";
import {
  api,
  errorMessage,
  type Category,
  type ConflictedOperation,
  notifyUncategorizedChanged,
  type RulePreview,
  shortPath,
  type Transaction,
  type UncategorizedGroup,
} from "@/lib/api";
import { leafCategories, searchCategories } from "@/lib/categorySearch";
import { ruleFormToPayload } from "@/lib/ruleForm";
import { useAccounts } from "@/lib/useAccounts";
import {
  classedMessage,
  conflictsMessage,
  defaultMode,
  type GroupSort,
  manualScope,
  nextActiveIndex,
  operations,
  pairedMessage,
  sortGroups,
  splitAmount,
  splitIncomplete,
} from "@/lib/triage";
import GroupEditor, { type Draft } from "./GroupEditor";
import GroupSummary from "./GroupSummary";
import RuleConflicts from "./RuleConflicts";
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
  description: "",
  account_id: null,
  chosen: null,
  selected: [],
  split: null,
});

/** The last action's confirmation: `undo` reverts it, `key` is the group to reactivate then. */
type Toast = { message: string; key: string; undo: () => Promise<unknown> };

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export default function TriagePage() {
  const [groups, setGroups] = useState<UncategorizedGroup[] | null>(null);
  const [conflicts, setConflicts] = useState<ConflictedOperation[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const accounts = useAccounts();
  const { ready, monthFilter, account, setAccount } = useFilters();
  const [sort, setSort] = useState<GroupSort>("amount");
  const [oldestFirst, setOldestFirst] = useState(false); // date order of a group's operations list
  const [active, setActive] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState<{ query: string; result: RulePreview } | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    api.listCategories().then(setCategories).catch((e) => setError(errorMessage(e)));
  }, []);

  const request = useRef(0); // a slower answer for previous filters must not overwrite this one
  /** Refetch the groups, then activate the group `followingKey` if it is still listed, else the
   *  one now at `fallback`. */
  const load = useCallback(
    (followingKey: string | null, fallback: number) => {
      const id = ++request.current;
      const scope = { month: monthFilter, account: account ?? undefined };
      return Promise.all([api.uncategorizedGroups(scope), api.ruleConflicts(scope)]).then(
        ([next, conflicted]) => {
          if (id !== request.current) return;
          const sorted = sortGroups(next, sort);
          setGroups(sorted);
          setConflicts(conflicted);
          setActive(nextActiveIndex(sorted.map((g) => g.key), followingKey, fallback));
        },
      );
    },
    [monthFilter, account, sort],
  );

  useEffect(() => {
    if (ready) load(null, 0).catch((e) => setError(errorMessage(e)));
  }, [ready, load]);

  const current = groups?.[active] ?? null;
  const d = current ? (draft?.key === current.key ? draft : draftFor(current)) : null;
  const update = (patch: Partial<Draft>) => d && setDraft({ ...d, ...patch });
  // The operations a manual classification applies to: the ticked ones, else the group.
  const scope = current && d ? manualScope(current, d.selected) : [];

  /** Aim the editor at one operation (« Classer seule ») or back at the whole group. */
  function target(id: number | null) {
    update({ selected: id == null ? [] : [id], split: null, ...(id != null && { mode: "manual" as const }) });
    searchRef.current?.focus({ preventScroll: true });
  }

  /** Tick or untick one operation; ticking aims the editor at the ticked ones (manual mode, no split). */
  function toggle(id: number) {
    if (!d) return;
    const selected = d.selected.includes(id) ? d.selected.filter((x) => x !== id) : [...d.selected, id];
    update({ selected, split: null, mode: "manual" });
  }

  function toggleAll() {
    if (!current || !d) return;
    const all = current.transactions.every((t) => d.selected.includes(t.id));
    update({ selected: all ? [] : current.transactions.map((t) => t.id), split: null, mode: "manual" });
  }

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
  // The category picked and waiting for « Valider ».
  const chosen = d?.chosen != null ? (byId.get(d.chosen) ?? null) : null;
  // What Enter picks while a query is typed.
  const highlighted = d?.query ? (results[d.highlight] ?? null) : null;
  // The category the rule preview is computed for: what is about to be picked, else the pick.
  const previewCategory = d?.query ? highlighted : (chosen ?? suggested);

  // Keep the active group on screen and the keyboard in its category search.
  useEffect(() => {
    if (!current) return;
    rowRefs.current.get(current.key)?.scrollIntoView({ block: "nearest" });
    searchRef.current?.focus({ preventScroll: true });
  }, [current]);

  // Debounced rule preview: rows the rule would classify, and rows it would take from other rules.
  const pattern = d?.mode === "rule" ? d.pattern.trim() : "";
  const previewQuery = pattern ? `${pattern}\u0000${previewCategory?.id ?? ""}\u0000${d?.account_id ?? ""}` : "";
  useEffect(() => {
    if (!previewQuery) return;
    const [p, categoryId, accountId] = previewQuery.split("\u0000");
    const timer = setTimeout(() => {
      api
        .previewRule(p, categoryId ? Number(categoryId) : null, undefined, accountId || null)
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

  /** Pick a category without classing anything: « Valider » (or a second Enter) does it. */
  function choose(category: Category) {
    update({ chosen: category.id, query: "", highlight: 0 });
    searchRef.current?.focus({ preventScroll: true });
  }

  function submit(category: Category) {
    if (!groups || !current || !d || busy) return;
    if (d.mode === "rule" && !pattern) return;
    const path = shortPath(category);
    // A manual classification of some operations only (a lone one, « Classer seule », ticked ones):
    // the group stays active while it still has other operations.
    const partial = d.mode === "manual" && scope.length < current.count;
    const one = d.mode === "manual" && scope.length === 1 ? scope[0] : null;
    const split = one ? d.split : null;
    if (splitIncomplete(split)) return;
    const following = partial ? current.key : (groups[active + 1]?.key ?? null);
    return act(following, async () => {
      if (one) {
        await api.updateTransaction(one.id, {
          category_id: category.id,
          note: d.description.trim() || null,
          ...(split && { split_category_id: split.category_id, split_amount: splitAmount(split) }),
        });
        setDraft(null); // the group's remaining operations start from fresh defaults
        return {
          message: split ? `${classedMessage(1, path)} (scindée)` : classedMessage(1, path),
          key: current.key,
          // Clearing the category also drops the split and hands the operation back to the rules.
          undo: () => api.updateTransaction(one.id, { category_id: null, note: null }),
        };
      }
      if (d.mode === "manual") {
        const ids = scope.map((t) => t.id);
        await api.updateTransactions(ids, category.id, d.description.trim() || null);
        setDraft(null); // the picked category and ticks must not carry over to what is left
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
          is_income_anchor: false,
          description: d.description,
          account_id: d.account_id,
        }),
      );
      const after = await api.uncategorizedCount();
      setDraft(null);
      return {
        message:
          `Règle « ${pattern} » créée : ${classedMessage(before - after, path)}` +
          (rule.conflicts.length ? ` ⚠ ${conflictsMessage(rule.conflicts, pathOf)}` : ""),
        key: current.key,
        undo: () => api.deleteRule(rule.id),
      };
    });
  }

  /** Class a conflicted operation by hand; « Annuler » hands it back to the rules (a conflict again). */
  function classConflicted(tx: Transaction, category: Category) {
    if (busy) return;
    return act(current?.key ?? null, async () => {
      await api.updateTransaction(tx.id, { category_id: category.id });
      return {
        message: classedMessage(1, shortPath(category)),
        key: current?.key ?? "",
        undo: () => api.updateTransaction(tx.id, { category_id: null }),
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
    // The rule's account select keeps its own arrow keys.
    if (e.target instanceof HTMLSelectElement && e.key.startsWith("Arrow")) return;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        e.preventDefault();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        if (inSearch && d.query) update({ highlight: clamp(d.highlight + delta, 0, results.length - 1) });
        else setActive(clamp(active + delta, 0, groups.length - 1));
        return;
      }
      case "Enter":
        // In a text field only: Enter on a button or a checkbox keeps its own action.
        if (!(e.target instanceof HTMLInputElement && e.target.type === "text")) return;
        e.preventDefault();
        // Enter picks the highlighted result, else the suggestion; a second Enter validates the pick.
        if (d.query) {
          if (highlighted) choose(highlighted);
        } else if (chosen) submit(chosen);
        else if (suggested) choose(suggested);
        return;
      case "Escape":
        e.preventDefault();
        if (d.query) update({ query: "", highlight: 0 });
        else if (chosen) update({ chosen: null });
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
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-zinc-600">
            Trier par
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as GroupSort)}
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900"
            >
              <option value="amount">Montant</option>
              <option value="date">Date</option>
            </select>
          </label>
          <PeriodFilter withAll />
          <AccountSelect purpose="filter" value={account} onChange={setAccount} />
        </div>
      </div>

      <Shortcuts />

      {error && <p className="text-sm text-red-700">{error}</p>}

      {conflicts.length > 0 && (
        <RuleConflicts
          conflicts={conflicts}
          categories={categories}
          accounts={accounts}
          pathOf={pathOf}
          onClass={classConflicted}
        />
      )}

      {groups && groups.length === 0 && conflicts.length === 0 && (
        <p className="rounded-lg border border-zinc-200 bg-white px-3 py-6 text-center text-sm text-zinc-500">
          Aucune opération à classer{monthFilter || account ? " avec ces filtres" : ""}.
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
                      scope={scope}
                      categories={categories}
                      update={update}
                      searchRef={searchRef}
                      results={results}
                      suggested={suggested}
                      chosen={chosen}
                      pattern={pattern}
                      currentPreview={currentPreview}
                      pathOf={pathOf}
                      busy={busy}
                      onChoose={choose}
                      onSubmit={submit}
                    />
                    {g.count > 1 && (
                      <OperationsTable
                        transactions={g.transactions}
                        accounts={accounts}
                        selected={d.selected}
                        onToggle={toggle}
                        onToggleAll={toggleAll}
                        onTarget={target}
                        oldestFirst={oldestFirst}
                        onToggleOrder={() => setOldestFirst((v) => !v)}
                      />
                    )}
                    {g.transfer_candidates.length > 0 && (
                      <TransferCandidates group={g} accounts={accounts} busy={busy} onPair={pair} />
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
