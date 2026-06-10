import { TablePageSkeleton } from "@/components/skeletons"

export default function LeaveApproveLoading() {
  return <TablePageSkeleton filters={0} columns={7} rows={6} showStats={true} statCards={3} />
}
