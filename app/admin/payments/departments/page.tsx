import { redirect } from "next/navigation"

export default function LegacyPaymentDepartmentsPage() {
  redirect("/admin/accounts/payments")
}
