import { test, expect } from "@playwright/test"
import { seedTestData } from "./helpers/seed"
import { closeSession, createLoggedInSession, expectApiOk, futureIsoDate, uniqueLabel } from "./helpers/session"

test("Full leave approval flow", async ({ browser }) => {
  const seed = await seedTestData()
  test.skip(!seed.ready || !seed.leaveTypeId || !seed.testReliever.id, seed.reason || "Leave seed data not ready")

  const unique = uniqueLabel("Playwright leave")
  const startDate = futureIsoDate(10)

  const employee = await createLoggedInSession(browser, seed.testEmployee)
  const createResponse = await employee.page.request.post("/api/hr/leave/requests", {
    data: {
      leave_type_id: seed.leaveTypeId,
      segments: [{ start_date: startDate, end_date: futureIsoDate(13) }],
      reason: `${unique} reason`,
      reliever_identifier: seed.testReliever.id,
      handover_checklist_url: "https://example.sharepoint.com/test-handover.pdf",
    },
  })
  await expectApiOk(createResponse, "create leave request")
  const created = (await createResponse.json()) as { data?: { id?: string } }
  const requestId = created.data?.id
  expect(requestId).toBeTruthy()

  await employee.page.goto("/leave")
  await expect(employee.page.getByText(unique, { exact: false })).toBeVisible()
  await closeSession(employee.context)

  const reliever = await createLoggedInSession(browser, seed.testReliever)
  await reliever.page.goto("/leave")
  const relieverCard = reliever.page.locator("div.rounded-md.border").filter({ hasText: unique }).first()
  await expect(reliever.page.getByText("My Approval Queue")).toBeVisible()
  await expect(relieverCard).toBeVisible()
  await relieverCard.getByRole("button", { name: "Approve" }).click()
  await closeSession(reliever.context)

  const lead = await createLoggedInSession(browser, seed.testLead)
  await lead.page.goto("/leave")
  const leadCard = lead.page.locator("div.rounded-md.border").filter({ hasText: unique }).first()
  await expect(leadCard).toBeVisible()
  await leadCard.getByRole("button", { name: "Approve" }).click()
  await closeSession(lead.context)

  const hr = await createLoggedInSession(browser, seed.testHR)
  await hr.page.goto("/admin/hr/leave/approve")
  const hrCard = hr.page.locator("div.rounded.border.p-3").filter({ hasText: unique }).first()
  await expect(hr.page.getByText("My Action Queue")).toBeVisible()
  await expect(hrCard).toBeVisible()
  await hrCard.getByRole("button", { name: "Endorse" }).click()
  await closeSession(hr.context)

  const employeeVerify = await createLoggedInSession(browser, seed.testEmployee)
  await expect
    .poll(async () => {
      const response = await employeeVerify.page.request.get("/api/hr/leave/requests?page=1&limit=20")
      const payload = (await response.json()) as { data?: Array<{ id: string; status?: string }> }
      return payload.data?.find((item) => item.id === requestId)?.status || null
    })
    .toBe("approved")
  await employeeVerify.page.goto("/leave")
  await expect(employeeVerify.page.getByText(unique, { exact: false })).toBeVisible()
  await closeSession(employeeVerify.context)
})
