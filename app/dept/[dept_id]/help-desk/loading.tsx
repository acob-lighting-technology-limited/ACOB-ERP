import { TablePageSkeleton } from "@/components/skeletons"

export default function DeptHelpDeskLoading() {
  return <TablePageSkeleton columns={7} rows={8} statCards={4} actions={2} tabs={3} showBackLink />
}
