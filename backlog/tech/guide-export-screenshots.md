# Retake the guide screenshots after the Export page

## Context

The Export page replaced the « Rapport PDF » link of « Le mois » (button « Exporter », entry « Export » in the Configurer group of the nav). `docs/guide.md` has a new « Export » section but no screenshot, and the existing images still show the old UI: `docs/img/dashboard.png` has the « Rapport PDF » button and every page image shows the nav without « Export ». The guide convention (`.claude/CLAUDE.md`, User guide) asks for screenshots from the demo data only, retaken when the UI changes.

## To do / to investigate

- Retake the images that show the nav or the changed button (at least `dashboard.png`; the others only differ by the nav entry, so retake all for consistency) on the demo DB (see Dev Workflow in `.claude/CLAUDE.md`, `ui-checks-headless-edge` memory for the headless Edge recipe).
- Add `docs/img/export.png` (months ticked, both panels visible) and reference it under « ## Export » in `docs/guide.md`.
- Optional: a screenshot of the mobile HTML page (390 px wide, `Page.captureScreenshot` on the downloaded file) next to the « Page web pour téléphone » bullet.

## Progress

- 2026-11-12: item created when the Export page and the mobile HTML export were added; the page was checked on the demo DB but no guide image was updated.
