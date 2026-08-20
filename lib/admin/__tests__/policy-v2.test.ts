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
  adminRoutes: null,
  actingContext: "department_lead",
  // These must be canonical names (as buildAccessContextV2 would normalize them
  // to) since canMutateV2/isDepartmentManaged normalize the department it's
  // checking against before comparing.
  managedDepartments: ["Accounts", "IT and Communications"],
}

const adminReportsContext: AccessContextV2 = {
  baseRole: "admin",
  isDepartmentLead: false,
  isAdminLike: true,
  adminRoutes: ["reports.weekly", "reports.other"],
  actingContext: "global_admin",
  managedDepartments: [],
}

const adminGlobalContext: AccessContextV2 = {
  baseRole: "admin",
  isDepartmentLead: false,
  isAdminLike: true,
  adminRoutes: [
    "reports.weekly",
    "reports.other",
    "hr.main",
    "jobdescriptions.main",
    "hr.fleet",
    "hr.resources",
    "hr.pms.cbt.manage",
  ],
  actingContext: "global_admin",
  managedDepartments: [],
}

const superAdminContext: AccessContextV2 = {
  baseRole: "super_admin",
  isDepartmentLead: true,
  isAdminLike: true,
  adminRoutes: null,
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
})

test("lead manages CBT for their own department", () => {
  // Leads own their team's assessment, so CBT is dept-scoped, not admin-only.
  assert.equal(canAccessRouteV2(leadContext, "hr.pms.cbt.manage"), true)
  assert.deepEqual(getDataScopeV2(leadContext, "hr.pms.cbt.manage"), leadContext.managedDepartments)
  assert.equal(canMutateV2(leadContext, "hr.pms.cbt.manage", "Accounts"), true)
  // ...but not for a department they do not lead.
  assert.equal(canMutateV2(leadContext, "hr.pms.cbt.manage", "Operations"), false)
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
  assert.deepEqual(getDataScopeV2(leadContext, "tasks.main"), ["Accounts", "IT and Communications"])
  assert.equal(canMutateV2(leadContext, "tasks.main", "it"), true)
  assert.equal(canMutateV2(leadContext, "tasks.main", "legal"), false)
})

test("route-limited admin only accesses granted routes", () => {
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
  // Leave & Attendance are split out of hr.main; Resources folds into the Resource Booking grant (hr.fleet).
  assert.equal(resolveAdminRouteKeyV2("/admin/hr/leave"), "hr.leave")
  assert.equal(resolveAdminRouteKeyV2("/admin/hr/attendance"), "hr.attendance")
  assert.equal(resolveAdminRouteKeyV2("/admin/hr/resources"), "hr.fleet")
  assert.equal(resolveAdminRouteKeyV2("/admin/accounts"), "accounts.main")
  assert.equal(resolveAdminRouteKeyV2("/admin/finance"), "accounts.main")
  assert.equal(resolveAdminRouteKeyV2("/admin/reports/general-meeting/weekly-reports"), "reports.weekly")
})
