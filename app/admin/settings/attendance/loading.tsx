import { FormPageSkeleton } from "@/components/skeletons"

export default function Loading() {
  return <FormPageSkeleton sections={1} fieldsPerSection={5} showSidebar={false} />
}
