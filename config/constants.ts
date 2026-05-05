/**
 * Centralized organizational constants.
 *
 * Previously these values were scattered across API routes and library files.
 * Collecting them here means a single edit propagates everywhere they are used.
 *
 * If a value needs to be runtime-configurable per environment, move it to the
 * `system_settings` table in Supabase (the infrastructure already exists).
 */

// ---------------------------------------------------------------------------
// Company / Portal
// ---------------------------------------------------------------------------

/** Public URL of the employee web-mail / portal login page. */
export const PORTAL_URL = "https://www.acoblighting.com/mail"

/**
 * Organisation-wide constants grouped by domain.
 * These values were previously hardcoded across multiple files.
 * Update here to propagate everywhere.
 */
export const ORG = {
  /** Public-facing mail portal URL */
  MAIL_PORTAL_URL: "https://www.acoblighting.com/mail",

  /** Department names used in routing and escalation logic */
  DEPARTMENTS: {
    CORPORATE_SERVICES: "Corporate Services",
    EXECUTIVE_MANAGEMENT: "Executive Management",
  },

  /** Business hours (24-hour format) */
  BUSINESS_HOURS: {
    START: 9,
    END: 18,
  },

  /** SLA durations in business hours by priority */
  SLA_HOURS: {
    urgent: 4,
    high: 8,
    normal: 24,
    low: 72,
  },
} as const

/** Support email address shown in error pages and emails. */
export const SUPPORT_EMAIL = "ict@acoblighting.com"

// ---------------------------------------------------------------------------
// Business hours (used by the help-desk SLA calculator)
// ---------------------------------------------------------------------------

/** First business hour of the day (inclusive), 24-hour clock. */
export const BUSINESS_HOUR_START = 9 // 09:00

/** Last business hour of the day (exclusive), 24-hour clock. */
export const BUSINESS_HOUR_END = 18 // 18:00

// ---------------------------------------------------------------------------
// Help-desk SLA targets (in business hours / days)
// ---------------------------------------------------------------------------

export const SLA_URGENT_HOURS = 4
export const SLA_HIGH_HOURS = 24
export const SLA_MEDIUM_DAYS = 3
export const SLA_LOW_DAYS = 7

// ---------------------------------------------------------------------------
// Special departments used in routing / escalation logic
// ---------------------------------------------------------------------------

/**
 * Department that houses the Managing Director (MD).
 * Referenced in leave-approval routing and asset-notification escalation.
 */
export const DEPT_EXECUTIVE_MANAGEMENT = "Executive Management"

/**
 * Department that houses the Head of Corporate Services (HCS).
 * Referenced in leave-approval routing and asset-notification escalation.
 */
export const DEPT_CORPORATE_SERVICES = "Corporate Services"
