import { TablePageSkeleton } from "@/components/skeletons"

export default function InvoicesLoading() {
  return <TablePageSkeleton filters={2} columns={7} rows={8} showStats={true} statCards={4} />
}
