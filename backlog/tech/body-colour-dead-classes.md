# Dead body colour classes and unused theme tokens

## Context

`frontend/src/app/layout.tsx` puts `bg-zinc-50 text-zinc-900` on `<body>`, but `globals.css` sets
`body { background: var(--background); color: var(--foreground) }` outside any layer. Tailwind v4
puts utilities in `@layer utilities`, and unlayered CSS always wins, so the classes never apply
(text is `#171717`) and editing them does nothing. `@theme inline` also defines
`--color-background` / `--color-foreground`, used by no `bg-background` / `text-foreground` class.

## To do / to investigate

- Delete `bg-zinc-50 text-zinc-900` from `<body>` and the two `--color-*` lines in `@theme inline`
  (rendering identical).
- Alternative (more Tailwind-idiomatic): keep the classes, delete the CSS rule and vars — text
  colour shifts slightly from #171717 to zinc-900.

## Progress

- 2026-09-26: found in the stack review (cosmetic-tier).
