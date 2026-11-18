# Missing boundary tests, weak assertions and a stale error banner

## Context

Found by the code review of 2026-11-18. Everything passes today (459 backend tests, 183 frontend tests), but these cases would let a regression through, plus one small UI bug and one documentation line to align.

**Boundaries and weak assertions (backend tests)**

- `test_periods.py:11-100`: the income-anchor threshold (`core/periods.py:12`, a credit on day >= 15 opens next month) is never tested on the 14th and the 15th; anchors sit on the 2nd and the 28th only. Changing it to `> 15` would pass.
- `test_transfers.py:59-65` (`test_outside_date_window_not_paired`): the legs are 10 days apart; the 3-day window (`core/transfers.py:12`, inclusive bisect) is never tested at its edge (3 days paired, 4 days not).
- `test_recurrences.py:129-152`: the thresholds (80 % of months with one occurrence, median gap 25-35 days, 35 % variable spread, tolerance max(2 %, 0.50 EUR)) are only tested far from their limits.
- `api/dashboard.py:90`: `savings_actual` is asserted nowhere (`test_api_categories.py:383` checks `savings_target` only); it must equal the Épargne card.
- `api/categories.py:95`: the 422 on a target under `Déficit` has no test (the word does not occur in `test_api_categories.py`).
- `test_config_export.py:93-98` (`test_leaves_other_config_files_alone`): the only assertion is status 200; compare the bytes of `bank_profiles.toml` and `settings.toml` before and after.
- `test_api_transactions.py:85-95` (`test_clear_manual_assignment_drops_note`): also assert that a matching rule takes the row back (`category_id` and `rule_id`), as its comment says.
- `test_api_transactions.py:112`: `salary["rule_id"] is not None` accepts any rule; compare with the expected rule's id.

**Stale error banner (frontend)**

`frontend/src/lib/useMonthDashboard.ts:23-28` sets `error` on a failed `api.dashboard` and never clears it on success, so « Le mois », Budget and Statistiques keep showing the notice after the backend came back and another month loaded fine. `frontend/src/app/transactions/page.tsx:41-44` has the same pattern (`setItems` without clearing `error`).

**Documentation line (owner decision 2026-11-18)**

`.claude/CLAUDE.md`, « Recurring flows »: "`fixed` = one run, or two runs (a step), plus an optional last isolated amount outside tolerance". The code (`core/recurrences.py:100-120`) accepts the optional isolated last amount only after **one** run; two runs plus an isolated last amount fall into `variable` and are dropped when too spread out (`[100,100,100,200,200,200,300]` returns `None`), and `test_recurrences.py:186` pins that. Keep the behaviour, change the sentence.

## To do / to investigate

- Add the missing boundary tests above (parametrise rather than copy: day 14 / 15, window 3 / 4 days, values just inside and just outside each recurrence threshold) and strengthen the three weak assertions. Each new test must fail against a deliberately shifted threshold (check once by hand, do not commit the shift).
- `useMonthDashboard`: `setError(null)` in the success branch (and when a new request starts, if the old data should not show with a stale notice); same in the Transactions page. A vitest test is only possible if the logic is extracted to a pure helper; the owner accepts untested UI components, so no extraction just for a test.
- Rewrite the CLAUDE.md sentence to match the code, for example "`fixed` = one run, or two runs (a step); after one run only, an optional last isolated amount outside tolerance is a candidate step (`price_change`)". Check `docs/guide.md` and `.claude/rules/frontend-pages.md` for the same wording.
- Not in this item: the vitest intermittent failure (`vitest-intermittent-config-error.md`), the minor findings of the review.
- Applies to the whole correction series (the four items): the existing em dashes and typographic apostrophes (U+2019) are only fixed on the lines a change touches, never in a sweep (owner decision 2026-11-18).

## Progress

- 2026-11-18: found by the code review; the recurrence sentence versus code mismatch was reproduced by running `_shape`, the stale banner read in the hook. Decisions recorded above. Nothing changed.
