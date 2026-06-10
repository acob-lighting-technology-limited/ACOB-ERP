import { TablePageSkeleton } from "@/components/skeletons"

export default function PaymentsLoading() {
  return <TablePageSkeleton filters={3} columns={7} rows={8} showStats={true} statCards={4} />
}
