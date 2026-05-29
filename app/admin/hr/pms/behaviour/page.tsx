import { PmsMetricTabsPage } from "../_components/pms-metric-tabs-page"

export default function AdminPmsBehaviourPage({
  backLinkHref,
  attendanceBasePath,
}: { backLinkHref?: string; attendanceBasePath?: string } = {}) {
  return (
    <PmsMetricTabsPage
      metric="behaviour"
      title="PMS Behaviour"
      description="Behaviour view with individual, department, and cycle tabs."
      iconKey="behaviour"
      backLinkHref={backLinkHref}
      attendanceBasePath={attendanceBasePath}
    />
  )
}
