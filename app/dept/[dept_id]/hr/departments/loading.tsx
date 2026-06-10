import { TablePageSkeleton } from "@/components/skeletons"

export default function DepartmentsLoading() {
  return <TablePageSkeleton filters={0} columns={5} rows={6} showStats={true} statCards={3} />
}
