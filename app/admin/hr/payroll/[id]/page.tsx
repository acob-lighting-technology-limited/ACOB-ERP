import { redirect } from "next/navigation"

/** Payroll moved out of HR to /admin/payroll (own payroll.main route key). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/admin/payroll/${id}`)
}
