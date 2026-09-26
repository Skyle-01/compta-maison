# One helper for the signed transaction amount

## Context

`formatEuro(tx.credit > 0 ? tx.credit : -tx.debit)` with its green/red class is written five
times: `settings/page.tsx` defines `amountCell` but its own "Modifications manuelles" table doesn't
use it; the others are in `transactions/page.tsx` (table + selected summary) and `page.tsx`
(`TreeNode` drill-down).

## To do / to investigate

- Export one helper (the `amountCell` component, or a `signedAmount(tx)` value helper in
  `lib/api.ts`) and use it everywhere. Moving the colour from `<td>` to an inner `<span>` is
  visually identical.
- Plain DRY (~10 lines): skip if judged not worth it.

## Progress

- 2026-09-26: found in the stack review.
