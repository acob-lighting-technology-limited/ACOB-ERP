import { TablePageSkeleton } from "@/components/skeletons"

// Mirrors AttendanceContent: Log/Calendar tabs, inline actions, four compact
// stat cards, and the row list on a
// phone over the table on a desktop.
export default function Loading() {
  return (
    <TablePageSkeleton
      filters={2}
      rows={8}
      showStats
      statCardVariant="compact"
      statCards={4}
      spacing="tight"
      inlineActions
      actions={2}
      tabs={2}
      list="responsive"
      groups={1}
    />
  )
}
