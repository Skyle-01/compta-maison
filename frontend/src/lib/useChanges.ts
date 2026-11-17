"use client";

import { useCallback, useEffect, useState } from "react";
import { errorMessage, notifyUncategorizedChanged, type Category, type Rule, shortPath } from "./api";
import { conflictsMessage } from "./triage";

const UNDO_DELAY_MS = 8000;

/** The last change's confirmation; `undo` reverts it. */
export type Toast = { message: string; undo: () => Promise<unknown> };

/** The change flow shared by the Catégories and Règles pages: run an API change, reload the page's
 *  data, show the error or the conflict warning, and offer « Annuler » (the toast for 8 s, or Alt+Z)
 *  for the changes that can be reverted. `load` refetches the page's data. */
export function useChanges(load: () => Promise<unknown>, categories: Category[]) {
  const [error, setError] = useState<string | null>(null);
  // Conflicts the last saved rule created (a warning, the rule is saved anyway).
  const [warning, setWarning] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), UNDO_DELAY_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  /** Run a change, then reload; false (and the message shown) when it failed. */
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setError(null);
    setWarning(null);
    try {
      await action();
      // Rule and category changes, and clearing a manual assignment, move the « À classer » count.
      notifyUncategorizedChanged();
      await load();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
  }

  /** A change that « Annuler » (the toast, or Alt+Z) can revert. */
  async function act(perform: () => Promise<Toast>): Promise<boolean> {
    let next: Toast | null = null;
    const ok = await run(async () => {
      next = await perform();
    });
    if (ok) setToast(next);
    return ok;
  }

  const undo = useCallback(async () => {
    if (!toast) return;
    setToast(null);
    setError(null);
    try {
      await toast.undo();
      notifyUncategorizedChanged();
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [toast, load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.code === "KeyZ") {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  function warnOfConflicts(rule: Rule) {
    if (!rule.conflicts.length) return;
    const pathOf = (id: number) => {
      const c = categories.find((x) => x.id === id);
      return c ? shortPath(c) : `#${id}`;
    };
    setWarning(
      `Règle « ${rule.pattern} » enregistrée, mais ${conflictsMessage(rule.conflicts, pathOf)} : ces opérations restent sans catégorie, à classer dans « À classer ».`,
    );
  }

  return { error, setError, warning, toast, run, act, undo, warnOfConflicts };
}
