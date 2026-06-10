import { toLocalISODate, formatWATDate } from "@/lib/utils/date"

export const DEFAULT_TEAMS_LINK =
  "https://teams.microsoft.com/l/meetup-join/19%3ameeting_MWZhNTgwYjEtMzdjMi00ZDZkLWJhM2YtZjFiNjgxNDEzN2Nk%40thread.v2/0?context=%7b%22Tid%22%3a%22b1f048ac-9f61-4cfd-98a3-13454b2682e5%22%2c%22Oid%22%3a%22224317b2-9cfb-425c-bc86-57bb397c73cd%22%7d"

export const LEGACY_DEFAULT_AGENDA = [
  "Opening Prayer",
  "Knowledge Sharing Session (30 minutes)",
  "Departmental Updates",
  "Progress on Ongoing Projects",
  "Upcoming Events and Deadlines",
  "Any Other Business",
  "Adjournment",
]

export const DEFAULT_AGENDA = [
  "Opening Prayer",
  "Knowledge Sharing Session (30 minutes)",
  "Minutes of the Last Meeting",
  "Departmental Updates",
  "Any Other Business",
  "MD's Remarks",
  "Closing Remarks",
]

export function getNextMondayFormatted(): string {
  const now = new Date()
  const day = now.getDay()
  const daysUntilMonday = day === 0 ? 1 : day === 1 ? 0 : 8 - day
  const nextMonday = new Date(now)
  nextMonday.setDate(now.getDate() + daysUntilMonday)
  return toLocalISODate(nextMonday)
}

export function formatDateNice(dateStr: string): string {
  if (!dateStr) return ""
  const d = new Date(dateStr + "T00:00:00")
  const day = d.getDate()
  const suffix = [1, 21, 31].includes(day) ? "st" : [2, 22].includes(day) ? "nd" : [3, 23].includes(day) ? "rd" : "th"
  const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "Africa/Lagos" }).format(d)
  const month = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "Africa/Lagos" }).format(d)
  const year = d.getFullYear()
  return `${weekday} ${day}${suffix} ${month} ${year}`
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function stripHtmlToText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}
