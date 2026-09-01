import { TablePageSkeleton } from "@/components/skeletons"

// Mirrors LeaveContent: back link, My Requests / Pending Reviews tabs, inline
// actions, compact stat cards, and the row list it opens on a phone over the
// table it opens on a desktop.
export default function LeaveLoading() {
  return (
    <TablePageSkeleton
      filters={2}
      columns={5}
      rows={6}
      showStats
      statCardVariant="compact"
      statCards={3}
      spacing="tight"
      showBackLink
      inlineActions
      actions={2}
      tabs={2}
      list="responsive"
      groups={1}
    />
  )
}
