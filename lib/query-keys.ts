/**
 * Centralised query key factory.
 * Using constants prevents typos and makes cache invalidation reliable.
 */
export const QUERY_KEYS = {
  // HR
  leaveRequests: (filters?: Record<string, unknown>) => (filters ? ["leave-requests", filters] : ["leave-requests"]),
  leaveBalance: (userId?: string) => ["leave-balance", userId],
  leaveTypes: () => ["leave-types"],
  leaveHolidays: () => ["leave-holidays"],
  leavePolicies: () => ["leave-policies"],

  // Attendance
  attendance: (userId?: string) => ["attendance", userId],

  // Performance
  goals: (userId?: string) => ["goals", userId],
  reviews: (userId?: string) => ["reviews", userId],

  // Fleet
  fleetResources: () => ["fleet-resources"],
  fleetBookings: (filters?: Record<string, unknown>) => (filters ? ["fleet-bookings", filters] : ["fleet-bookings"]),

  // Help desk
  tickets: (filters?: Record<string, unknown>) => (filters ? ["tickets", filters] : ["tickets"]),
  ticket: (id: string) => ["ticket", id],

  // Admin
  departments: () => ["departments"],
  officeLocations: () => ["office-locations"],
  profiles: (filters?: Record<string, unknown>) => (filters ? ["profiles", filters] : ["profiles"]),
  profile: (id: string) => ["profile", id],
  assets: (filters?: Record<string, unknown>) => (filters ? ["assets", filters] : ["assets"]),
  payments: (filters?: Record<string, unknown>) => (filters ? ["payments", filters] : ["payments"]),
  notifications: () => ["notifications"],
  search: (q: string) => ["search", q],

  // Weekly reports
  weeklyReports: (filters?: Record<string, unknown>) => (filters ? ["weekly-reports", filters] : ["weekly-reports"]),
  adminWeeklyReports: (filters?: Record<string, unknown>) =>
    filters ? ["admin-weekly-reports", filters] : ["admin-weekly-reports"],
  adminWeeklyReportLockState: (week: number, year: number) => ["admin-weekly-report-lock", week, year],

  // Action tracker
  actionTrackerMetadata: () => ["action-tracker-metadata"],
  actionTrackerTasks: (filters?: Record<string, unknown>) =>
    filters ? ["action-tracker-tasks", filters] : ["action-tracker-tasks"],
  adminActionTrackerTasks: (filters?: Record<string, unknown>) =>
    filters ? ["admin-action-tracker-tasks", filters] : ["admin-action-tracker-tasks"],

  // Suspension
  suspension: (userId: string) => ["suspension", userId],

  // Job description / profile data
  jobDescription: (userId: string) => ["job-description", userId],
  profileEdit: (userId: string) => ["profile-edit", userId],

  // Admin assets
  adminAssetTypes: () => ["admin-asset-types"],

  // Admin fleet
  adminFleetResources: () => ["admin-fleet-resources"],
  adminFleetBookings: (status?: string) => (status ? ["admin-fleet-bookings", status] : ["admin-fleet-bookings"]),

  // Dev login logs
  devLoginLogs: () => ["dev-login-logs"],

  // Admin onboarding (account sign-in status)
  adminOnboarding: () => ["admin-onboarding"],

  // Dev AcoBot logs
  acobotLogs: () => ["acobot-logs"],

  // Company directory
  directory: () => ["directory"],

  // Pending applications
  pendingApplications: () => ["pending-applications"],

  // Performance
  performanceCreateData: () => ["performance-create-data"],

  // Leave queue and relievers
  leaveQueue: () => ["leave-queue"],
  leaveRelievers: () => ["leave-relievers"],

  // Admin employees
  adminEmployees: (filters?: Record<string, unknown>) => (filters ? ["admin-employees", filters] : ["admin-employees"]),

  // Admin HR pages
  adminDepartmentsPage: () => ["admin-departments-page"],
  adminHrDashboard: () => ["admin-hr-dashboard"],
  adminAttendanceReports: (filters?: Record<string, unknown>) =>
    filters ? ["admin-attendance-reports", filters] : ["admin-attendance-reports"],
  adminLeaveSettings: () => ["admin-leave-settings"],
  adminOfficeLocations: () => ["admin-office-locations"],
  adminEmployeeDetail: (userId: string) => ["admin-employee-detail", userId],
  adminJobDescriptions: (filters?: Record<string, unknown>) =>
    filters ? ["admin-job-descriptions", filters] : ["admin-job-descriptions"],
  adminAuditLogs: (filters?: Record<string, unknown>) =>
    filters ? ["admin-audit-logs", filters] : ["admin-audit-logs"],

  // Finance pages
  adminBills: () => ["admin-bills"],
  adminInvoices: () => ["admin-invoices"],
  adminFinanceReports: () => ["admin-finance-reports"],

  // Settings pages
  adminUsersSettings: () => ["admin-users-settings"],
  adminRolesSettings: () => ["admin-roles-settings"],

  // Inventory pages
  adminInventoryDashboard: () => ["admin-inventory-dashboard"],
  adminProducts: (filters?: Record<string, unknown>) => (filters ? ["admin-products", filters] : ["admin-products"]),
  adminCategories: () => ["admin-categories"],
  adminWarehouses: () => ["admin-warehouses"],
  adminInventoryMovements: (filters?: Record<string, unknown>) =>
    filters ? ["admin-inventory-movements", filters] : ["admin-inventory-movements"],

  // Purchasing pages
  adminPurchasingDashboard: () => ["admin-purchasing-dashboard"],
  adminPurchaseOrders: (filters?: Record<string, unknown>) =>
    filters ? ["admin-purchase-orders", filters] : ["admin-purchase-orders"],
  adminSuppliers: () => ["admin-suppliers"],

  // App pages
  appDocumentation: () => ["app-documentation"],
  appAssets: () => ["app-assets"],
  appProjects: () => ["app-projects"],
  appProjectDetail: (id: string) => ["app-project-detail", id],
  appTasks: () => ["app-tasks"],
  appPaymentDetail: (id: string) => ["app-payment-detail", id],
  appJobDescription: () => ["app-job-description"],
  appNotifications: () => ["app-notifications"],

  // Admin purchasing detail pages
  adminSupplierDetail: (id: string) => ["admin-supplier-detail", id],
  adminPurchaseOrderDetail: (id: string) => ["admin-purchase-order-detail", id],
  adminReceiptsList: () => ["admin-receipts-list"],
  adminNewPurchaseOrderForm: () => ["admin-new-purchase-order-form"],

  // Admin inventory detail pages
  adminProductDetail: (id: string) => ["admin-product-detail", id],
  adminProductEditForm: (id: string) => ["admin-product-edit-form", id],
  adminProductCategories: () => ["admin-product-categories"],

  // Admin finance detail pages
  adminBillDetail: (id: string) => ["admin-bill-detail", id],
  adminInvoiceDetail: (id: string) => ["admin-invoice-detail", id],
  adminPaymentDetail: (id: string) => ["admin-payment-detail", id],

  // Admin assets pages
  adminAssetIssues: () => ["admin-asset-issues"],

  // Admin projects
  adminProjectDetail: (id: string) => ["admin-project-detail", id],

  // Settings
  adminCurrentUserRole: () => ["admin-current-user-role"],

  // Employee onboarding form
  employeeOnboardingDepartments: () => ["employee-onboarding-departments"],
  employeeOnboardingOfficeLocations: () => ["employee-onboarding-office-locations"],

  // HR change-status dialog
  hrEmployeeStatusBlockers: (employeeId: string) => ["hr-employee-status-blockers", employeeId],
  hrLeaveTypesActive: () => ["hr-leave-types-active"],

  // Components
  feedbackViewer: () => ["feedback-viewer-filter"],
  paymentsTable: (filters?: Record<string, unknown>) => (filters ? ["payments-table", filters] : ["payments-table"]),
  notificationBell: () => ["notification-bell"],
  weeklyReportDialog: (week: number, year: number) => ["weekly-report-dialog", week, year],
  adminWeeklySummaryMail: (filters?: Record<string, unknown>) =>
    filters ? ["admin-weekly-summary-mail", filters] : ["admin-weekly-summary-mail"],

  // Communications
  adminReminderSchedules: (mode: string) => ["admin-reminder-schedules", mode],

  // Security
  adminSecurityEmployees: () => ["admin-security-employees"],
  adminSecurityNetworkActivity: (filters?: Record<string, unknown>) =>
    filters ? ["admin-security-network-activity", filters] : ["admin-security-network-activity"],
} as const
