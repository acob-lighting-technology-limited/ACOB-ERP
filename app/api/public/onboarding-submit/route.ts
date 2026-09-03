import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { z } from "zod"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { checkRequestSize } from "@/lib/api/request-size"
import { sendNotificationEmail } from "@/lib/notifications/email-gateway"
import { ORG_EMAIL_SENDERS, ORG_MAIL_ROUTING, ORG_HR_EMAIL } from "@/lib/org-config"
import { renderOnboardingSubmissionEmail } from "@/lib/email-templates/onboarding-submission"
import { formatName } from "@/lib/utils"

const OnboardingSubmitSchema = z.object({
  first_name: z.string().trim().min(2),
  last_name: z.string().trim().min(2),
  other_names: z.string().trim().optional().nullable(),
  gender: z.enum(["male", "female"]),
  date_of_birth: z.string().trim().optional().nullable(),
  department: z.string().trim().optional().nullable(),
  designation: z.string().trim().min(2),
  company_email: z.string().trim().email(),
  personal_email: z.string().trim().email(),
  phone_number: z.string().trim().min(5),
  additional_phone_number: z.string().trim().optional().nullable(),
  residential_address: z.string().trim().min(5),
  office_location: z.string().trim().optional().nullable(),
  status: z.string().trim().default("pending"),
  employment_type: z.enum(["full_time", "part_time", "contract"]).optional().default("full_time"),
  contract_category_code: z.string().trim().optional().nullable(),
  honeypot: z.string().optional().nullable(),
})

export async function POST(req: Request) {
  const rl = await rateLimit(`onboarding-submit:${getClientId(req)}`, { limit: 10, windowSec: 60 })
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const sizeError = checkRequestSize(req)
  if (sizeError) return sizeError

  const body = await req.json().catch(() => null)
  const parsed = OnboardingSubmitSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 })
  }

  if (parsed.data.honeypot) {
    return NextResponse.json({ success: true }, { status: 200 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "System configuration error" }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const personalEmail = parsed.data.personal_email.toLowerCase()
  const companyEmail = parsed.data.company_email.toLowerCase()
  const nowIso = new Date().toISOString()

  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("id")
    .or(`personal_email.eq.${personalEmail},company_email.eq.${companyEmail}`)
    .maybeSingle()
  if (existingProfile?.id) {
    return NextResponse.json(
      { error: "This person already exists in employee records. Contact HR if details need correction." },
      { status: 409 }
    )
  }

  const { data: existingPending, error: pendingError } = await supabase
    .from("pending_users")
    .select("id, status")
    .or(`personal_email.eq.${personalEmail},company_email.eq.${companyEmail}`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (pendingError) {
    return NextResponse.json({ error: pendingError.message }, { status: 500 })
  }

  // Resolve contract category ID if contract
  let contractCategoryId = null
  if (parsed.data.employment_type === "contract" && parsed.data.contract_category_code) {
    const { data: catData } = await supabase
      .from("contract_categories")
      .select("id")
      .eq("code", parsed.data.contract_category_code.toUpperCase())
      .eq("is_active", true)
      .single()
    contractCategoryId = catData?.id || null
  }

  const payload = {
    first_name: formatName(parsed.data.first_name),
    last_name: formatName(parsed.data.last_name),
    other_names: parsed.data.other_names ? formatName(parsed.data.other_names) : null,
    gender: parsed.data.gender,
    date_of_birth: parsed.data.date_of_birth || null,
    department: parsed.data.department || null,
    designation: parsed.data.designation,
    company_email: companyEmail,
    personal_email: personalEmail,
    email: personalEmail,
    phone_number: parsed.data.phone_number,
    additional_phone_number: parsed.data.additional_phone_number || null,
    residential_address: parsed.data.residential_address,
    office_location: parsed.data.office_location || null,
    status: "pending",
    employment_type: parsed.data.employment_type || "full_time",
    contract_category_id: contractCategoryId,
    updated_at: nowIso,
  }

  if (existingPending?.id) {
    if (String(existingPending.status || "").toLowerCase() === "pending") {
      return NextResponse.json({ error: "An application for this person is already pending review." }, { status: 409 })
    }

    const { error: updateError } = await supabase.from("pending_users").update(payload).eq("id", existingPending.id)
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }
    // Notify HR department of the updated submission in the background
    void notifyHROfSubmission(supabase, parsed.data, personalEmail)
    return NextResponse.json({ success: true, reused: true })
  }

  const { error: insertError } = await supabase.from("pending_users").insert([
    {
      ...payload,
      created_at: nowIso,
    },
  ])
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  // Notify HR department of the new submission in the background
  void notifyHROfSubmission(supabase, parsed.data, personalEmail)
  return NextResponse.json({ success: true, reused: false })
}

interface DepartmentEmailRow {
  email: string | null
}

async function notifyHROfSubmission(
  supabase: SupabaseClient<any, any, any>,
  applicant: z.infer<typeof OnboardingSubmitSchema>,
  personalEmail: string
) {
  try {
    // Resolve HR department official email, falling back to ORG_HR_EMAIL
    const { data: hrDept } = (await supabase
      .from("departments")
      .select("email")
      .or("name.eq.Admin and HR,department_code.eq.HR")
      .eq("is_active", true)
      .maybeSingle()) as { data: DepartmentEmailRow | null }

    const hrEmail = (hrDept?.email || ORG_HR_EMAIL || "").trim().toLowerCase()
    if (!hrEmail || !hrEmail.includes("@")) return

    const subject = `Onboarding Form Submitted — ${applicant.first_name} ${applicant.last_name}`
    const html = renderOnboardingSubmissionEmail({
      applicant: {
        first_name: applicant.first_name,
        last_name: applicant.last_name,
        department: applicant.department,
        designation: applicant.designation,
        personal_email: personalEmail,
        phone_number: applicant.phone_number,
        employment_type: applicant.employment_type,
        contract_category_code: applicant.contract_category_code,
      },
    })

    await sendNotificationEmail({
      from: ORG_EMAIL_SENDERS.system,
      ...ORG_MAIL_ROUTING.Onboarding,
      to: [hrEmail],
      subject,
      html,
    })
  } catch (err) {
    console.error("Failed to notify HR of onboarding submission:", err)
  }
}
