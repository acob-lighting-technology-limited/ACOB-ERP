# Claude Code Rules — ACOB Platform

All engineering standards and UI patterns for this codebase are defined in
**`AGENTS.md`** at the project root. That file is the single source of truth
shared across all AI agents (Claude, Codex, Cursor, etc.).

Read `AGENTS.md` fully before starting any task. Every rule there is mandatory.

The most critical section for day-to-day work is:

> **Table Page Standard** — every list/data page must use `DataTablePage` +
> `DataTable` from `@/components/ui/data-table`. See `AGENTS.md` for the
> full layout order, feature checklist, column/filter API, and hard prohibitions.

## Never run `npm run build`

Do **not** run `npm run build` to check your work. It takes ~3 minutes, and the
dev server is usually running — the build competes with it for `.next/` and
disrupts what the user is doing.

The pre-push hook (`.husky/pre-push`) runs `lint:strict` and `type-check` only —
**not** `build` (removed in `2c38430b`). Nothing builds locally or in CI; Vercel
is the only place `next build` runs. Do not claim a push will build the project.

To verify a change, use the fast checks:

```bash
npx tsc --noEmit -p tsconfig.json     # types
npx eslint <changed files>            # lint
npm run test:admin-scope              # or the relevant test script
```

The only exception is debugging a failure that *only* reproduces in a
production build — and then say why before running it.
