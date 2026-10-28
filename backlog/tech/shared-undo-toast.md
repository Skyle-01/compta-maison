# One undo toast for « À classer » and Catégories

## Context

`app/a-classer/page.tsx` and `app/categories/page.tsx` each carry their own copy of the « Annuler » toast: the `Toast` type, `UNDO_DELAY_MS = 8000`, the `useEffect` that clears it after 8 s, an `undo()` that clears the toast, reverts, calls `notifyUncategorizedChanged()` and reloads, the Alt+Z handling, and the same fixed bottom-right JSX block (`fixed bottom-6 right-6 ...`). The two differ in small ways: « À classer » toasts carry a `key` (the group to re-activate after the revert) and wire Alt+Z in the page's `onKeyDown`, Catégories listens on `window`.

## To do / to investigate

- A `useUndoToast` hook (state, 8 s timer, `undo`) plus an `UndoToast` component for the JSX; the page-specific part (what to reload, which group to re-activate) stays in a callback.
- The manual check of the Catégories undo (move of rules with « Annuler », « Classer à part ») was done on 2026-10-28, so that flow is no longer a blocker; re-check it by hand after the refactor.
- Gain is small (about 15 shared lines per page); do it only if a third page needs an undo.

## Progress

- 2026-10-28: found while looking for duplication between pages; nothing changed. The Catégories undo flow was validated by hand the same day.
