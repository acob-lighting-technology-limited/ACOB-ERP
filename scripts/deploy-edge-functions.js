#!/usr/bin/env node
// Deploy edge functions by reading local files and uploading via Supabase Management API.
// Usage: SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/deploy-edge-functions.js

const fs = require("fs")
const path = require("path")

const PROJECT_REF = "itqegqxeqkeogwrvlzlj"

// Try multiple sources for the token
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_TOKEN

if (!ACCESS_TOKEN) {
  console.error("❌ Missing access token. Set SUPABASE_ACCESS_TOKEN or SUPABASE_TOKEN env var.")
  console.error("   Usage: SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/deploy-edge-functions.js")
  process.exit(1)
}

async function deployFunction(slug) {
  const filePath = path.resolve(__dirname, "..", "supabase", "functions", slug, "index.ts")
  const content = fs.readFileSync(filePath, "utf8")

  console.log("\n─────────────────────────────────────")
  console.log("Deploying:", slug)
  console.log("File:", filePath)
  console.log("Content length:", content.length, "chars")

  // Sanity check: count unescaped vs escaped template literals
  const hasEscaped = content.includes("\\${")
  console.log("Has escaped \\${:", hasEscaped, "(should be false)")

  const body = JSON.stringify({
    slug,
    name: slug,
    verify_jwt: true,
    entrypoint_path: "index.ts",
    import_map: false,
    files: [{ name: "index.ts", content }],
  })

  // Try PATCH first (update existing), fall back to POST (create new)
  let res = await fetch("https://api.supabase.com/v1/projects/" + PROJECT_REF + "/functions/" + slug, {
    method: "PATCH",
    headers: {
      Authorization: "Bearer " + ACCESS_TOKEN,
      "Content-Type": "application/json",
    },
    body,
  })

  if (res.status === 404) {
    console.log("Function not found, creating...")
    res = await fetch("https://api.supabase.com/v1/projects/" + PROJECT_REF + "/functions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + ACCESS_TOKEN,
        "Content-Type": "application/json",
      },
      body,
    })
  }

  const text = await res.text()
  if (res.ok) {
    const data = JSON.parse(text)
    console.log("✅ Deployed successfully! Version:", data.version)
  } else {
    console.error("❌ Failed! Status:", res.status)
    console.error("Response:", text)
  }
  return res.status
}

async function main() {
  const functions = [
    "send-email-notification",
    "send-weekly-report",
    "send-meeting-reminder",
    "send-attendance-daily-report",
    "sync-meeting-artifacts"
  ]

  for (const fn of functions) {
    await deployFunction(fn)
  }

  console.log("\n✅ Done!")
}

main().catch(console.error)
