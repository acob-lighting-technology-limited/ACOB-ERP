import { redirect } from "next/navigation"

export default function HrPayrollDummyRedirectPage() {
  redirect("/admin/payroll/calculator")
}
