import { TablePageSkeleton } from "@/components/skeletons"

export default function DeptWeeklyReportsLoading() {
  return <TablePageSkeleton columns={7} rows={8} statCards={4} actions={2} filters={3} showBackLink />
}
