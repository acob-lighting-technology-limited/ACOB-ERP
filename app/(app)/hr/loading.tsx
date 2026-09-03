import { CardGridPageSkeleton } from "@/components/skeletons/card-grid-page-skeleton"

export default function Loading() {
  return <CardGridPageSkeleton cards={4} columns={2} />
}
