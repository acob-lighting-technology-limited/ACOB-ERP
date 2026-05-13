/**
 * Types Index
 * Central export file for all type definitions
 *
 * NOTE: We use selective exports to avoid conflicts between
 * database.ts and module-specific type files.
 */

// ============================================
// Database types (primary source of truth)
// ============================================
export * from "./database"

// ============================================
// HR types (excluding duplicates from database.ts)
// ============================================
export type {
  Employee,
  EmployeeFormData,
  DepartmentWithStats,
  AttendanceStatus,
  AttendanceRecord,
  AttendanceSummary,
  LeaveType,
  LeaveStatus,
  LeaveRequest,
  LeaveBalance,
  PerformanceRating,
  ReviewStatus,
  PerformanceGoal,
  PerformanceReview,
  JobStatus,
  ApplicantStatus,
  JobPosting,
  Applicant,
  TrainingProgram,
  TrainingEnrollment,
} from "./hr"

// ============================================
// Finance types (excluding duplicates)
// ============================================
export type {
  InvoiceStatus,
  Invoice,
  InvoiceItem,
  InvoiceFormData,
  InvoiceItemFormData,
  BillStatus,
  Bill,
  BillItem,
  AccountType,
  ChartOfAccount,
  BankAccount,
  FinancialSummary,
} from "./finance"

// ============================================
// CRM types (will be separate app)
// ============================================
export type {
  CRMPipeline,
  PipelineStage,
  CRMContact,
  CRMAddress,
  CRMOpportunity,
  CRMActivity,
  CRMTag,
  CreateContactInput,
  UpdateContactInput,
  CreateOpportunityInput,
  UpdateOpportunityInput,
  CreateActivityInput,
  UpdateActivityInput,
  CRMDashboardMetrics,
  ContactFilters,
  OpportunityFilters,
  ActivityFilters,
} from "./crm"

// ============================================
// Payments types (excluding duplicates from database.ts)
// ============================================
export type {
  PaymentCategory,
  PaymentDocumentUpload,
  DepartmentPaymentStats,
  PaymentsByCategory,
  PaymentApiResponse,
  DepartmentPaymentWithDocuments,
  OneTimePaymentFormData,
  RecurringPaymentFormData,
} from "./payments"

// Re-export DocumentType from payments (unique to that module)
export type { DocumentType } from "./payments"

// Help Desk types
export type { HelpDeskPriority, HelpDeskStatus, HelpDeskTicket } from "./help-desk"
