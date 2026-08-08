import assert from "node:assert/strict"
import test from "node:test"
import { getScopedDepartments, getScopedDepartmentIds, readDeptContextId } from "@/lib/admin/api-scope"
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

// ─── readDeptContextId ───────────────────────────────────────────────────────
// Determines whether an API call is being made from inside the /dept/[id]/
// console, which narrows scope to that single department. Getting this wrong
// either leaks other departments' data or wrongly restricts /admin pages.

const ORIGIN = "https://matrix.acoblighting.com"

test("readDeptContextId: explicit header wins", () => {
  const h = new Headers({ "x-dept-context": "dept-accounts" })
  assert.equal(readDeptContextId(h), "dept-accounts")
})

test("readDeptContextId: explicit header is trusted even on a document navigation", () => {
  const h = new Headers({ "x-dept-context": "dept-accounts", "sec-fetch-dest": "document" })
  assert.equal(readDeptContextId(h), "dept-accounts")
})

test("readDeptContextId: falls back to Referer for plain XHR", () => {
  const h = new Headers({ referer: `${ORIGIN}/dept/dept-accounts/hr/pms/behaviour`, "sec-fetch-dest": "empty" })
  assert.equal(readDeptContextId(h), "dept-accounts")
})

test("readDeptContextId: ignores Referer on a document navigation", () => {
  // Navigating /dept/x -> /admin/y must NOT scope the admin page to dept x.
  const h = new Headers({ referer: `${ORIGIN}/dept/dept-accounts/hr`, "sec-fetch-dest": "document" })
  assert.equal(readDeptContextId(h), null)
})

test("readDeptContextId: ignores Referer on an RSC navigation", () => {
  const h = new Headers({ referer: `${ORIGIN}/dept/dept-accounts/hr`, rsc: "1" })
  assert.equal(readDeptContextId(h), null)
})

test("readDeptContextId: ignores Referer on a router prefetch", () => {
  const h = new Headers({ referer: `${ORIGIN}/dept/dept-accounts/hr`, "next-router-prefetch": "1" })
  assert.equal(readDeptContextId(h), null)
})

test("readDeptContextId: non-dept Referer yields no context", () => {
  const h = new Headers({ referer: `${ORIGIN}/admin/hr/pms/behaviour`, "sec-fetch-dest": "empty" })
  assert.equal(readDeptContextId(h), null)
})

test("readDeptContextId: no headers at all yields no context", () => {
  assert.equal(readDeptContextId(new Headers()), null)
})

test("readDeptContextId: malformed Referer does not throw", () => {
  const h = new Headers({ referer: "not a url", "sec-fetch-dest": "empty" })
  assert.equal(readDeptContextId(h), null)
})

test("readDeptContextId: url-encoded dept id is decoded", () => {
  const h = new Headers({ referer: `${ORIGIN}/dept/dept%20one/hr`, "sec-fetch-dest": "empty" })
  assert.equal(readDeptContextId(h), "dept one")
})
