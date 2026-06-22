import { TablePageSkeleton } from "@/components/skeletons"

export default function LeaveLoading() {
  return <TablePageSkeleton filters={3} columns={8} rows={8} showStats={true} statCards={3} tabs={3} />
}
