# vitest sometimes fails every suite with « Cannot read properties of undefined (reading 'config') »

## Context

`npm test --prefix frontend` (vitest 5.0.2) sometimes ends with `Test Files 17 failed (17)`, `no tests`, and for each file `TypeError: Cannot read properties of undefined (reading 'config')` at the first `describe(...)` line, including files nobody touched (`accountColors.test.ts`). The next run of the same command passes (`17 passed`, 156 tests). Seen twice on 2026-11-17 on Windows, from the repository root, twice right after other work in the same session (a first run after a series of edits, and a run right after `npm run lint` + `tsc`); the `next dev` server was running during the second one. Cause not established: not reproduced on demand.

## To do / to investigate

- Find a trigger: run `npm test --prefix frontend` in a loop (with and without `next dev` running, with and without a previous lint or tsc) and note which runs fail.
- Check the vitest 5 changelog and issues for this message (a worker started before the config is loaded, the transform cache, `isolate`); try `vitest run --no-isolate` or `pool: "forks"` in a `vitest.config` if it points there.
- Until then, a failing run is re-run once; a failure that repeats is real.

## Progress

- 2026-11-18: root runs (`npm test --prefix frontend`) failed twice in a row, in two separate sequences (18 files each; one right after `npm run lint`, the other after lint, `npm run build` and the backend tests), and `npx vitest run` from `frontend/` passed at once each time (the first time only the guide heading test, expected, was red). So a repeated failure from the root is not always real: try the `frontend/` run before concluding.

- 2026-11-18: 4 failed runs out of 11 now, and every failure came right after a `tsc --noEmit` or `eslint` run in the same shell (the first runs of a new command chain); a run from `frontend/` (`npx vitest run`) right after a failure passed, then the root runs passed several times in a row. Lead: something the previous tool leaves (a lock, the `tsconfig.tsbuildinfo` or a cache under `node_modules`) breaks the first vitest start. Next try: run `tsc` then `npm test --prefix frontend` in a loop and see whether the failure repeats.

- 2026-11-17: noticed during a closeout; not investigated.
