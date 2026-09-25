# Backlog

One Markdown file per item, in `bug/`, `feat/` or `tech/`. No ids and no priority order: pick
whichever item you like.

- `bug/`: something behaves wrongly.
- `feat/`: something new the app should do.
- `tech/`: code health, tooling, docs, repo hygiene.

An item is a working document. It gives the context and everything needed to fix or investigate
it, and collects progress notes while the work goes on. When the item is done, delete its file in
the commit that finishes it; git history keeps it.

## Template

```markdown
# What, in a few words

## Context

What happens today, why it matters, where it lives in the code.

## To do / to investigate

What a fix or an investigation needs: leads, constraints, open questions.

## Progress

- YYYY-MM-DD: what was done or learned.
```
