import { TablePageSkeleton } from "@/components/skeletons"

export default function OnboardingLoading() {
  return (
    <TablePageSkeleton
      filters={5}
      columns={7}
      rows={10}
      showStats={true}
      statCards={4}
      actions={2}
      showBackLink={true}
    />
  )
}
