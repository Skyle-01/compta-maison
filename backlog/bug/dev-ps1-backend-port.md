# dev.ps1 -BackendPort breaks the /api proxy

## Context

`dev.ps1` takes `[int]$BackendPort = 8000` and passes it to uvicorn only. The Next rewrite in
`frontend/next.config.ts` targets `process.env.BACKEND_URL ?? "http://localhost:8000"`, and nothing
sets `BACKEND_URL`. Any non-default port gives a backend the frontend cannot reach: two knobs for
one fact, not connected.

## To do / to investigate

- Simplest: drop the parameter and hardcode 8000 (the frontend already hardcodes 3000).
- If the knob is wanted: `$env:BACKEND_URL = "http://localhost:$BackendPort"` before starting npm
  (`Start-Process -NoNewWindow` inherits the environment).
- Check by running `./dev.ps1` on Windows (not testable in the Linux cloud sessions).

## Progress

- 2026-09-26: found in the stack review (static reading).
