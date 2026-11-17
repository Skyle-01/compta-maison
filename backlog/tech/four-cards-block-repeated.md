# The Revenus / Dépenses / Épargne / Reste block is written out on three screens

## Context

The four reconciling cards are spelled out by hand, each time with the same labels, the same "higher is better" flags and the same colour rules (Revenus green, Dépenses red, Épargne violet or amber when negative, Reste green or red by sign):

- `app/page.tsx`: `Stat` x 4, with a delta against the previous month.
- `app/rapport/page.tsx`: `ReportStat` x 4, with the average and the gap.
- `components/AveragesSection.tsx`: `AverageStat` x 4, the average first and the month below.

Three card components (`Stat`, `ReportStat`, `AverageStat`) differ only by their sub-line. The « Un mois moyen » section of the report added a fourth copy (`lib/report.ts::reportCards` gives it label, value and tone, without the "higher is better" flag; extend it here), and the mobile report has a fifth in string form (`equationRow`).

## To do / to investigate

- One pure helper (in `lib/`) giving the four cards from a totals object: label, value, goodIsUp, tone. Each screen keeps its own sub-line.
- Then see whether one card component with a `children` sub-line can replace the three; do not force it if the paddings and sizes of the print sheet and the screen really differ.
- Overlaps with the cards list proposed in `backlog/tech/report-renderers-shared-code.md`: one helper should serve both.

## Progress

- 2026-11-12: noticed while reading the pages for the report specs.
