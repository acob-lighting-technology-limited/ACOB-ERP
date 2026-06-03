import { TablePageSkeleton } from "@/components/skeletons"

export default function EmployeesLoading() {
  return <TablePageSkeleton filters={3} columns={7} rows={10} showStats={true} statCards={4} actions={2} />
}
