## Description
Implements pending attendance and related API updates for HR attendance records, deduction/waiver handling, and report flow stabilization across UI, API, and database migration layers.

Closes #74

## Changes proposed

### What were you told to do?
Push all existing uncommitted work and create a PR for the branch changes.

### What did I do?
#### Attendance UI and Admin Flows
- Updated attendance pages in app and admin modules to support the new records workflow.
- Added a dedicated admin attendance records page and aligned employee view integrations.
- Updated help-desk page touchpoints impacted by shared attendance changes.

#### Attendance API and Automation
- Added admin attendance records API endpoints for list/detail operations.
- Added a cron endpoint to mark incomplete attendance records.
- Updated attendance report API behavior to align with the new utilities and data handling.

#### Shared Logic and Database
- Added `lib/hr/attendance-utils.ts` for reusable attendance logic.
- Added migration `20260514200000_attendance_deduction_and_waivers.sql`.
- Updated `vercel.json` to include routing/runtime support needed by the new endpoints.

## Check List (Check all the applicable boxes)
- [x] My code follows the code style of this project.
- [x] This PR does not contain plagiarized content.
- [x] The title and description of the PR is clear and explains the approach.
- [x] I am making a pull request against the main branch (left side).
- [x] My commit messages styles matches our requested structure.
- [x] My code additions will fail neither code linting checks nor unit test.
- [x] I am only making changes to files I was requested to.

## Screenshots / Testing Evidence
- Pre-push hook checks passed successfully:
  - `npm run lint:strict`
  - `npm run type-check`
  - `npm run build`
- Branch pushed successfully: `codex/hardening-prompt-implementation`.
