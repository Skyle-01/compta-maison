# Settings errors are shown out of sight

## Context

`SettingsPage` (`frontend/src/app/settings/page.tsx`) renders its `error` banner once, at the top of
the page under the table of contents. Errors raised by actions further down (a rejected rule, a
failed rename, a note edit in « Modifications manuelles ») land there while the user is scrolled to
that section, so a failed action looks like it silently did nothing.

## To do / to investigate

- Show the error next to the section that raised it, or make the banner sticky / scroll it into
  view when it is set.
- `TransferMarkersSection` and `ManualTransfersSection` already show their own inline status; align
  the rest on that.

## Progress

- 2026-09-26: noted from the code while adding the Settings table of contents (not reproduced in
  the UI).
