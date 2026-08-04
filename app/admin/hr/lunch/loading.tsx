import { TablePageSkeleton } from "@/components/skeletons"

export default function Loading() {
  return <TablePageSkeleton statCards={4} filters={2} actions={3} showBackLink={true} />
}
