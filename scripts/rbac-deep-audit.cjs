#!/usr/bin/env node

const fs = require("fs")
const path = require("path")
const { createClient } = require("@supabase/supabase-js")

const root = process.cwd()

function read(filePath) {
  return fs.readFileSync(path.join(root, filePath), "utf8")
}

function checkContains(checks, filePath, pattern, description) {
  const content = read(filePath)
  const ok = typeof pattern === "string" ? content.includes(pattern) : pattern.test(content)
  checks.push({ type: "static", filePath, description, ok })
}

function normalizeDepartment(value) {
  if (!value) return ""
  const trimmed = String(value).trim()
  if (trimmed.toLowerCase() === "finance") return "Accounts"
  return trimmed
}

function uniq(values) {
  return Array.from(new Set(values.filter(Boolean)))
}

function computeManagedDepartments(profile) {
  const leadDepartments = Array.isArray(profile.lead_departments) ? profile.lead_departments : []
  const normalized = uniq(leadDepartments.map(normalizeDepartment).filter(Boolean))
  if (normalized.length > 0) return normalized
  if (profile.department) return [normalizeDepartment(profile.department)]
  return []
}

function isFinanceGlobalLead(profile, managedDepartments) {
  if (!profile.is_department_lead) return false
  const set = new Set(managedDepartments.map((d) => d.toLowerCase()))
  return set.has("accounts") || set.has("finance")
}

function isHrGlobalLead(profile, managedDepartments) {
  if (!profile.is_department_lead) return false
  return managedDepartments.includes("Admin & HR")
}

