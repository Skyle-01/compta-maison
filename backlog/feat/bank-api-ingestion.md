# Fetch statements from a bank API

## Context

Statements are downloaded by hand as CSV, then dropped in `_inputs/` or uploaded. Aggregators such as
Powens (formerly Budget Insight) expose account data through an API.

## To do / to investigate

- Backburner: the app is local-only, and an aggregator means an account with them, tokens to store,
  and bank data sent to a third party.
- API rows must not duplicate CSV rows: an API label rarely equals the CSV label, so neither
  `import_hash` nor the account-level dedup in `import_transactions` would match them. Decide on one
  source per account, or on a matching rule, first.
