import { requireAdminSectionAccess } from "@/lib/admin/rbac"
import { BirthdayExplorer } from "./birthday-explorer"

export default async function BirthdayPage() {
  // HR-access admins only — this page fetches employee birthdays and photos.
  await requireAdminSectionAccess("hr")

  return (
    <main className="birthday-page">
      <div className="birthday-page__ambient" aria-hidden="true" />
      <div className="birthday-page__ambient birthday-page__ambient--secondary" aria-hidden="true" />

      <section className="birthday-hero">
        <BirthdayExplorer />
      </section>
    </main>
  )
}
