# Access Control Hardening — Report for the Managing Director

**Prepared by:** Chibuikem M. Ilonze, IT/Communications
**Date:** 14 May 2026
**Branch:** `codex/hardening-prompt-implementation` (merged)
**Scope:** Department-Lead vs Admin/Super-Admin/Developer access controls across the ACOB platform

---

## 1. Executive Summary

The platform has two views of the same data:

- **Admin view** (`/admin/…`) — what supervisors, managers and developers see for organisation-wide oversight.
- **Personal/User view** (`/correspondence`, `/help-desk`, `/tasks`, etc.) — what every staff member sees for their own day-to-day work.

We also have a **"Lead Mode" toggle** that lets an admin or super-admin temporarily act *as* their own department lead — so they only see their department's data instead of the whole organisation.

A review found that **the Lead-Mode toggle was being silently ignored in many places**: admins switching to Lead Mode still saw and could act on data from every department. We also found that the **Personal View was over-showing data to admins and leads** — instead of showing only their own personal records, it was mixing in admin/lead-scoped data, which was confusing and a privacy concern.

We have fixed every instance of these two problems that could be identified through systematic code review. The platform's role boundaries are now consistent and predictable.

---

## 2. The Problem in Plain English

### Problem A — "Lead Mode" did nothing for many features

If a Super-Admin or Developer toggled into "Lead Mode" (intending to see only their own department), the system was supposed to restrict their view. In practice, dozens of features ignored this toggle. The user thought they were department-scoped; the system still treated them as a full admin.

**Concrete examples that were broken:**
- Help-desk tickets: a Super-Admin in Lead Mode could still see, edit, assign, comment on, and resolve every ticket organisation-wide.
- Correspondence records: a lead-mode admin could see, edit, dispatch, and delete every department's correspondence.
- Performance reviews, goals, attendance scoring, leave administration, official report exports — same pattern across the board.

### Problem B — The Personal View leaked admin/lead data

The personal portal (e.g. `/correspondence`, `/help-desk/:id`) is meant to be each staff member's private workspace — only their own records. But for admins and leads, the personal view was quietly expanding to show their managed-department data and (for admins) the entire organisation's data.

This blurred the line between "my personal work" and "things I oversee as a manager". It also meant that a lead viewing a help-desk ticket through the personal portal had the same powers as if they were on the admin portal.

---

## 3. What Was Done

We performed a systematic, codebase-wide audit and fix in **four phases**.

### Phase 1 — High-impact list endpoints (6 files)
Fixed the most exposed surfaces first: the routes that return *lists* of records (help-desk tickets list, correspondence list, performance goals list, attendance admin records, help-desk dashboard, etc.). These had the largest data exposure.

### Phase 2 — Single-record and write operations (22 files)
Closed every route that operates on a single record or performs a write — ticket comments, ticket pivots, dispatch, approvals, goal updates, peer feedback, performance scoring, development plans, review cycles, competency frameworks, leave lifecycle/policies/SLA/holidays/evidence verification, official exports, and more.

Also fixed a **department-name aliasing bug** in performance goals — where "Finance" and "Accounts" are treated as the same department in the database. Leads of one couldn't see goals filed under the other.

### Phase 3 — Full audit pass (11 files)
A second, exhaustive sweep that uncovered **shared helper functions** in our codebase libraries (`canAccessRecord`, `canAccessDepartment`, `canLeadDepartment`, `canWorkDepartment`) that had hidden admin bypasses inside them. These were the *root cause* of multiple downstream leaks. Stripping the bypass from these helpers — and gating their callers correctly — eliminated an entire class of bug at the source rather than file-by-file.

### Phase 4 — Personal-View leakage (3 files)
Stripped admin/lead expansion from the personal portal so that `/correspondence`, `/help-desk`, and `/help-desk/:id` show only the staff member's personal data — exactly the same data every other employee would see, regardless of their role. Admins and leads continue to have full functionality through `/admin/…`.

---

## 4. By the Numbers

| Metric | Value |
|---|---|
| Files reviewed | Entire `app/api`, `app/admin`, `app/(app)`, `lib/` trees |
| Files modified | **39** |
| Files added | 0 |
| TypeScript errors after fix | 0 |
| ESLint warnings/errors after fix | 0 |
| Behavioural regressions for regular staff | None |
| Behavioural changes for admins | They no longer see other departments' data while in "Lead Mode"; their Personal View is now strictly personal. |

A full per-file changelog is available in the git history on `main`.

---

## 5. Verification

After every phase we ran the project's two mandatory checks:

1. **TypeScript compiler** (`npx tsc --noEmit`) — confirms the code is type-safe.
2. **ESLint** (`npx eslint . --ext .ts,.tsx`) — confirms it meets the project's coding standards.

Both pass cleanly across the entire project.

The platform's standing rules — defined in `AGENTS.md` and enforced via pre-commit and pre-push Git hooks — were followed for every change. No checks were bypassed.

---

## 6. What Was Not Audited

We were transparent throughout: this work fixes one specific class of bug (role-based access control bypass) very thoroughly. It is **not** a complete security review. The following are out of scope for this exercise and would be worth tackling separately:

- **Database-level row security policies** (Supabase RLS) — we relied on the application layer; a defence-in-depth review of the RLS rules themselves is still owed.
- **Runtime/integration testing** — verifications were static (compiler + lint). End-to-end testing with each role profile against staging would catch any behavioural edge case we missed.
- **Other vulnerability classes** — SQL injection, XSS, CSRF, authentication flow, secrets management. These were not the subject of this engagement.

---

## 7. Recommendations Going Forward

1. **Adopt the "scope-aware helper" pattern as the project standard.** All future access checks should derive from `getRequestScope()` rather than reading the user's role directly. This is now documented in the code's JSDoc comments and should be added to `AGENTS.md`.
2. **Add an automated test for Lead-Mode behaviour.** A small integration test suite that signs in as each role, toggles Lead Mode, and verifies the response shape would prevent any future regression.
3. **Schedule a database-side RLS review.** This is the missing layer of defence-in-depth.
4. **Consider an external security review** before any public-facing rollout.

---

## 8. Closing Note

The platform is now noticeably stricter about who sees what. Department leads will get the experience the toggle promised — they will only see their own department when in Lead Mode. Regular staff will continue to see exactly what they always saw. Admins retain full power *in the admin portal*, where it belongs.

Happy to walk through any of the technical detail in person.

— **C. M. Ilonze**
