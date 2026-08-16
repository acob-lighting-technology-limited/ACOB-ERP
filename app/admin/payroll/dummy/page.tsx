import { redirect } from "next/navigation"

export default function DummyPayrollRedirectPage() {
  redirect("/admin/payroll/calculator")
}
