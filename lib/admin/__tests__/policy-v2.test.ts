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
  // Projects domain — these three shipped without keys and used to resolve to "unknown".
  assert.equal(resolveAdminRouteKeyV2("/admin/portfolios"), "portfolios.main")
  assert.equal(resolveAdminRouteKeyV2("/admin/project"), "projects.main")
  assert.equal(resolveAdminRouteKeyV2("/admin/corporate-scorecard/departments"), "scorecard.main")
})

test("unrecognised admin routes are denied, not dept-visible", () => {
  const unknownRoute = resolveAdminRouteKeyV2("/admin/some-section-with-no-key")
  assert.equal(unknownRoute, "unknown")
  // A lead must not reach an ungated page just because it has no route key.
  assert.equal(canAccessRouteV2(leadContext, unknownRoute), false)
  // An admin without a matching grant is blocked; super_admin still gets through.
  assert.equal(canAccessRouteV2(adminGlobalContext, unknownRoute), false)
  assert.equal(canAccessRouteV2(superAdminContext, unknownRoute), true)
})

test("projects domain routes are grant-driven and admin-only", () => {
  const adminProjectsContext: AccessContextV2 = {
    baseRole: "admin",
    isDepartmentLead: false,
    isAdminLike: true,
    adminRoutes: ["portfolios.main", "projects.main"],
    actingContext: "global_admin",
    managedDepartments: [],
  }

  assert.equal(canAccessRouteV2(adminProjectsContext, "portfolios.main"), true)
  assert.equal(canAccessRouteV2(adminProjectsContext, "projects.main"), true)
  assert.equal(canMutateV2(adminProjectsContext, "projects.main"), true)
  // Not granted the scorecard, so still blocked.
  assert.equal(canAccessRouteV2(adminProjectsContext, "scorecard.main"), false)
  // An admin with unrelated grants gets nothing here.
  assert.equal(canAccessRouteV2(adminReportsContext, "portfolios.main"), false)
  // Leads have no /admin projects surface.
  assert.equal(canAccessRouteV2(leadContext, "portfolios.main"), false)
  assert.equal(canAccessRouteV2(leadContext, "scorecard.main"), false)
})

test("security routes are grantable to a plain admin", () => {
  const adminSecurityContext: AccessContextV2 = {
    baseRole: "admin",
    isDepartmentLead: false,
    isAdminLike: true,
    adminRoutes: ["security.networkActivity", "security.bypassOverride"],
    actingContext: "global_admin",
    managedDepartments: [],
  }

  assert.equal(canAccessRouteV2(adminSecurityContext, "security.networkActivity"), true)
  assert.equal(canAccessRouteV2(adminSecurityContext, "security.bypassOverride"), true)
  assert.equal(canAccessRouteV2(leadContext, "security.networkActivity"), false)
})
