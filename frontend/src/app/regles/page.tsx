"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AccountSelect from "@/components/AccountSelect";
import { ChangeNotices, UndoToast } from "@/components/ChangeNotices";
import CategoryPicker from "@/components/CategoryPicker";
import HelpLink from "@/components/HelpLink";
import RuleRow from "@/components/RuleRow";
import { api, errorMessage, type Category, type Rule, type RuleIssue, shortPath } from "@/lib/api";
import { movedMessage } from "@/lib/categoryTree";
import { type RuleForm, ruleFormToPayload } from "@/lib/ruleForm";
import {
  emptyFilters,
  filterRules,
  issueLabel,
  issueTooltip,
  narrowToPair,
  pairIds,
  pairLabel,
  PROBLEM_LABELS,
  type ProblemFilter,
  type RuleFilters,
  type RuleSort,
  SORT_LABELS,
  sortRules,
} from "@/lib/rules";
import { queryFromSearch } from "@/lib/triage";
import { useChanges } from "@/lib/useChanges";

const SELECT = "rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm";

export default function RulesPage() {
  // null until the first load ends, so the empty-state messages never show while loading.
  const [loaded, setLoaded] = useState<{ categories: Category[]; rules: Rule[] } | null>(null);
  const categories = loaded?.categories ?? [];
  const rules = loaded?.rules ?? [];
  const [issues, setIssues] = useState<Record<number, RuleIssue[]>>({});
  // Bumped after every reload so the open rules' operation lists refetch.
  const [version, setVersion] = useState(0);

  const [filters, setFilters] = useState<RuleFilters>(emptyFilters());
  const [sort, setSort] = useState<RuleSort>("pattern");
  // The rules of a badge's pair, shown alone to compare them (ignores the filters).
  const [pair, setPair] = useState<number[] | null>(null);
  const [openRules, setOpenRules] = useState<Set<number>>(new Set());

  const load = useCallback(
    () =>
      Promise.all([api.listCategories(), api.listRules(), api.ruleIssues()]).then(([cats, ruleList, found]) => {
        setLoaded({ categories: cats, rules: ruleList });
        setIssues(found);
        setVersion((v) => v + 1);
      }),
    [],
  );
  const { error, setError, warning, toast, run, act, undo, classAside, warnOfConflicts } = useChanges(
    load,
    categories,
  );

  useEffect(() => {
    load()
      .then(() => {
        // A link from Catégories (?q=<rule pattern>) opens the page on that search.
        const fromUrl = queryFromSearch(window.location.search);
        if (fromUrl) setFilters((f) => ({ ...f, query: fromUrl }));
      })
      .catch((e) => setError(errorMessage(e)));
  }, [load, setError]);

  const byId = new Map(categories.map((c) => [c.id, c]));
  const patternOf = (id: number) => rules.find((r) => r.id === id)?.pattern ?? `#${id}`;
  const shown = sortRules(
    pair ? narrowToPair(rules, pair) : filterRules(rules, categories, issues, filters),
    categories,
    sort,
  );
  const withProblem = rules.filter((r) => issues[r.id]?.length).length;
  const sortedCategories = [...categories].sort((a, b) => shortPath(a).localeCompare(shortPath(b), "fr"));

  const setFilter = <K extends keyof RuleFilters>(key: K, value: RuleFilters[K]) => {
    setPair(null);
    setFilters((f) => ({ ...f, [key]: value }));
  };

  function moveRule(rule: Rule, categoryId: number | null) {
    const target = categoryId != null ? byId.get(categoryId) : undefined;
    if (!target || target.id === rule.category_id) return;
    const from = rule.category_id;
    act(async () => {
      await api.moveToCategory(target.id, { rule_ids: [rule.id], transaction_ids: [] });
      return {
        message: movedMessage(1, 0, shortPath(target)),
        undo: () => api.moveToCategory(from, { rule_ids: [rule.id], transaction_ids: [] }),
      };
    });
  }

  async function updateRule(id: number, form: RuleForm) {
    if (form.category_id == null || !form.pattern.trim()) return false;
    return run(async () => warnOfConflicts(await api.updateRule(id, ruleFormToPayload(form))));
  }

  function deleteRule(rule: Rule) {
    if (confirm(`Supprimer la règle « ${rule.pattern} » ?`)) run(() => api.deleteRule(rule.id));
  }

  function toggleOpen(id: number) {
    setOpenRules((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** The category cell, the account and the problem badges of a rule's line. */
  function extra(rule: Rule) {
    return (
      <>
        <span className="shrink-0">
          <CategoryPicker categories={categories} value={rule.category_id} onChange={(id) => moveRule(rule, id)} />
        </span>
        {rule.account_id == null && (
          <span className="text-xs text-zinc-500" title="Règle de tous les comptes : une règle d'un compte l'emporte dessus">
            Tous
          </span>
        )}
        {(issues[rule.id] ?? []).map((issue, i) => {
          const text = issueLabel(issue) + (issue.kind === "conflict" || issue.kind === "shadowed" ? ` (${issue.count})` : "");
          const tone = issue.kind === "conflict" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-800";
          const title = issueTooltip(issue, patternOf);
          return issue.rule_ids.length > 0 ? (
            <button
              key={i}
              onClick={() => setPair(pairIds(rule.id, issue))}
              className={`whitespace-nowrap rounded px-1.5 text-xs hover:underline ${tone}`}
              title={`${title} Cliquer pour comparer les règles.`}
            >
              {text}
            </button>
          ) : (
            <span key={i} className={`whitespace-nowrap rounded px-1.5 text-xs ${tone}`} title={title}>
              {text}
            </span>
          );
        })}
      </>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">
        Règles
        <HelpLink page="/regles" />
      </h1>

      <p className="text-sm text-zinc-500">
        Une règle classe les opérations dont le libellé contient son motif. Une règle d&apos;un compte l&apos;emporte sur
        une règle de tous les comptes ; à un même niveau, deux règles de catégories différentes qui correspondent à la
        même opération font un conflit, et l&apos;opération reste à classer. Les règles se créent dans « À classer » ou
        sous une catégorie, dans Catégories.
      </p>

      <ChangeNotices error={error} warning={warning} onDismiss={() => setError(null)} />

      <div className="sticky top-0 z-10 -mx-6 flex flex-wrap items-center gap-3 border-b border-zinc-200 bg-zinc-50/95 px-6 py-2 backdrop-blur">
        <input
          value={filters.query}
          onChange={(e) => setFilter("query", e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setFilter("query", "")}
          placeholder="Rechercher un motif, une catégorie…"
          aria-label="Rechercher une règle"
          className="w-80 rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm"
        />
        <AccountSelect value={filters.account || null} onChange={(code) => setFilter("account", code ?? "")} purpose="filter" />
        <select
          value={filters.category ?? ""}
          onChange={(e) => setFilter("category", e.target.value ? Number(e.target.value) : null)}
          aria-label="Catégorie"
          className={SELECT}
        >
          <option value="">Toutes les catégories</option>
          {sortedCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {shortPath(c)}
            </option>
          ))}
        </select>
        <select
          value={filters.problem}
          onChange={(e) => setFilter("problem", e.target.value as ProblemFilter)}
          aria-label="Problème"
          className={SELECT}
        >
          <option value="">Avec ou sans problème</option>
          <option value="any">Avec problème</option>
          {Object.entries(PROBLEM_LABELS).map(([kind, label]) => (
            <option key={kind} value={kind}>
              {label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-zinc-600">
          Trier par
          <select value={sort} onChange={(e) => setSort(e.target.value as RuleSort)} className={SELECT}>
            {Object.entries(SORT_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {pair && (
        <p className="flex items-center gap-2 text-sm text-zinc-700">
          Comparaison :
          <span className="flex items-center gap-2 rounded-full border border-zinc-300 bg-white px-3 py-0.5">
            {pairLabel(rules, pair)}
            <button
              onClick={() => setPair(null)}
              className="text-zinc-600 hover:text-zinc-900"
              title="Revenir à la liste"
              aria-label="Revenir à la liste"
            >
              ✕
            </button>
          </span>
        </p>
      )}

      <p className="text-xs text-zinc-500">
        {shown.length} règle{shown.length > 1 ? "s" : ""} affichée{shown.length > 1 ? "s" : ""} sur {rules.length}
        {withProblem > 0 && `, ${withProblem} avec un problème`}. Les nombres d&apos;opérations portent sur tous les mois.
      </p>

      <div className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 bg-white text-sm">
        {loaded === null && !error ? (
          <p className="px-3 py-2 text-zinc-500">Chargement…</p>
        ) : rules.length === 0 ? (
          <p className="px-3 py-2 text-zinc-500">
            Aucune règle pour l&apos;instant. Créez-en depuis{" "}
            <Link href="/a-classer" className="underline hover:text-zinc-900">
              À classer
            </Link>
            .
          </p>
        ) : shown.length === 0 ? (
          <p className="px-3 py-2 text-zinc-500">Rien ne correspond.</p>
        ) : (
          shown.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              categories={categories}
              open={openRules.has(rule.id)}
              version={version}
              onToggleOpen={() => toggleOpen(rule.id)}
              onSave={(form) => updateRule(rule.id, form)}
              onDelete={() => deleteRule(rule)}
              onClassAside={classAside}
              extra={extra(rule)}
            />
          ))
        )}
      </div>

      <UndoToast toast={toast} undo={undo} />
    </div>
  );
}
