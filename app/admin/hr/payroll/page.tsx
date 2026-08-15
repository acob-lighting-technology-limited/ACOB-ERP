import { redirect } from "next/navigation"

/** Payroll moved out of HR to /admin/payroll (own payroll.main route key). */
export default function Page() {
  redirect("/admin/payroll")
}
