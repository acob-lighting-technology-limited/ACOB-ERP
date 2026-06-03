import { TablePageSkeleton } from "@/components/skeletons/table-page-skeleton"

export default function FeedbackLoading() {
  return <TablePageSkeleton filters={2} columns={5} rows={8} showStats={true} statCards={3} actions={1} />
}
