import { TablePageSkeleton } from "@/components/skeletons"

export default function Loading() {
  return <TablePageSkeleton filters={2} columns={6} rows={8} showStats={false} />
}
