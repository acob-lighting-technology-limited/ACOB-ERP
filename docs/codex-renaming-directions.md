# Codex Task: ERP Codebase Renaming & Structural Cleanup

## Context
This repository is named `ACOB-Signature-Creator` but it is a full ERP system
for ACOB Lighting. The repository name, several internal directory names, and
references to the old "signature creator" identity need to be corrected.
Additionally, there are orphaned routes outside the `(app)` layout group and
a legacy v1 API prefix that should be cleaned up.

Do not touch business logic. Do not refactor component internals. This task is
purely renaming, moving, and deleting.

---

## Task 1 — Migrate Orphaned Root Routes into the `(app)` Layout Group

### Problem
The following routes exist at the root of `app/` outside the `(app)/` group.
This means they do not share the authenticated layout (navbar, sidebar, auth
guard). Some were created before the `(app)` group existed and were never
migrated.

### Routes to migrate

| Current path | Target path | Action |
|---|---|---|
| `app/birthday/` | `app/(app)/birthday/` | Move (already exists there — check for conflicts first, delete the root one if identical) |
| `app/cbt/` | `app/(app)/cbt/` (or inside pms) | Move |
| `app/employee/` | `app/(app)/employee/` | Move — check if it duplicates `(app)/profile/` |
| `app/kss/` | Keep at root OR move to `app/(app)/kss/` | KSS is a presentation (public-facing). Check if it requires auth — if not, keep at root and document it as intentionally public |
| `app/lead/` | `app/(app)/lead/` | Move |
| `app/maintenance/` | `app/(app)/maintenance/` | Move |

### Steps
1. For each route above, read the page file and check if it calls `createClient()` or otherwise requires auth.
2. If it requires auth → move it into `app/(app)/`.
3. If it is intentionally public (like KSS presentation) → leave it at root and add a comment in `app/layout.tsx` noting it is intentionally outside the auth group.
4. After moving, check all `Link` and `redirect()` calls in the codebase that reference the old paths and update them.
5. Run `npm run lint` and `npm run type-check` after each move.

---

## Task 2 — Retire the Legacy `/api/v1/` Routes

### Problem
`app/api/v1/` contains routes that were created early in the project with an
arbitrary version prefix. There is no API versioning strategy, no consumers
that depend on this prefix, and new routes are added to `/api/` without any
prefix. The v1 prefix is misleading and creates two places to look for API
handlers.

### Steps
1. List every route under `app/api/v1/`.
2. For each route, grep the codebase for any `fetch("/api/v1/...`)` or
   `"/api/v1/"` string references.
3. If references exist: update them to point to the canonical `/api/` path,
   then delete the v1 route.
4. If no references exist: delete the v1 route directly.
5. After all v1 routes are removed, delete `app/api/v1/` entirely.
6. Run `npm run lint` and `npm run type-check`.

---

## Task 3 — Remove Non-Code Files From Repository Root

### Problem
The repository root contains documents, images, and temporary directories that
have no place in a code repository.

### Files/directories to remove from Git tracking

```
.claude copy/           ← duplicate of .claude config dir, accidental filesystem copy
tmp-action-points-docx/ ← temporary working directory
```

For `.docx`, `.xlsx`, and `.jpg` files at the root: check `git ls-files` to
confirm they are tracked. If tracked, remove them with `git rm --cached <file>`
(do not delete them from disk if they may be needed; just stop tracking them).
Then add the following lines to `.gitignore`:

```gitignore
# project documents — store in OneDrive/SharePoint, not the repo
*.docx
*.xlsx
*.jpg
*.jpeg
*.png
# (only at root level — use /*.docx if you want to scope to root only)
```

Note: if `.docx` files exist in `public/` or `templates/` as legitimate
static assets, do NOT add a blanket `*.docx` rule. Scope the gitignore
entries carefully (e.g., `/*.docx` for root-only).

### Steps
1. Run `git ls-files | grep -E "\.(docx|xlsx|jpg|jpeg|png)$"` to see what is tracked.
2. For each tracked file at the root level: run `git rm --cached <file>`.
3. Delete the `.claude copy/` directory entirely (`rm -rf ".claude copy/"`) and
   remove it from git tracking.
4. Delete `tmp-action-points-docx/` and remove from git tracking.
5. Update `.gitignore` with the appropriate rules.
6. Commit the cleanup: `chore: remove non-code files from repository root`.

---

## Task 4 — Rename the `temp_prod_base.sql` Migration File

### Problem
`supabase/migrations/temp_prod_base.sql` does not follow the timestamp naming
convention required by Supabase CLI. All migration files must be named
`YYYYMMDDHHMMSS_description.sql`. A file named `temp_*` will be skipped or
cause unexpected behavior.

### Steps
1. Read `supabase/migrations/temp_prod_base.sql`.
2. Determine from its content what it does and when it was approximately
   created (check `git log -- supabase/migrations/temp_prod_base.sql`).
3. Rename it to a proper timestamp name, e.g.,
   `20200101000001_prod_base.sql` (adjust the timestamp to slot correctly
   between existing migrations without conflicts).
4. Similarly audit `001_rbac_and_features.sql`, `002_task_assignments.sql`,
   `003_asset_department_assignment.sql`, `004_lead_permissions_fix.sql`,
   `005_fix_audit_logs_for_leads.sql`, `006_fix_audit_logs_empty_lead_departments.sql`.
   These use a `NNN_` numeric prefix instead of a timestamp. Use git log to
   determine their creation dates and rename them to `YYYYMMDDHHMMSS_*.sql`.
   Ensure the timestamps slot correctly relative to existing migrations.
5. After renaming, run `supabase db diff --local` to confirm Supabase still
   reads the migrations correctly with no errors.

---

## Task 5 — Standardize the `services/` vs `lib/` Split

### Problem
The project has both a `services/` directory and a `lib/` directory with no
documented rule for what belongs where. This causes random placement.

### Steps
1. Read every file in `services/`.
2. For each file, determine: does it contain data-fetching/API calls (→ should
   be in `lib/`) or true service-layer orchestration (→ keep in `services/`)?
3. Move any pure data-access helpers from `services/` into the appropriate
   `lib/` subdirectory.
4. If `services/` becomes empty, delete it.
5. Update `AGENTS.md` with a rule defining what belongs in `services/` vs `lib/`.
6. Run `npm run lint` and `npm run type-check`.

---

## Completion Checklist

After completing all tasks, verify:

- [ ] `npm run lint` passes (zero warnings)
- [ ] `npm run type-check` passes
- [ ] `npm run build` passes
- [ ] No `app/api/v1/` directory exists
- [ ] No files at `app/birthday/`, `app/cbt/`, `app/employee/`, `app/lead/`, `app/maintenance/` (unless intentionally public)
- [ ] `temp_prod_base.sql` and `00N_*.sql` files are renamed with timestamps
- [ ] `.claude copy/` and `tmp-action-points-docx/` are gone from the repository
- [ ] `.gitignore` covers `test-results/`, `.npm-cache/`
- [ ] `AGENTS.md` has a rule for `services/` vs `lib/`
- [ ] All internal path references updated to match moved routes

## Rules to Follow
- Do not modify any business logic, component internals, or API handler bodies.
- Do not add features. Rename, move, delete only.
- Commit each task separately with a descriptive `chore:` or `refactor:` message.
- Never use `git add -A` — stage files explicitly by name.
- Run lint and type-check after every task before committing.
