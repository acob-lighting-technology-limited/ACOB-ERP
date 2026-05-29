import { PmsMetricTabsPage } from "../_components/pms-metric-tabs-page"

export default function AdminPmsKpiPage({
  backLinkHref,
  attendanceBasePath,
}: { backLinkHref?: string; attendanceBasePath?: string } = {}) {
  return (
    <PmsMetricTabsPage
      metric="kpi"
      title="PMS KPI"
      description="KPI view with individual, department, and cycle tabs."
      iconKey="kpi"
      backLinkHref={backLinkHref}
      attendanceBasePath={attendanceBasePath}
    />
  )
}