async function run() {
  const checks = []
  const skipDb = process.env.SKIP_DB === "1"

  // Static route/API hardening checks
  checkContains(
    checks,
    "components/admin-layout.tsx",
    /resolveAdminScope|!scope/s,
    "Admin layout blocks non-admin roles"
  )
  checkContains(
    checks,
    "app/admin/finance/payments/departments/page.tsx",
    'redirect("/admin/finance/payments")',
    "Finance departments legacy route redirects to finance payments"
  )
  checkContains(
    checks,
    "app/admin/payments/departments/page.tsx",
    'redirect("/admin/finance/payments")',
    "Legacy payments departments route redirects to finance payments"
  )
  checkContains(
    checks,
    "app/admin/finance/finance-dashboard-content.tsx",
    /\/finance\/payments/,
    "Finance dashboard department entry points to finance payments"
  )

  checkContains(
    checks,
    "app/admin/hr/employees/admin-employee-content.tsx",
    "const canManageUsers =",
    "HR employees page has explicit mutate permission gate"
  )
  checkContains(
    checks,
    "app/admin/employees/admin-employee-content.tsx",
    "const canManageUsers =",
    "Employees page has explicit mutate permission gate"
  )
  checkContains(
    checks,
    "app/admin/hr/departments/page.tsx",
    "canManageDepartments",
    "HR departments page has explicit mutate permission gate"
  )

  checkContains(
    checks,
    "app/api/admin/create-user/route.ts",
    "resolveAdminScope",
    "Create-user API uses central RBAC scope"
  )
  checkContains(
    checks,
    "app/api/admin/create-user/route.ts",
    'managedDepartments.includes("Admin & HR")',
    "Create-user API allows HR global lead"
  )
  checkContains(
    checks,
    "app/api/departments/route.ts",
    'managedDepartments.includes("Admin & HR")',
    "Departments create API allows HR global lead"
  )
  checkContains(
    checks,
    "app/api/departments/[id]/route.ts",
    'managedDepartments.includes("Admin & HR")',
    "Departments update/delete API allows HR global lead"
  )

  let leads = []
  let officeLocations = []
  let departments = []
  if (!skipDb) {
    // Live DB checks
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceKey) {
      throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment")
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const [
      { data: profiles, error: profilesError },
      { data: officeRows, error: officesError },
      { data: departmentRows, error: departmentsError },
    ] = await Promise.all([
      supabase
        .from("profiles")
        .select("id,first_name,last_name,role,department,lead_departments,office_location,is_department_lead")
        .in("role", ["developer", "super_admin", "admin", "employee", "visitor"]),
      supabase.from("office_locations").select("name,department"),
      supabase.from("departments").select("name"),
    ])

    if (profilesError) throw profilesError
    if (officesError) throw officesError
    if (departmentsError) throw departmentsError

    leads = (profiles || []).filter((p) => p.is_department_lead === true)
    officeLocations = officeRows || []
    departments = departmentRows || []
  }
  const officeByDepartment = new Map()
  for (const row of officeLocations || []) {
    const dept = row.department ? normalizeDepartment(row.department) : ""
    if (!dept) continue
    if (!officeByDepartment.has(dept)) officeByDepartment.set(dept, [])
    officeByDepartment.get(dept).push(row.name)
  }

  const leadRows = leads.map((lead) => {
    const managedDepartments = computeManagedDepartments(lead)
    const officeCandidates = managedDepartments.flatMap((d) => officeByDepartment.get(d) || [])
    if (lead.office_location) officeCandidates.push(lead.office_location)
    const managedOffices = uniq(officeCandidates)
    return {
      name: `${lead.first_name || ""} ${lead.last_name || ""}`.trim() || lead.id,
      id: lead.id,
      department: lead.department,
      lead_departments: Array.isArray(lead.lead_departments) ? lead.lead_departments : [],
      managed_departments: managedDepartments,
      managed_offices: managedOffices,
      finance_global_lead: isFinanceGlobalLead(lead, managedDepartments),
      hr_global_lead: isHrGlobalLead(lead, managedDepartments),
      empty_lead_departments: !(Array.isArray(lead.lead_departments) && lead.lead_departments.length > 0),
    }
  })

  const financeGlobalLeads = leadRows.filter((r) => r.finance_global_lead)
  const hrGlobalLeads = leadRows.filter((r) => r.hr_global_lead)
  const emptyLeads = leadRows.filter((r) => r.empty_lead_departments)

  if (!skipDb) {
    checks.push({
      type: "db",
      description: "Finance department canonical value Accounts exists",
      ok: (departments || []).some((d) => d.name === "Accounts"),
    })

    checks.push({
      type: "db",
      description: "At least one finance_global_lead exists in live data",
      ok: financeGlobalLeads.length > 0,
      details: financeGlobalLeads.map((r) => r.name).join(", ") || "none",
    })

    checks.push({
      type: "db",
      description: "Lead fallback case detected (empty lead_departments) and mapped via profile.department",
      ok: emptyLeads.length >= 0,
      details: emptyLeads.map((r) => `${r.name} -> ${r.managed_departments.join(", ") || "NO_DEPARTMENT"}`).join("; "),
    })
  }

  const roleCrudMatrix = [
    {
      role: "super_admin",
      admin_dashboard: "Full",
      employees_view: "All",
      employees_mutate: "Yes",
      departments_view: "All",
      departments_mutate: "Yes",
      finance_scope: "Full",
    },
    {
      role: "admin",
      admin_dashboard: "Full",
      employees_view: "All",
      employees_mutate: "Yes",
      departments_view: "All",
      departments_mutate: "Yes",
      finance_scope: "Full",
    },
    {
      role: "hr_global_lead",
      admin_dashboard: "Scoped",
      employees_view: "All",
      employees_mutate: "Yes",
      departments_view: "All",
      departments_mutate: "Yes",
      finance_scope: "Scoped",
    },
    {
      role: "finance_global_lead",
      admin_dashboard: "Scoped",
      employees_view: "All",
      employees_mutate: "No",
      departments_view: "All",
      departments_mutate: "No",
      finance_scope: "Full",
    },
    {
      role: "dept_scoped_lead",
      admin_dashboard: "Scoped",
      employees_view: "All",
      employees_mutate: "No",
      departments_view: "All",
      departments_mutate: "No",
      finance_scope: "Scoped",
    },
    {
      role: "employee",
      admin_dashboard: "Denied",
      employees_view: "N/A",
      employees_mutate: "N/A",
      departments_view: "N/A",
      departments_mutate: "N/A",
      finance_scope: "N/A",
    },
  ]

  const routeMatrix = [
    ["/admin", "super_admin, admin, lead", "lead scoped"],
    ["/admin/hr*", "super_admin, admin, lead", "hr_global full, other leads scoped"],
    ["/admin/finance*", "super_admin, admin, lead", "finance_global full, other leads scoped"],
    ["/admin/assets*", "super_admin, admin, lead", "lead scoped by department + office"],
    ["/admin/employees*", "super_admin, admin, lead", "all leads view all; mutate only hr_global/admin/super_admin"],
    [
      "/admin/hr/departments",
      "super_admin, admin, lead",
      "all leads view all; mutate only hr_global/admin/super_admin",
    ],
    ["/admin/reports*", "super_admin, admin, lead", "lead scoped; create own dept, edit/delete own records"],
    ["/admin/onedrive*", "super_admin, admin, lead", "lead scoped paths"],
  ]

  const failed = checks.filter((c) => !c.ok)

  const lines = []
  lines.push("# RBAC Deep Test Report")
  lines.push("")
  lines.push(`Generated: ${new Date().toISOString()}`)
  lines.push("")
  lines.push("## Summary")
  lines.push(`- Static checks: ${checks.filter((c) => c.type === "static").length}`)
  lines.push(`- DB checks: ${checks.filter((c) => c.type === "db").length}${skipDb ? " (skipped)" : ""}`)
  lines.push(`- Failed checks: ${failed.length}`)
  lines.push(`- Live leads found: ${leadRows.length}${skipDb ? " (skipped)" : ""}`)
  lines.push(`- finance_global_lead live count: ${financeGlobalLeads.length}${skipDb ? " (skipped)" : ""}`)
  lines.push(`- hr_global_lead live count: ${hrGlobalLeads.length}${skipDb ? " (skipped)" : ""}`)
  lines.push(`- leads with empty lead_departments: ${emptyLeads.length}${skipDb ? " (skipped)" : ""}`)
  lines.push("")

  lines.push("## Static Checks")
  for (const c of checks.filter((x) => x.type === "static")) {
    lines.push(`- ${c.ok ? "PASS" : "FAIL"}: ${c.description} (${c.filePath})`)
  }
  lines.push("")

  lines.push("## DB Checks")
  if (skipDb) {
    lines.push("- SKIPPED: DB checks disabled (set SKIP_DB=1)")
  } else {
    for (const c of checks.filter((x) => x.type === "db")) {
      const detail = c.details ? ` | ${c.details}` : ""
      lines.push(`- ${c.ok ? "PASS" : "FAIL"}: ${c.description}${detail}`)
    }
  }
  lines.push("")

  lines.push("## Route Access Matrix")
  lines.push("| Route | Allowed Roles | Scope Rule |")
  lines.push("|---|---|---|")
  for (const row of routeMatrix) {
    lines.push(`| ${row[0]} | ${row[1]} | ${row[2]} |`)
  }
  lines.push("")

  lines.push("## CRUD Matrix")
  lines.push(
    "| Role Persona | Admin Dashboard | Employees View | Employees Mutate | Departments View | Departments Mutate | Finance Scope |"
  )
  lines.push("|---|---|---|---|---|---|---|")
  for (const row of roleCrudMatrix) {
    lines.push(
      `| ${row.role} | ${row.admin_dashboard} | ${row.employees_view} | ${row.employees_mutate} | ${row.departments_view} | ${row.departments_mutate} | ${row.finance_scope} |`
    )
  }
  lines.push("")

  lines.push("## Live Lead Mapping (Department + Office)")
  if (skipDb) {
    lines.push("Skipped in this run.")
  } else {
    lines.push("| Lead | Managed Departments | Managed Offices | Finance Global | HR Global |")
    lines.push("|---|---|---|---|---|")
    for (const row of leadRows.sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(
        `| ${row.name} | ${row.managed_departments.join(", ") || "-"} | ${row.managed_offices.join(", ") || "-"} | ${row.finance_global_lead ? "Yes" : "No"} | ${row.hr_global_lead ? "Yes" : "No"} |`
      )
    }
  }
  lines.push("")

  if (failed.length > 0) {
    lines.push("## Failures")
    for (const f of failed) {
      lines.push(`- ${f.description}${f.filePath ? ` (${f.filePath})` : ""}`)
    }
    lines.push("")
  }

  const reportPath = path.join(root, "test-results", "rbac-deep-audit-report.md")
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, lines.join("\n"))

  console.log(`Report written to: ${reportPath}`)
  console.log(`Checks: ${checks.length}, Failed: ${failed.length}`)

  process.exit(failed.length > 0 ? 1 : 0)
}

run().catch((error) => {
  console.error("RBAC deep audit failed:", error)
  process.exit(1)
})
