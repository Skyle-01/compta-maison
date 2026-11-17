# Two report helpers carry a parameter no code uses

## Context

- `lib/report.ts::reportMonth(available, requested)`: the only caller (`lib/reportRequest.ts::parseReportRequest`) passes `null`; the `requested` branch is exercised by `report.test.ts` only.
- `lib/report.ts::statementMonths(available, month, count = STATEMENT_MONTHS)`: `count` is passed by the test only.

## To do / to investigate

- Drop both parameters and the test cases that only cover them: `reportMonth(available)` returns the latest complete month, `statementMonths` always uses `STATEMENT_MONTHS`.
- `statementMonths` now serves `components/StatementSection.tsx` (Statistiques); only its `count` parameter is unused.

## Progress

- 2026-11-12: noticed while reading the report code.
