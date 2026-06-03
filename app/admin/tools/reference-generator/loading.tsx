import { TablePageSkeleton } from "@/components/skeletons"

export default function Loading() {
  return <TablePageSkeleton filters={2} columns={5} rows={8} showStats={true} statCards={3} tabs={2} actions={2} />
}
