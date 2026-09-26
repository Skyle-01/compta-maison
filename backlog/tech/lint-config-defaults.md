# Remove lint config that restates the tools' defaults

## Context

- `frontend/eslint.config.mjs` has a `globalIgnores([".next/**", "out/**", "build/**",
  "next-env.d.ts"])` block (create-next-app boilerplate). eslint-config-next 16.3.6 already ends
  both its `core-web-vitals` and `typescript` configs with exactly that list
  (`dist/index.js`, `dist/typescript.js`).
- `backend/pyproject.toml` has `[tool.ruff.lint.isort] known-first-party = ["app", "scripts",
  "tests"]`; ruff resolves first-party modules from the project root (the dir holding
  `pyproject.toml`), where those packages live.

## To do / to investigate

- ESLint: `export default defineConfig([...nextVitals, ...nextTs]);`, drop the `globalIgnores`
  import.
- Delete `[tool.ruff.lint.isort]`.
- Check: `npm run lint --prefix frontend`, `ruff check backend` (from the root and from `backend/`).

## Progress

- 2026-09-26: verified in scratch: identical eslint output with lint-failing files planted in
  `.next/`, `out/`, `build/` (they do warn with `--no-ignore`); ruff incl. `I` passes from the
  root, from `backend/` and on single files.
