#!/usr/bin/env node
// Fails CI if the anon key can read/execute anything new in the DB.
// Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (server-side
// introspection via security_probe_anon_exposure(), see
// supabase/migrations/20260711121000_add_anon_exposure_probe_function.sql).

import fs from "node:fs"
import path from "node:path"
import { createClient } from "@supabase/supabase-js"

const root = process.cwd()

// Findings reviewed and confirmed intentional/low-risk on 2026-07-11.
// Any NEW finding_type+object_name pair not in this list fails the probe.
const ALLOWLIST = new Set([
  // Public website chatbot log ingestion; scoped to source='website' + user_id null.
  "permissive_policy:acobot_logs",
  // Year/anchor-day/lock flag only, no PII; needed for pre-auth date calculations.
  "permissive_policy:office_year_config",
  // Scoped to the single maintenance_mode key for the pre-auth middleware check.
  "permissive_policy:system_settings",
])

async function run() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment")
  }

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { params: { eventsPerSecond: 0 } },
  })

  const { data, error } = await db.rpc("security_probe_anon_exposure")
  if (error) {
    throw new Error(`security_probe_anon_exposure() failed: ${error.message}`)
  }

  const findings = data || []
  const newFindings = findings.filter((f) => !ALLOWLIST.has(`${f.finding_type}:${f.object_name}`))

  const reportLines = [
    "# Anon Security Probe Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    `Total findings: ${findings.length}`,
    `Allowlisted (known-intentional): ${findings.length - newFindings.length}`,
    `New/unreviewed: ${newFindings.length}`,
    "",
  ]

  if (findings.length > 0) {
    reportLines.push("## All findings", "")
    for (const f of findings) {
      const flag = ALLOWLIST.has(`${f.finding_type}:${f.object_name}`) ? "allowlisted" : "NEW"
      reportLines.push(`- [${flag}] **${f.finding_type}** \`${f.object_schema}.${f.object_name}\` — ${f.detail}`)
    }
    reportLines.push("")
  }

  const reportPath = path.join(root, "test-results", "anon-security-probe-report.md")
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, reportLines.join("\n"))

  if (newFindings.length > 0) {
    console.error(`✗ anon-security-probe: ${newFindings.length} new anon exposure(s) found:`)
    for (const f of newFindings) {
      console.error(`  - ${f.finding_type}: ${f.object_schema}.${f.object_name} — ${f.detail}`)
    }
    console.error(`\nFull report: ${reportPath}`)
    console.error(
      "\nIf this exposure is intentional, review it, then add `finding_type:object_name` to ALLOWLIST in scripts/anon-security-probe.mjs with a comment explaining why."
    )
    process.exitCode = 1
    return
  }

  console.log(`✓ anon-security-probe: clean (${findings.length} allowlisted, 0 new)`)
  console.log(`Report: ${reportPath}`)
}

run().catch((err) => {
  console.error("anon-security-probe crashed:", err)
  process.exitCode = 1
})
