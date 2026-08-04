import assert from "node:assert/strict"
import test from "node:test"
import {
  canAccessAdminSection,
  expandDepartmentScopeForQuery,
  getDepartmentScope,
  isAdminLikeRole,
  normalizeDepartmentName,
  roleCanEnterAdmin,
  scopeDepartmentIds,
  type AdminScope,
} from "@/lib/admin/rbac"

function makeScope(overrides: Partial<AdminScope> = {}): AdminScope {
  return {
    userId: "user-1",
    role: "employee",
    department: "Accounts",
    departmentId: "dept-1",
    officeLocation: null,
    isDepartmentLead: false,
    leadDepartments: [],
    managedDepartments: [],
    managedDepartmentIds: [],
    managedOffices: [],
    isAdminLike: false,
    adminRoutes: null,
    scopeMode: "global",
    ...overrides,
  }
}

test("isAdminLikeRole recognizes admin-tier roles only", () => {
  assert.equal(isAdminLikeRole("developer"), true)
  assert.equal(isAdminLikeRole("super_admin"), true)
  assert.equal(isAdminLikeRole("admin"), true)
  assert.equal(isAdminLikeRole("employee"), false)
  assert.equal(isAdminLikeRole(null), false)
  assert.equal(isAdminLikeRole("Admin"), true) // case-insensitive
})

test("roleCanEnterAdmin excludes pure department leads", () => {
  assert.equal(roleCanEnterAdmin("admin"), true)
  assert.equal(roleCanEnterAdmin("developer"), true)
  assert.equal(roleCanEnterAdmin("employee", true), false) // lead flag is ignored
  assert.equal(roleCanEnterAdmin("employee", false), false)
})

test("canAccessAdminSection: dev section is developer-only", () => {
  assert.equal(canAccessAdminSection(makeScope({ role: "developer" }), "dev"), true)
  assert.equal(canAccessAdminSection(makeScope({ role: "super_admin" }), "dev"), false)
  assert.equal(canAccessAdminSection(makeScope({ role: "admin" }), "dev"), false)
})

test("canAccessAdminSection: route-limited admin only sees granted sections", () => {
  const scope = makeScope({ role: "admin", adminRoutes: ["finance.main"] })
  assert.equal(canAccessAdminSection(scope, "finance"), true)
  assert.equal(canAccessAdminSection(scope, "hr"), false)
  assert.equal(canAccessAdminSection(scope, "admin"), true) // dashboard always granted
})

test("canAccessAdminSection: pure employee (not admin-like, not lead) is denied", () => {
  const scope = makeScope({ role: "employee", isDepartmentLead: false })
  assert.equal(canAccessAdminSection(scope, "hr"), false)
})

test("scopeDepartmentIds prefers lead_departments over department", () => {
  const departmentIdsByName = new Map([
    ["Accounts", "dept-accounts"],
    ["IT and Communications", "dept-it"],
  ])
  const ids = scopeDepartmentIds(
    {
      role: "employee",
      department: "Accounts",
      department_id: "dept-own",
      office_location: null,
      admin_routes: null,
      is_department_lead: true,
      lead_departments: ["it"],
    },
    departmentIdsByName
  )
  // lead_departments ("it" -> "IT and Communications") wins, plus own department_id is always included
  assert.deepEqual(new Set(ids), new Set(["dept-it", "dept-own"]))
})

test("scopeDepartmentIds falls back to own department when no lead_departments", () => {
  const departmentIdsByName = new Map([["Accounts", "dept-accounts"]])
  const ids = scopeDepartmentIds(
    {
      role: "employee",
      department: "Accounts",
      department_id: "dept-accounts",
      office_location: null,
      admin_routes: null,
      is_department_lead: false,
      lead_departments: null,
    },
    departmentIdsByName
  )
  assert.deepEqual(ids, ["dept-accounts"])
})

test("getDepartmentScope: lead scope mode is always department-restricted", () => {
  const scope = makeScope({ scopeMode: "lead", managedDepartments: ["Accounts"] })
  assert.deepEqual(getDepartmentScope(scope, "finance"), ["Accounts"])
})

test("getDepartmentScope: developer/super_admin are unrestricted", () => {
  assert.equal(getDepartmentScope(makeScope({ role: "developer" }), "hr"), null)
  assert.equal(getDepartmentScope(makeScope({ role: "super_admin" }), "finance"), null)
})

test("getDepartmentScope: route-granted admin gets unrestricted access to that domain", () => {
  const scope = makeScope({ role: "admin", adminRoutes: ["hr.main"] })
  assert.equal(getDepartmentScope(scope, "hr"), null)
  assert.deepEqual(getDepartmentScope(scope, "finance"), [])
})

test("getDepartmentScope: non-lead employee gets no scope", () => {
  const scope = makeScope({ role: "employee", isDepartmentLead: false })
  assert.deepEqual(getDepartmentScope(scope, "general"), [])
})

test("expandDepartmentScopeForQuery expands legacy aliases", () => {
  const expanded = expandDepartmentScopeForQuery(["Accounts"])
  assert.ok(expanded.includes("Accounts"))
  assert.ok(expanded.includes("Finance")) // legacy alias for Accounts
})

test("normalizeDepartmentName maps legacy Finance label to Accounts", () => {
  assert.equal(normalizeDepartmentName("Finance"), "Accounts")
  assert.equal(normalizeDepartmentName("finance"), "Accounts")
})
