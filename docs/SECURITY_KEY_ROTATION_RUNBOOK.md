# Runbook: Rotate leaked production `service_role` key

**Severity: Critical.** The production `service_role` JWT (full RLS bypass, exp 2077)
was committed to the repo (`supabase/migrations/20260518130000_fix_digest_schedules_auth.sql`)
and embedded as a fallback in two live DB functions (`process_notification_queue`,
`process_digest_schedules`). It is in git history permanently and must be rotated.

The code fixes are already staged (see "What's already done"). The rotation itself
is a coordinated ~30-min maintenance window because rolling the key breaks every
consumer of the old key until they pick up the new one.

## What's already done (staged in repo, not yet applied/deployed)

- Working-tree literal scrubbed from `20260518130000_fix_digest_schedules_auth.sql`
  (now reads the key from Vault; history still contains it — hence rotation).
- Forward migration `20260709122000_secrets_vault_only.sql` recreates both cron
  functions to source the key **only** from `vault.decrypted_secrets` (name
  `service_role_key`), fail safe if absent, and drops the redundant hardcoded
  `x-webhook-secret` header (auth is the service-role bearer they already send).
- `send-email-notification` edge fn hardened to accept only the service-role
  bearer or the `WEBHOOK_SECRET` env value (removed the leaked
  `DB_TRIGGER_SECRET` / `LEGACY_TRIGGER_SECRET` static fallbacks).

Live cron jobs affected: `process-notifications-every-minute` (every 1 min),
`process-digest-schedules` (every 15 min). Both send the service-role bearer.
`process_notification_batch` is legacy/unscheduled — ignore.

## Rotation sequence (do in one sitting)

1. **Roll the key.** Supabase Dashboard → Project Settings → API → roll the
   `service_role` secret (and JWT secret if offered). This invalidates the leaked key.
2. **Store the new key in Vault.**
   ```sql
   select vault.create_secret('<NEW_SERVICE_ROLE_KEY>', 'service_role_key');
   -- or update if the secret name already exists:
   -- select vault.update_secret('<id>', '<NEW_SERVICE_ROLE_KEY>');
   ```
3. **Update env everywhere the old key was used:**
   - Vercel: `SUPABASE_SERVICE_ROLE_KEY` → new value → redeploy.
   - Edge function secrets: `SUPABASE_SERVICE_ROLE_KEY`, and set a fresh
     `WEBHOOK_SECRET` (a new random value, not the old static one).
4. **Apply the forward migration** `20260709122000_secrets_vault_only.sql`.
5. **Deploy edge functions** (`send-email-notification` at minimum).
6. **Smoke-test:**
   - Trigger a notification (e.g. assign an asset / create a notification row) →
     confirm the recipient gets the email and an in-app notification.
   - Wait for / manually run `select public.process_notification_queue();` and
     `select public.process_digest_schedules();` → check `cron.job_run_details`
     and edge logs for 200s, no `[AUTH FAIL]`.
   - Confirm the OLD key is rejected: call the REST API with the old
     `service_role` key and expect 401.

## Follow-up hardening (separate)

- Scrub the (public, lower-severity) anon-key literals from the ~15 migration
  files that embed them; prefer `current_setting()` / Vault reads.
- Delete the malformed non-timestamped `supabase/migrations/_fix_queue_secret.sql`
  (superseded; also hardcodes the old webhook secret literal).
- Consider git history scrub (BFG / filter-repo) if the repo is ever shared
  externally — rotation makes the leaked key useless, but scrubbing removes it.
