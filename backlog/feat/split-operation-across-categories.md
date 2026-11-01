# Split one operation across two categories

## Context

An operation carries a single `category_id` today. A real purchase can belong to two categories (for example a supermarket receipt that mixes groceries and household goods), and the owner wants to split such an operation across 2 categories. The exact behaviour is to be specified later with the owner: nothing is decided yet.

Where it would touch the code, to keep in mind when specifying it:

- `transactions` holds one `category_id`, `category_manual` and `note` per row; `import_hash` is the stable key of a row, and the manual overrides survive a rebuild only through `overrides.csv` keyed on it (`.claude/rules/config-files.md`).
- Totals come from `debit_cents` / `credit_cents` and `kind`, summed per category in `core/categorize.py` (`category_tree`, `income_and_expenses`, `budget_status`, `category_averages`); the Sankey and the balance tree reconcile on these sums, so a split must keep Revenus - Dépenses - Épargne = Reste exact.
- Manual assignment goes through `PATCH /api/transactions/{id}` and the bulk PATCH, and `apply_rules` never touches a manual row.

## To do / to investigate

- Specify with the owner: how the split is entered (two amounts, or an amount and the remainder), whether it is limited to 2 parts, what happens to the note, and how the UI shows a split row in Transactions, « À classer » and the drill-downs.
- Decide the data shape (parts stored beside the row, or child rows) and its effect on `import_hash` dedup, the rebuild (`overrides.csv` format) and the transfer logic (a transfer leg should probably not be splittable).
- Check every aggregate above still reconciles, and add tests on the reconciliation.

## Progress

- 2026-11-02: item created from the owner's request, nothing specified or implemented yet.
