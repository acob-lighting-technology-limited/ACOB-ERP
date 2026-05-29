import { PmsMetricTabsPage } from "../_components/pms-metric-tabs-page"

export default function AdminPmsAttendancePage({
  backLinkHref,
  attendanceBasePath,
}: { backLinkHref?: string; attendanceBasePath?: string } = {}) {
  return (
    <PmsMetricTabsPage
      metric="attendance"
      title="PMS Attendance"
      description="Attendance view with individual, department, and cycle tabs."
      iconKey="attendance"
      backLinkHref={backLinkHref}
      attendanceBasePath={attendanceBasePath}
    />
  )
}
