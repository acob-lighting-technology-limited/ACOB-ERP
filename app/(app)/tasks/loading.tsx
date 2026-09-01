import { TablePageSkeleton } from "@/components/skeletons"

// Mirrors TasksContent: back link, tight rhythm, five compact stat cards, and
// the row list it opens on a phone over the table it opens on a desktop.
export default function TasksLoading() {
  return (
    <TablePageSkeleton
      filters={2}
      columns={6}
      rows={8}
      showStats
      statCardVariant="compact"
      statCards={5}
      spacing="tight"
      showBackLink
      actions={0}
      list="responsive"
      groups={1}
    />
  )
}
