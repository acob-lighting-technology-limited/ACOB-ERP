import assert from "node:assert/strict"
import test from "node:test"
import {
  canAccessRouteV2,
  canMutateV2,
  getDataScopeV2,
  resolveAdminRouteKeyV2,
  type AccessContextV2,
} from "@/lib/admin/policy-v2"

const leadContext: AccessContextV2 = {
  baseRole: "employee",
  isDepartmentLead: true,
  isAdminLike: false,
  adminDomains: null,
  actingContext: "department_lead",
  managedDepartments: ["accounts", "it"],
}

const adminReportsContext: AccessContextV2 = {
  baseRole: "admin",
  isDepartmentLead: false,
  isAdminLike: true,
  adminDomains: ["reports"],
  actingContext: "global_admin",
  managedDepartments: [],
}

const adminGlobalContext: AccessContextV2 = {
  baseRole: "admin",
  isDepartmentLead: false,
  isAdminLike: true,
  adminDomains: ["reports", "hr"],
  actingContext: "global_admin",
  managedDepartments: [],
}

const superAdminContext: AccessContextV2 = {
  baseRole: "super_admin",
  isDepartmentLead: true,
  isAdminLike: true,
  adminDomains: null,
  actingContext: "global_admin",
  managedDepartments: ["accounts"],
}

test("lead cannot access admin-only routes", () => {
  assert.equal(canAccessRouteV2(leadContext, "auditlogs.main"), false)
  assert.equal(canAccessRouteV2(leadContext, "dev.main"), false)
  assert.equal(canAccessRouteV2(leadContext, "settings.main"), false)
  assert.equal(canAccessRouteV2(leadContext, "communications.meetings"), false)
  assert.equal(canAccessRouteV2(leadContext, "hr.fleet"), false)
  assert.equal(canAccessRouteV2(leadContext, "hr.resources"), false)
  assert.equal(canAccessRouteV2(leadContext, "hr.pms.cbt.manage"), false)
})

test("lead gets global report visibility but limited mutations", () => {
  assert.equal(canAccessRouteV2(leadContext, "reports.other"), true)
  assert.equal(getDataScopeV2(leadContext, "reports.other"), "all")
  assert.equal(canMutateV2(leadContext, "reports.other", "accounts"), false)

  assert.equal(canAccessRouteV2(leadContext, "reports.weekly"), true)
  assert.equal(canMutateV2(leadContext, "reports.weekly", "accounts"), true)
  assert.equal(canMutateV2(leadContext, "reports.weekly", "legal"), false)
})

test("lead gets department-scoped CRUD on tasks", () => {
  assert.equal(canAccessRouteV2(leadContext, "tasks.main"), true)
  assert.deepEqual(getDataScopeV2(leadContext, "tasks.main"), ["accounts", "it"])
  assert.equal(canMutateV2(leadContext, "tasks.main", "it"), true)
  assert.equal(canMutateV2(leadContext, "tasks.main", "legal"), false)
})

test("domain-limited admin only accesses configured domain", () => {
  assert.equal(canAccessRouteV2(adminReportsContext, "auditlogs.main"), false)
  assert.equal(canAccessRouteV2(adminReportsContext, "reports.other"), true)
  assert.equal(canAccessRouteV2(adminReportsContext, "finance.main"), false)
  assert.equal(canMutateV2(adminReportsContext, "reports.other", "accounts"), true)
  assert.equal(canMutateV2(adminReportsContext, "reports.weekly", "accounts"), true)
})

test("super admin global context can access admin-only routes", () => {
  assert.equal(canAccessRouteV2(superAdminContext, "auditlogs.main"), true)
  assert.equal(canAccessRouteV2(superAdminContext, "settings.main"), true)
  assert.equal(canAccessRouteV2(superAdminContext, "communications.meetings"), true)
})

test("admin global context cannot access audit logs", () => {
  assert.equal(canAccessRouteV2(adminGlobalContext, "auditlogs.main"), false)
})

test("route resolver maps critical override routes", () => {
  assert.equal(resolveAdminRouteKeyV2("/admin/audit-logs"), "auditlogs.main")
  assert.equal(resolveAdminRouteKeyV2("/admin/communications/meetings/mail"), "communications.meetings")
  assert.equal(resolveAdminRouteKeyV2("/admin/hr/pms/cbt/question"), "hr.pms.cbt.manage")
  assert.equal(resolveAdminRouteKeyV2("/admin/hr/pms/cbt/abc123"), "hr.pms.cbt.manage")
  assert.equal(resolveAdminRouteKeyV2("/admin/hr/resources"), "hr.resources")
  assert.equal(resolveAdminRouteKeyV2("/admin/reports/general-meeting/weekly-reports"), "reports.weekly")
})
