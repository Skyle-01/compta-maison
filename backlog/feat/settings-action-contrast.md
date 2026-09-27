# Low-contrast actions in the Settings category and rule editors

## Context

The transaction lists' row actions were darkened to zinc-500/600 (WCAG AA), but the Settings
page's other editors still use `text-zinc-400` (2.6:1 on white) for their actions: the category
tree's `＋ ✎ ✕` buttons and "＋ objectif", the Règles table's `✎ ✕` and priority column, and the
"Annuler" buttons of the inline editors (`frontend/src/app/settings/page.tsx`, the category
tree `renderNode` and the Règles table in `SettingsPage`, plus the « Modifications manuelles »
note editor; `grep -n text-zinc-400` lists them). Easy to miss on a white card.

## To do / to investigate

- Darken the action buttons to `text-zinc-600` (hover unchanged), keep purely informative text
  (Σ targets, rule counts, "(par défaut)") at `zinc-500`.
- Check the result with a screenshot; keep the delete hover red.

## Progress

- 2026-09-26: noticed while checking the transaction-list contrast fix on the running app.
