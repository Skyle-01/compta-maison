# Transfer markers: a failed save looks like a neutral note

## Context

`TransferMarkersSection` (`frontend/src/app/settings/page.tsx`, « Virements internes ») puts both
outcomes of « Enregistrer » in one `status` string rendered next to the button in `text-xs
text-zinc-500`: the success message (« Enregistré — virements recalculés. ») and a failure
(`errorMessage(e)`, e.g. the backend down) look the same, grey and small. The other Settings
sections now show failures in a red `SectionError` banner.

## To do / to investigate

- Keep the success note inline, but show a failure in red: either `SectionError` under the
  section heading (like « Virements manuels ») or a red variant of the inline status.
- Check with a simulated failure (Playwright `page.route` on `PUT /api/transfer-markers`).

## Progress

- 2026-09-27: noticed while aligning the Settings sections' error display.
