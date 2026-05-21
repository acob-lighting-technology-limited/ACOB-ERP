import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Formats a name string to have only the first letter of each word capitalized
 * Example: "JOHN DOE" -> "John Doe", "mary jane" -> "Mary Jane"
 */
export function formatName(name?: string | null): string {
  if (!name) return ""
  return name
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ")
}

/**
 * Formats a full name (first, middle/other, last) consistently
 */
export function formatFullName(
  firstName?: string | null,
  lastName?: string | null,
  otherNames?: string | null
): string {
  const parts = [formatName(firstName), formatName(otherNames), formatName(lastName)].filter(Boolean)
  return parts.join(" ")
}
/**
 * Returns the ISO week number for a given date.
 * ISO weeks start on Monday. Week 1 is the week with the first Thursday of the year.
 */
export function getCurrentISOWeek(date: Date = new Date()): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

/**
 * Returns the next ISO week and year.
 */
export function getNextWeekParams(w: number, y: number) {
  // ISO weeks in a year is either 52 or 53.
  // A simple way to check is to see the week of Dec 28th.
  const dec28 = new Date(y, 11, 28)
  const weeksInYear = getCurrentISOWeek(dec28)

  if (w >= weeksInYear) return { week: 1, year: y + 1 }
  return { week: w + 1, year: y }
}

export function getInitials(email?: string, firstName?: string, lastName?: string): string {
  if (firstName && lastName) return (firstName[0] + lastName[0]).toUpperCase()
  if (firstName) return firstName[0].toUpperCase()
  if (!email) return "U"
  const parts = email.split("@")[0].split(".")
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return email.substring(0, 2).toUpperCase()
}
