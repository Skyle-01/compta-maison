# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A household's bookkeeper (the owner, solo developer and sole user of the app) who uploads French bank CSVs, reviews categorised transactions and reads a monthly dashboard on a desktop browser. Shared reports are read by a second audience: the partner or a close relative of the household, on a smartphone, who does not know the app or its vocabulary (Reste, paycheck-anchored months, transfers) and wants to know where the household stands this month.

## Product Purpose

Household accounting that tracks flows only (never balances): auto-categorise bank rows with substring rules, review what is left, explore a month on a dashboard, and export it as a printable PDF report and as a self-contained mobile HTML report (the Export page). Success for the shared report: the reader knows within 10 seconds whether money is left this month, without opening the app.

## Operating Context

Desktop-only app (checked at about 1400 px), French UI, light theme only, FastAPI backend + Next.js 16 / Tailwind frontend, one local SQLite DB, no hosting and no accounts. A report leaves the machine as a file (PDF through the browser's print dialog, HTML as a download sent by mail or messaging), so it must work offline and without the app.

## Capabilities and Constraints

- Report data comes from `GET /api/dashboard` and `GET /api/dashboard/averages`; the report is frontend-only, no PDF library.
- Revenus and Dépenses are shown net of refunds in the report, Reste always equals Revenus - Dépenses - Épargne.
- Budget months run from one paycheck to the next, not calendar months.
- Shared files contain real finances: operation-level detail is opt-in, off by default.
- User-facing text is French with ASCII apostrophes; amounts via fr-FR formatting; contrast rules in `.claude/rules/frontend-pages.md`.
- The mobile HTML report is a single file: inline CSS, inline SVG, a few lines of JS at most, no network request.

## Product Principles

- Plain words first: a reader outside the app understands every label and the lead sentence.
- Flows, never balances: no figure implies an account balance.
- Numbers reconcile: every table adds up to its total, the total to the Reste.
- Share the minimum by default: detail the reader did not ask for stays out of the file.

## Accessibility & Inclusion

Text contrast at WCAG AA (never zinc-300/400 for readable text, green-700/red-700 for signed amounts); the shared report must stay readable on a small phone screen without zooming.
