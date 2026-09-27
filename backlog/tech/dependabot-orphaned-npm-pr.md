# Dependabot's npm PR sits on an orphaned history; its bumps are not on main

## Context

Dependabot opened Skyle-01/compta-maison#1 ("Bump the npm group in /frontend with 8 updates",
branch `dependabot/npm_and_yarn/frontend/npm-73822599aa`) on 2026-09-25, on top of a history whose
root is `85fc6ae` (2026-09-25). `main` was restarted again afterwards (root `c2223b8`, 2026-09-26),
so `git merge-base origin/main <that branch>` finds nothing: the PR can neither be merged nor
rebased, and none of its bumps are on `main`. It is the only remote branch with commits `main`
lacks (every `claude/*` branch is already in `main`).

What it bumps (`main` still has the "from" versions):

| Package | main | PR |
| --- | --- | --- |
| react, react-dom | 19.2.4 | 19.3.0 |
| @types/react, @types/react-dom | 19.2.17, 19.2.3 | 19.3.0 |
| recharts | ^3.8.1 | ^3.10.1 |
| eslint | ^9 | ^10 (major) |
| typescript | ^5 | ^7 (major) |
| @types/node | ^22 | ^26 (major) |

## To do / to investigate

- Close #1, or comment `@dependabot recreate` so it is regenerated on the current `main` (owner's
  call: it is an outward-facing action on the repo).
- Apply the minor bumps (react, react-dom and their types, recharts) on `main` with `npm install`,
  then the full check list; recharts drives the Reste sparkline, so look at it on the demo database
  at 1400 px.
- Take the majors one at a time: eslint 10 only if `eslint-config-next`'s peer range accepts it;
  typescript 7 only if `next build` type-checks with it. Keep `@types/node` on the Node major that
  CI (`node-version: 22`) and the README (Node.js 22.12+) use; a Dependabot `ignore` of
  `@types/node` semver-major updates in `.github/dependabot.yml` would stop it coming back.

## Progress

- 2026-09-27: found at session closeout (`git rev-list origin/main..<branch>` over the remote
  branches, then `git merge-base`); versions compared from both `frontend/package.json` and
  `frontend/package-lock.json`.
