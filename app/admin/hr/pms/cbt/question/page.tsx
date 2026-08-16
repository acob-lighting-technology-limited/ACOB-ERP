import { redirect } from "next/navigation"

// Regular CBT questions are now authored exclusively by the department lead
// who owns them, from /dept/[id]/hr/pms/cbt/question — admins never see or
// edit that content (see app/api/hr/performance/cbt/questions/route.ts).
// This route is kept only so old links/bookmarks don't dead-end.
export default function AdminPmsCbtQuestionPage() {
  redirect("/admin/hr/pms/cbt")
}
