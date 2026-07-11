/* eslint-disable @next/next/no-img-element */
import { redirect } from "next/navigation"
import { Sparkles, Stars } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getAvatarSignedUrls } from "@/lib/profile-photos"

interface Celebrant {
  displayName: string
  imageSrc: string | null
  department: string
  birthday: string
}

export default async function BirthdayPage() {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect("/auth/login")
  }

  // Fetch active employee profiles
  const { data: profiles } = await supabase
    .from("profiles")
    .select("first_name, last_name, birthday, department, avatar_path")
    .eq("employment_status", "active")
    .not("birthday", "is", null)

  const dataClient = getServiceRoleClientOrFallback(supabase)
  const avatarPaths = (profiles || []).map((p) => p.avatar_path).filter((path): path is string => Boolean(path))
  const signedUrlsByPath = await getAvatarSignedUrls(dataClient, avatarPaths)

  const celebrants: Celebrant[] = (profiles || [])
    .filter((p) => {
      const bday = p.birthday
      if (!bday) return false
      // Filter for birthdays from 25/05 to 04/07
      return bday >= "05-25" && bday <= "07-04"
    })
    .map((p) => {
      const imageSrc = p.avatar_path ? (signedUrlsByPath.get(p.avatar_path) ?? null) : null
      const displayName = p.first_name.trim().toLowerCase() === "eliah" ? "Elijah" : p.first_name

      return {
        displayName,
        imageSrc,
        department: p.department || "Organization",
        birthday: p.birthday || "",
      }
    })
    .sort((a, b) => a.birthday.localeCompare(b.birthday))

  const celebrantCount = celebrants.length

  const formatNamesList = (names: string[]) => {
    if (names.length === 0) return ""
    if (names.length === 1) return names[0]
    if (names.length === 2) return `${names[0]} & ${names[1]}`
    return `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}`
  }

  const celebrantsTitle = formatNamesList(celebrants.map((c) => c.displayName))

  return (
    <main className="birthday-page">
      <div className="birthday-page__ambient" aria-hidden="true" />
      <div className="birthday-page__ambient birthday-page__ambient--secondary" aria-hidden="true" />

      <section className="birthday-hero">
        <div className="birthday-hero__copy">
          <div className="birthday-logo-container">
            <img
              src="/images/acob-logo-dark.webp"
              alt="ACOB Lighting Logo"
              className="birthday-logo"
              style={{
                height: "38px",
                width: "auto",
                marginBottom: "0.5rem",
              }}
            />
          </div>
          <div className="birthday-kicker">
            <Sparkles className="h-4 w-4" />
            Birthday Spotlight
          </div>

          <div className="birthday-copy-stack">
            <p className="birthday-overline">Celebrating our colleagues&apos; birthdays</p>
            <h1 className="birthday-title">{celebrantsTitle || "Our Celebrants"}</h1>
            <p className="birthday-subtitle">
              ACOB Family celebrates all of you and appreciates your contributions to the growth of the organisation.
            </p>
          </div>

          <div className="birthday-meta-grid">
            <div className="birthday-meta-card">
              <span className="birthday-meta-label">Celebration Period</span>
              <strong className="birthday-week-range">
                <span>25 May 2026</span>
                <span aria-hidden="true">-</span>
                <span>4 July 2026</span>
              </strong>
            </div>
            <div className="birthday-meta-card">
              <span className="birthday-meta-label">Message</span>
              <strong>Wishing you joy, grace, peace, and a beautiful year ahead</strong>
            </div>
          </div>
        </div>

        <div className="birthday-hero__visual">
          {celebrantCount > 0 ? (
            <div className="birthday-grid">
              {celebrants.map((celebrant, index) => (
                <article key={celebrant.displayName + "-" + index} className="birthday-card-item">
                  <div className="birthday-card-photo-wrapper">
                    {celebrant.imageSrc ? (
                      <img
                        src={celebrant.imageSrc}
                        alt={celebrant.displayName}
                        className="birthday-photo"
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          objectPosition: "center",
                        }}
                      />
                    ) : (
                      <div className="birthday-photo-placeholder">
                        <span>{celebrant.displayName.charAt(0)}</span>
                      </div>
                    )}
                    <div className="birthday-photo__veil" aria-hidden="true" />
                  </div>
                  <div className="birthday-photo__content">
                    <div className="birthday-photo__badge">
                      <Stars className="h-3.5 w-3.5" />
                      {celebrant.birthday.split("-").reverse().join("/")}
                    </div>
                    <div className="birthday-card-details">
                      <h3 className="birthday-card-name">{celebrant.displayName}</h3>
                      <p className="birthday-card-dept">{celebrant.department}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">No birthdays in this period</p>
          )}
        </div>
      </section>
    </main>
  )
}
