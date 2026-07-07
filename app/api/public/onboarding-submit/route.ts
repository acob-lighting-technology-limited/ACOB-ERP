import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { z } from "zod"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { checkRequestSize } from "@/lib/api/request-size"
import { sendNotificationEmail } from "@/lib/notifications/email-gateway"

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
    first_name: parsed.data.first_name,
    last_name: parsed.data.last_name,
    other_names: parsed.data.other_names || null,
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
    // Notify admin & HR lead of the updated submission in the background
    void notifyAdminsOfSubmission(supabase, parsed, personalEmail)
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

  // Notify admin & HR lead of the new submission in the background
  void notifyAdminsOfSubmission(supabase, parsed, personalEmail)
  return NextResponse.json({ success: true, reused: false })
}

async function notifyAdminsOfSubmission(supabase: any, parsed: any, personalEmail: string) {
  try {
    const { data: adminProfiles } = await supabase
      .from("profiles")
      .select("company_email, additional_email")
      .in("role", ["admin", "super_admin"])
      .eq("employment_status", "active")

    const { data: hrProfiles } = await supabase
      .from("profiles")
      .select("company_email, additional_email")
      .contains("admin_domains", ["hr"])
      .eq("employment_status", "active")

    const { data: hrDeptLeads } = await supabase
      .from("profiles")
      .select("company_email, additional_email")
      .eq("is_department_lead", true)
      .eq("employment_status", "active")
      .or("department.ilike.%hr%,department.ilike.%human resources%,department.ilike.%people%")

    const recipientEmails = new Set<string>()
    const addEmails = (list: any[] | null) => {
      if (!list) return
      list.forEach((p) => {
        if (p.company_email) recipientEmails.add(p.company_email.trim().toLowerCase())
        if (p.additional_email) recipientEmails.add(p.additional_email.trim().toLowerCase())
      })
    }

    addEmails(adminProfiles)
    addEmails(hrProfiles)
    addEmails(hrDeptLeads)

    const toList = Array.from(recipientEmails).filter((email) => email.includes("@"))

    if (toList.length > 0) {
      const htmlBody = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #0f172a; margin-top: 0;">New Onboarding Submission</h2>
          <p>A new employee onboarding form has been submitted and is pending review.</p>
          
          <div style="background-color: #f8fafc; padding: 15px; border-radius: 6px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #1e293b; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em;">Applicant Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 6px 0; color: #64748b; font-size: 14px; width: 140px;"><strong>Name:</strong></td>
                <td style="padding: 6px 0; color: #0f172a; font-size: 14px;">${parsed.data.first_name} ${parsed.data.last_name}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #64748b; font-size: 14px;"><strong>Department:</strong></td>
                <td style="padding: 6px 0; color: #0f172a; font-size: 14px;">${parsed.data.department || "N/A"}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #64748b; font-size: 14px;"><strong>Designation:</strong></td>
                <td style="padding: 6px 0; color: #0f172a; font-size: 14px;">${parsed.data.designation}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #64748b; font-size: 14px;"><strong>Personal Email:</strong></td>
                <td style="padding: 6px 0; color: #0f172a; font-size: 14px;">${personalEmail}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #64748b; font-size: 14px;"><strong>Phone Number:</strong></td>
                <td style="padding: 6px 0; color: #0f172a; font-size: 14px;">${parsed.data.phone_number}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #64748b; font-size: 14px;"><strong>Employment Type:</strong></td>
                <td style="padding: 6px 0; color: #0f172a; font-size: 14px;">${parsed.data.employment_type.replace("_", " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}</td>
              </tr>
            </table>
          </div>
          
          <p>Please log in to the admin console to review and approve the candidate.</p>
          
          <div style="margin-top: 25px; border-top: 1px solid #e2e8f0; padding-top: 15px;">
            <a href="${process.env.NEXT_PUBLIC_PORTAL_URL || "https://acob-erp.vercel.app"}/admin/hr/employees" 
               style="display: inline-block; background-color: #0284c7; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 14px;">
              Review Application
            </a>
          </div>
        </div>
      `

      for (const recipient of toList) {
        try {
          await sendNotificationEmail({
            to: [recipient],
            subject: `New Onboarding Form Submitted - ${parsed.data.first_name} ${parsed.data.last_name}`,
            html: htmlBody,
          })
        } catch (emailErr) {
          console.error(`Failed to send onboarding notification to ${recipient}:`, emailErr)
        }
      }
    }
  } catch (err) {
    console.error("Failed to notify admins of onboarding submission:", err)
  }
}
