import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test"
import type { SeedUser } from "./seed"
import { loginAs } from "./auth"
import { toLocalISODate } from "../../../lib/utils/date"

export async function createLoggedInSession(
  browser: Browser,
  user: SeedUser
): Promise<{
  context: BrowserContext
  page: Page
}> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await loginAs(page, user.email, user.password)
  return { context, page }
}

export async function closeSession(context: BrowserContext) {
  await context.close()
}

export function uniqueLabel(prefix: string) {
  return `${prefix} ${Date.now()}`
}

export function futureIsoDate(daysFromNow: number) {
  const date = new Date()
  date.setDate(date.getDate() + daysFromNow)
  return toLocalISODate(date)
}

export function previousOfficeWeek(baseDate = new Date()) {
  const current = new Date(Date.UTC(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate()))
  const day = current.getUTCDay() || 7
  current.setUTCDate(current.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(current.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((current.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  if (week > 1) return { week: week - 1, year: current.getUTCFullYear() }
  return { week: 52, year: current.getUTCFullYear() - 1 }
}

export async function expectApiOk(response: { ok(): boolean; status(): number }, message: string) {
  expect(response.ok(), `${message} (status ${response.status()})`).toBeTruthy()
}
