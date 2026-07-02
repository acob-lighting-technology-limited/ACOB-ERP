/**
 * Backfill: sync employment_status into JWT metadata and kill active sessions
 * for all profiles whose status is NOT 'active' (exited, suspended, on_leave).
 *
 * This fixes the bug where the middleware fast-path reads stale 'active' from
 * JWT metadata even after the profile was exited/suspended in the DB.
 *
 * Run: npx tsx scripts/fix-stale-auth-status.ts
 * Dry run (no changes): npx tsx scripts/fix-stale-auth-status.ts --dry-run
 */
import { config } from "dotenv"
config({ path: ".env.local" })

import { createClient } from "@supabase/supabase-js"

const DRY_RUN = process.argv.includes("--dry-run")

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

async function main() {
  console.log(DRY_RUN ? "DRY RUN — no changes will be made\n" : "LIVE RUN — changes will be applied\n")

  // Fetch all non-active profiles
  const { data: profiles, error } = await admin
    .from("profiles")
    .select("id, full_name, company_email, employment_status")
    .not("employment_status", "eq", "active")
    .not("employment_status", "is", null)

  if (error) {
    console.error("Failed to fetch profiles:", error.message)
    process.exit(1)
  }

  if (!profiles || profiles.length === 0) {
    console.log("No non-active profiles found.")
    return
  }

  console.log(`Found ${profiles.length} non-active profile(s):\n`)

  let synced = 0
  let signedOut = 0
  let skipped = 0

  for (const profile of profiles) {
    const { id, full_name, company_email, employment_status } = profile
    console.log(`  ${full_name || "(no name)"} <${company_email}> — ${employment_status}`)

    if (DRY_RUN) {
      skipped++
      continue
    }

    // 1. Sync employment_status into JWT metadata
    const { error: metaError } = await admin.auth.admin.updateUserById(id, {
      user_metadata: { employment_status },
    })
    if (metaError) {
      console.error(`    ✗ metadata sync failed: ${metaError.message}`)
    } else {
      console.log(`    ✓ metadata synced`)
      synced++
    }

    // 2. Kill all active sessions via REST API (JS SDK signOut by userId not supported)
    if (employment_status === "exited" || employment_status === "suspended") {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
      const res = await fetch(`${url}/auth/v1/admin/users/${id}/logout?scope=global`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, apikey: key },
      })
      if (!res.ok) {
        const body = await res.text().catch(() => "")
        console.error(`    ✗ session kill failed (${res.status}): ${body}`)
      } else {
        console.log(`    ✓ sessions invalidated`)
        signedOut++
      }
    }
  }

  console.log(`\nDone.`)
  if (!DRY_RUN) {
    console.log(`  Metadata synced: ${synced}/${profiles.length}`)
    console.log(`  Sessions killed: ${signedOut}`)
  } else {
    console.log(`  Would process: ${profiles.length} profiles (re-run without --dry-run to apply)`)
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err)
  process.exit(1)
})
