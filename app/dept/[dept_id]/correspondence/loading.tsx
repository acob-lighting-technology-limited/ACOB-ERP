import { TablePageSkeleton } from "@/components/skeletons"

export default function DeptCorrespondenceLoading() {
  return <TablePageSkeleton columns={6} rows={8} statCards={3} actions={2} showBackLink />
}
