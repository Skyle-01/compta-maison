# vitest sometimes fails every suite with « Cannot read properties of undefined (reading 'config') »

## Context

`npm test --prefix frontend` (vitest 5.0.2) sometimes ends with `Test Files 17 failed (17)`, `no tests`, and for each file `TypeError: Cannot read properties of undefined (reading 'config')` at the first `describe(...)` line, including files nobody touched (`accountColors.test.ts`). The next run of the same command passes (`17 passed`, 156 tests). Seen twice on 2026-11-17 on Windows, from the repository root, twice right after other work in the same session (a first run after a series of edits, and a run right after `npm run lint` + `tsc`); the `next dev` server was running during the second one. Cause not established: not reproduced on demand.

## To do / to investigate

- Find a trigger: run `npm test --prefix frontend` in a loop (with and without `next dev` running, with and without a previous lint or tsc) and note which runs fail.
- Check the vitest 5 changelog and issues for this message (a worker started before the config is loaded, the transform cache, `isolate`); try `vitest run --no-isolate` or `pool: "forks"` in a `vitest.config` if it points there.
- Until then, a failing run is re-run once; a failure that repeats is real.

## Progress

- 2026-11-17: noticed during a closeout; not investigated.
