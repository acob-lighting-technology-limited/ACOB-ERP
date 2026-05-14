/**
 * Adds rateLimit() calls to all mutation route handlers that are missing them.
 * Run with: node scripts/add-rate-limits.mjs
 */

import { readFileSync, writeFileSync } from "fs"
import { join } from "path"

const ROOT = process.cwd()

// All 77 files confirmed missing rate limiting
const FILES = [
  "app/api/admin/assets/types/route.ts",
  "app/api/admin/create-user/route.ts",
  "app/api/admin/dev/impersonation/route.ts",
  "app/api/admin/employees/export/route.ts",
  "app/api/admin/hr/employees/[id]/email/route.ts",
  "app/api/admin/hr/fleet/bookings/[id]/review/route.ts",
  "app/api/admin/hr/fleet/resources/route.ts",
  "app/api/admin/import-csv/route.ts",
  "app/api/admin/maintenance/cleanup-idempotency/route.ts",
  "app/api/admin/reject-user/route.ts",
  "app/api/admin/scope-mode/route.ts",
  "app/api/admin/settings/mail/route.ts",
  "app/api/admin/users/role/route.ts",
  "app/api/auth/create-profile/route.ts",
  "app/api/correspondence/department-codes/route.ts",
  "app/api/correspondence/records/route.ts",
  "app/api/correspondence/records/[id]/approvals/route.ts",
  "app/api/correspondence/records/[id]/dispatch/route.ts",
  "app/api/correspondence/records/[id]/documents/route.ts",
  "app/api/correspondence/records/[id]/route.ts",
  "app/api/departments/route.ts",
  "app/api/departments/[id]/route.ts",
  "app/api/dev/flow-tests/route.ts",
  "app/api/dev/leave-flow-test/route.ts",
  "app/api/dev/login-log/route.ts",
  "app/api/dev/maintenance/route.ts",
  "app/api/fleet/bookings/route.ts",
  "app/api/fleet/bookings/[id]/cancel/route.ts",
  "app/api/help-desk/tickets/route.ts",
  "app/api/help-desk/tickets/[id]/approvals/route.ts",
  "app/api/help-desk/tickets/[id]/assign/route.ts",
  "app/api/help-desk/tickets/[id]/comments/route.ts",
  "app/api/help-desk/tickets/[id]/pivot/route.ts",
  "app/api/help-desk/tickets/[id]/route.ts",
  "app/api/hr/attendance/admin-records/route.ts",
  "app/api/hr/attendance/clock-out/route.ts",
  "app/api/hr/leave/evidence/route.ts",
  "app/api/hr/leave/evidence/upload/route.ts",
  "app/api/hr/leave/evidence/verify/route.ts",
  "app/api/hr/leave/flow/route.ts",
  "app/api/hr/leave/holidays/route.ts",
  "app/api/hr/leave/lifecycle/route.ts",
  "app/api/hr/leave/policies/route.ts",
  "app/api/hr/leave/requests/route.ts",
  "app/api/hr/leave/sla/reminders/route.ts",
  "app/api/hr/leave/sla/route.ts",
  "app/api/hr/performance/cbt/questions/route.ts",
  "app/api/hr/performance/cbt/questions/[id]/route.ts",
  "app/api/hr/performance/cbt/route.ts",
  "app/api/hr/performance/cbt/session/route.ts",
  "app/api/hr/performance/competencies/route.ts",
  "app/api/hr/performance/cycles/route.ts",
  "app/api/hr/performance/development-plans/actions/route.ts",
  "app/api/hr/performance/development-plans/route.ts",
  "app/api/hr/performance/goals/route.ts",
  "app/api/hr/performance/goals/[id]/tasks/route.ts",
  "app/api/hr/performance/peer-feedback/route.ts",
  "app/api/hr/performance/reviews/route.ts",
  "app/api/onedrive/route.ts",
  "app/api/payments/categories/route.ts",
  "app/api/payments/categories/[id]/route.ts",
  "app/api/payments/[id]/documents/route.ts",
  "app/api/payments/[id]/route.ts",
  "app/api/profile/update/route.ts",
  "app/api/reports/action-points-export/route.ts",
  "app/api/reports/action-tracker/carry-forward/route.ts",
  "app/api/reports/action-tracker/route.ts",
  "app/api/reports/action-tracker/[id]/route.ts",
  "app/api/reports/kss-results/route.ts",
  "app/api/reports/kss-roster/route.ts",
  "app/api/reports/meeting-date/route.ts",
  "app/api/reports/meeting-week-documents/route.ts",
  "app/api/reports/office-year-config/route.ts",
  "app/api/reports/official-exports/route.ts",
  "app/api/reports/weekly-report-export/route.ts",
  "app/api/reports/weekly-reports/route.ts",
  "app/api/settings/notifications/route.ts",
]

