import assert from "node:assert/strict"
import test from "node:test"
import { getScopedDepartments, getScopedDepartmentIds } from "@/lib/admin/api-scope"
import type { AdminScope } from "@/lib/admin/rbac"

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

test("getScopedDepartments: global admin-like scope sees everything", () => {
  const scope = makeScope({ isAdminLike: true, scopeMode: "global" })
  assert.equal(getScopedDepartments(scope), null)
})

test("getScopedDepartments: admin in lead mode is restricted like a lead", () => {
  const scope = makeScope({ isAdminLike: true, scopeMode: "lead", managedDepartments: ["Accounts"] })
  const result = getScopedDepartments(scope)
  assert.ok(Array.isArray(result))
  assert.ok(result!.includes("Accounts"))
})

test("getScopedDepartments: non-admin non-lead gets no access", () => {
  const scope = makeScope({ isAdminLike: false, isDepartmentLead: false })
  assert.deepEqual(getScopedDepartments(scope), [])
})

test("getScopedDepartments: lead with no managed departments gets no access", () => {
  const scope = makeScope({ isDepartmentLead: true, managedDepartments: [] })
  assert.deepEqual(getScopedDepartments(scope), [])
})

test("getScopedDepartments: lead's managed departments are alias-expanded", () => {
  const scope = makeScope({ isDepartmentLead: true, managedDepartments: ["Accounts"] })
  const result = getScopedDepartments(scope)
  assert.ok(result!.includes("Accounts"))
  assert.ok(result!.includes("Finance")) // legacy alias
})

test("getScopedDepartmentIds: global admin-like scope is unrestricted", () => {
  const scope = makeScope({ isAdminLike: true, scopeMode: "global" })
  assert.equal(getScopedDepartmentIds(scope), null)
})

test("getScopedDepartmentIds: lead gets their mapped department IDs only", () => {
  const scope = makeScope({ isDepartmentLead: true, managedDepartmentIds: ["dept-accounts"] })
  assert.deepEqual(getScopedDepartmentIds(scope), ["dept-accounts"])
})

test("getScopedDepartmentIds: non-admin non-lead gets no access", () => {
  const scope = makeScope({ isAdminLike: false, isDepartmentLead: false })
  assert.deepEqual(getScopedDepartmentIds(scope), [])
})
