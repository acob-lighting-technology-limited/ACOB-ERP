# Migration ledger recovery

## `phantom-migration-rows-2026-08-08.json`

The 28 duplicate rows removed from `supabase_migrations.schema_migrations` on
2026-08-08, captured with their full `statements` array so they can be restored
verbatim if ever needed.

**Why they existed.** Applying a migration through the Supabase MCP
`apply_migration` tool records it under a *new* timestamp (the moment it ran)
rather than the migration file's own timestamp. Every one of these 28 had
already been recorded correctly by `supabase db push`, so the ledger held two
rows for the same migration — the real one, plus a duplicate whose `name` was
the literal filename.

`db push` reads the ledger, finds a version with no matching local file, and
refuses to run (`LegacyDbPushMissingLocalError`). That is what blocked pushes.

**Why deleting them was safe.** Verified before removal:
- 27 of 28 mapped to a local migration file by name.
- The objects those migrations create were confirmed present in production
  (attendance_appeals, network_activity_logs, known_devices,
  network_bandwidth_snapshots, rate_limit_counters, payroll_entries, the
  mac_address/user_agent columns, the profile_photos bucket).
- The 1 remaining (`auto_resolve_appeals`) has no local file because a later,
  tracked migration dropped it; the trigger was confirmed absent.

After removal the ledger and `supabase/migrations/` reconcile exactly.

## Avoiding a repeat

Apply schema changes with `supabase db push`, not the MCP `apply_migration`
tool. If MCP is used, the ledger will drift again in exactly this way.