// Rate limit values by route pattern
function getRateLimit(filePath) {
  if (filePath.includes("impersonation")) return { limit: 5, windowSec: 60 }
  if (filePath.includes("import-csv")) return { limit: 5, windowSec: 60 }
  if (filePath.includes("export")) return { limit: 10, windowSec: 60 }
  if (filePath.includes("create-profile")) return { limit: 10, windowSec: 60 }
  if (filePath.includes("hr/leave")) return { limit: 15, windowSec: 60 }
  if (filePath.includes("hr/attendance")) return { limit: 10, windowSec: 60 }
  if (filePath.includes("fleet")) return { limit: 15, windowSec: 60 }
  if (filePath.includes("profile/update")) return { limit: 10, windowSec: 60 }
  if (filePath.includes("settings")) return { limit: 15, windowSec: 60 }
  if (filePath.includes("dev/")) return { limit: 10, windowSec: 60 }
  if (filePath.includes("admin/")) return { limit: 30, windowSec: 60 }
  return { limit: 20, windowSec: 60 }
}

// Derive a short key prefix from the file path
function getKeyPrefix(filePath) {
  return filePath
    .replace("app/api/", "")
    .replace(/\/\[id\]/g, "")
    .replace(/\/route\.ts$/, "")
    .replace(/\//g, "-")
    .replace(/\[|\]/g, "")
    .substring(0, 40)
}

// The import line we want to inject
const IMPORT_LINE = `import { getClientId, rateLimit } from "@/lib/rate-limit"`

// Rate limit block for handlers that have a request param
function rateLimitBlock(keyPrefix, limit, windowSec, reqVar = "request") {
  return [
    `  const rl = await rateLimit(\`${keyPrefix}:\${getClientId(${reqVar})}\`, { limit: ${limit}, windowSec: ${windowSec} })`,
    `  if (!rl.allowed) return NextResponse.json({ error: "Too many requests. Please try again later.", code: "RATE_LIMITED" }, { status: 429 })`,
  ].join("\n")
}

// Rate limit block for handlers with NO request param (cron/internal routes)
function rateLimitBlockStatic(keyPrefix, limit, windowSec) {
  return [
    `  const rl = await rateLimit("${keyPrefix}", { limit: ${limit}, windowSec: ${windowSec} })`,
    `  if (!rl.allowed) return NextResponse.json({ error: "Too many requests. Please try again later.", code: "RATE_LIMITED" }, { status: 429 })`,
  ].join("\n")
}

// Match mutation handler signatures
// Groups: [1]=method, [2]=full param list
const HANDLER_RE = /^export async function (POST|PATCH|PUT|DELETE)\s*\(([^)]*)\)/m

// Find all mutation handlers in a file and their positions
function findHandlers(src) {
  const handlers = []
  // Find each export async function with mutation method
  const lines = src.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const m = line.match(/^export async function (POST|PATCH|PUT|DELETE)\s*\(/)
    if (m) {
      handlers.push({ method: m[1], lineIndex: i, line })
    }
  }
  return handlers
}

// Extract the request variable name from a handler signature line
// e.g. "export async function POST(request: NextRequest)" → "request"
// e.g. "export async function POST(req: NextRequest)" → "req"
// e.g. "export async function POST(_request: Request)" → "_request" (we'll also note it needs renaming)
// e.g. "export async function POST(_: Request," → "_" (no request)
// e.g. "export async function POST()" → null (no request)
function extractReqVar(handlerLine) {
  // Match first param before comma or closing paren
  const m = handlerLine.match(/\(\s*([^,):]+)/)
  if (!m) return null
  const param = m[1].trim()
  // param might be "request: NextRequest" or "_request: Request" or "_: Request" or "_"
  const varName = param.split(":")[0].trim()
  if (!varName || varName === "") return null
  return varName
}

