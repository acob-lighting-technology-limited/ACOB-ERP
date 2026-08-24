import { TablePageSkeleton } from "@/components/skeletons"

export default function Loading() {
  return <TablePageSkeleton filters={2} columns={6} rows={10} showStats={true} statCards={4} actions={1} />
}
