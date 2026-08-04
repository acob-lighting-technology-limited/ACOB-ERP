# Teams Meeting Artifact Sync

Automatically pulls **attendance reports** and **transcripts** for a specific
Teams meeting, stores them as history under **Reports → General Meeting**, and
emails them to a configurable recipient list. Runs on a schedule and only acts
on the meeting's actual date (read from the ERP meeting-date config).

## Where it lives in the app

| Page | Path |
|---|---|
| Meeting Records — Attendance / Transcript tabs (read-only) | `/admin/reports/general-meeting/records` |
| Sync config (pick meeting, recipients, on/off) | **Meeting Sync** button (modal) on the Records page |

## How it works

1. `pg_cron` (`sync-meeting-artifacts`, weekday afternoons UTC) pokes the
   `sync-meeting-artifacts` edge function.
2. The function self-gates: it only proceeds when today (Africa/Lagos) equals
   the ERP effective meeting date for the current office week
   (`weekly_report_effective_meeting_date`). Off-days are cheap no-ops.
3. For each **active** row in `meeting_artifact_sources` it resolves the Teams
   online meeting from the stored join URL, then pulls attendance reports and
   transcripts via Microsoft Graph.
4. Each artifact is deduped against `meeting_artifact_ledger` (so it is imported
   and emailed exactly once), stored in `meeting_week_documents` under its own
   office week, and — when email is enabled — sent to the recipients with a
   matching in-app notification.

Manual **Sync now** (button on the config page) calls the function with
`{ force: true }`, bypassing the meeting-day gate for testing.

## One-time Azure setup (admin required)

The sync reuses the existing Azure app registration (same `AZURE_*` creds as the
OneDrive integration). It needs three **application** Graph permissions plus a
Teams application access policy.

### 1. Add application permissions + admin consent

In Azure Portal → App registrations → *(the ACOB app)* → API permissions → Add a
permission → Microsoft Graph → **Application permissions**:

- `OnlineMeetingArtifact.Read.All`
- `OnlineMeetingTranscript.Read.All`
- `Calendars.Read`

Then click **Grant admin consent**.

### 2. Scope the app to the organizer mailbox (Teams access policy)

Application permissions are tenant-wide by default. Restrict the app so it can
only read the organizer's meetings. Run in **Teams PowerShell**
(`Connect-MicrosoftTeams`):

```powershell
# Replace <APP_CLIENT_ID> with the Azure app registration (client) id.
New-CsApplicationAccessPolicy `
  -Identity "ACOB-Meeting-Artifacts" `
  -AppIds "<APP_CLIENT_ID>" `
  -Description "Read attendance/transcripts for meeting artifact sync"

# Grant the policy to the meeting organizer only.
Grant-CsApplicationAccessPolicy `
  -PolicyName "ACOB-Meeting-Artifacts" `
  -Identity "ict@acoblighting.com"
```

Policy propagation can take up to ~30 minutes.

> `Calendars.Read` is scoped separately via Exchange. To limit calendar reads to
> the same mailbox, apply an Exchange **application access policy**
> (`New-ApplicationAccessPolicy -AccessRight RestrictAccess`) targeting a
> mail-enabled security group that contains only `ict@acoblighting.com`.

## Edge function secrets

Set on the `sync-meeting-artifacts` function (Supabase → Edge Functions →
Secrets), reusing the existing values:

```
AZURE_TENANT_ID
AZURE_CLIENT_ID
AZURE_CLIENT_SECRET
RESEND_API_KEY
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

## Deploy

```bash
# Apply the migration (creates tables, doc types, cron job).
supabase db push

# Deploy the edge function.
supabase functions deploy sync-meeting-artifacts
```

## Configure a meeting

1. Open **Reports → General Meeting → Meeting Sync (Teams)**.
2. **Add meeting** → enter the organizer email (`ict@acoblighting.com`) →
   **Load meetings** → pick the meeting from the dropdown.
3. Add recipient emails, leave **Active** and **Send emails** on, save.
4. Click **Sync now** to verify (needs a past occurrence with artifacts ready).

## Notes / limits

- Graph cannot list all meetings, so the picker reads the organizer's calendar
  (last 90 / next 30 days) and dedupes by join URL. Recurring series share one
  join URL, so any occurrence works.
- Attendance is stored **native CSV**. Transcripts are pulled from Graph as
  WebVTT (the only format the API exposes) and converted to a readable
  **DOCX** (speaker + text) before storage.
- Artifacts settle a few minutes (attendance) to ~1 hour (transcript) after a
  meeting ends — the afternoon cron window covers this; reruns are no-ops.
- Edge functions are excluded from `tsc`/`eslint`; smoke-test on deploy.
