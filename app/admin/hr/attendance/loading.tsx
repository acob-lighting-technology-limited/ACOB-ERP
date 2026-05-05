import { TablePageSkeleton } from "@/components/skeletons"

export default function AttendanceReportsLoading() {
  return <TablePageSkeleton filters={4} columns={7} rows={8} showStats={true} statCards={3} />
}
