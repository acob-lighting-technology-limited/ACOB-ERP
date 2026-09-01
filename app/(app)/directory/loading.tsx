import { TablePageSkeleton } from "@/components/skeletons"

// Mirrors DirectoryContent: inline actions, four compact stat cards, and the
// A–Z contacts list it opens in — not the table behind the toggle.
export default function Loading() {
  return (
    <TablePageSkeleton
      filters={3}
      rows={9}
      showStats
      statCardVariant="compact"
      statCards={4}
      spacing="tight"
      inlineActions
      actions={2}
      list="contacts"
      groups={3}
    />
  )
}
