import { redirect } from "next/navigation"

export default function DeprecatedAttendanceReportsPage() {
  redirect("/admin/hr/attendance")
}