function processFile(filePath) {
  const abs = join(ROOT, filePath)
  let src

  try {
    src = readFileSync(abs, "utf-8")
  } catch {
    console.error(`  ✗ Cannot read: ${filePath}`)
    return false
  }

  // Skip if already has rateLimit
  if (src.includes("rateLimit(")) {
    console.log(`  ✓ Already has rateLimit: ${filePath}`)
    return false
  }

  const { limit, windowSec } = getRateLimit(filePath)
  const keyPrefix = getKeyPrefix(filePath)
  let modified = src

  // ── Step 1: Add import if missing ──────────────────────────────────────────
  if (!modified.includes("from \"@/lib/rate-limit\"") && !modified.includes("from '@/lib/rate-limit'")) {
    // Find last import line
    const importLines = modified.split("\n")
    let lastImportIdx = -1
    for (let i = 0; i < importLines.length; i++) {
      if (importLines[i].startsWith("import ")) lastImportIdx = i
    }
    if (lastImportIdx >= 0) {
      importLines.splice(lastImportIdx + 1, 0, IMPORT_LINE)
      modified = importLines.join("\n")
    } else {
      // No imports found — prepend
      modified = IMPORT_LINE + "\n" + modified
    }
  }

  // ── Step 2: Insert rate limit block into each mutation handler ─────────────
  const lines = modified.split("\n")
  const handlers = findHandlers(modified)

  if (handlers.length === 0) {
    console.warn(`  ⚠ No mutation handlers found: ${filePath}`)
    return false
  }

  // Process handlers in reverse order so line indices stay valid
  const toInsert = []

  for (const handler of handlers) {
    const reqVar = extractReqVar(handler.line)
    const isNoRequest = !reqVar || reqVar === "_" || reqVar === ""

    // Find the opening brace of this handler (same line or next line)
    let braceLineIdx = handler.lineIndex
    // The handler might span multiple lines if signature wraps
    // Find the line with the opening { for the function body
    for (let i = handler.lineIndex; i < Math.min(handler.lineIndex + 5, lines.length); i++) {
      if (lines[i].includes("{")) {
        braceLineIdx = i
        break
      }
    }

    // Insert point: right after the opening brace line
    const insertIdx = braceLineIdx + 1

    // Skip any "const params = await props.params" line immediately after
    let actualInsertIdx = insertIdx
    for (let i = insertIdx; i < Math.min(insertIdx + 3, lines.length); i++) {
      if (lines[i].trim().startsWith("const params = await props.params")) {
        actualInsertIdx = i + 1
        break
      }
    }

    let block
    if (isNoRequest) {
      block = rateLimitBlockStatic(keyPrefix, limit, windowSec)
    } else {
      // Use actual var name (even _request — it will still work since we just call getClientId on it)
      const actualVar = reqVar.startsWith("_") && reqVar !== "_" ? reqVar : reqVar
      block = rateLimitBlock(keyPrefix, limit, windowSec, actualVar)
    }

    toInsert.push({ idx: actualInsertIdx, block })
  }

  // Insert in reverse order
  toInsert.sort((a, b) => b.idx - a.idx)
  for (const { idx, block } of toInsert) {
    lines.splice(idx, 0, block)
  }

  modified = lines.join("\n")

  writeFileSync(abs, modified, "utf-8")
  console.log(`  ✓ Patched (${handlers.length} handler${handlers.length > 1 ? "s" : ""}): ${filePath}`)
  return true
}

// ── Main ───────────────────────────────────────────────────────────────────────
let patched = 0
let skipped = 0

for (const f of FILES) {
  const result = processFile(f)
  if (result) patched++
  else skipped++
}

console.log(`\nDone. Patched: ${patched}, Skipped (already had rateLimit): ${skipped}`)
console.log("\nVerification command:")
console.log(`while IFS= read -r f; do grep -q "rateLimit" "$f" || echo "STILL MISSING: $f"; done < <(grep -rl "export async function POST\\|export async function PATCH\\|export async function PUT\\|export async function DELETE" app/api --include="*.ts")`)
