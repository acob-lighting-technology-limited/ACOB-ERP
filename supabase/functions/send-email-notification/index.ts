import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0"
import { canEdgeUserReceiveEmail, sendEdgeNotificationEmail } from "../_shared/notification-gateway.ts"
import { normalizeAssetMailEventType, resolveAssetMailRecipientContext } from "../_shared/asset-mail-resolver.ts"
import { EDGE_MAIL_ROUTING, EDGE_SENDERS } from "../_shared/senders.ts"
const EMAIL_HEADER_LOGO_SRC = "https://matrix.acoblighting.com/images/acob-logo-dark.png"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
// Static shared-secret fallbacks (DB_TRIGGER_SECRET / LEGACY_TRIGGER_SECRET) were
// removed: their values were leaked in repo migrations. Auth is now the
// service-role bearer (which all live DB callers send) or the WEBHOOK_SECRET env
// value only.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}
const ICT_SUPPORT_EMAIL = Deno.env.get("ICT_SUPPORT_EMAIL") || "ict@acoblighting.com"

type AssetNotificationPayload = {
  asset_code?: string
  unique_code?: string
  mail_audience?: string
  oversight_target_role?: string
  assigned_employee_name?: string
  assigned_employee_department?: string
  assigned_employee_email?: string
  assigned_date?: string
  assigned_at?: string
  transfer_date?: string
  return_date?: string
  date?: string
  assigned_by?: string
  actor_id?: string
  status_action?: string
  resolution_note?: string
  status_description?: string
  reported_by?: string
  authorized_by?: string
  condition?: string
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  try {
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!)
    const webhookSecret = Deno.env.get("WEBHOOK_SECRET")
    const signature = req.headers.get("x-webhook-secret")
    const authHeader = req.headers.get("Authorization")

    // Auth Check
    const bearerToken = authHeader?.replace("Bearer ", "")
    const isServiceRole = bearerToken === SUPABASE_SERVICE_ROLE_KEY
    const isSecretValid = Boolean(webhookSecret && signature === webhookSecret)

    if (!isServiceRole && !isSecretValid) {
      console.error(
        `[AUTH FAIL] sig="${signature?.slice(0, 10) ?? "none"}" webhook="${webhookSecret?.slice(0, 10) ?? "UNSET"}" bearer_match=${isServiceRole}`
      )
      return new Response("Unauthorized", { status: 401 })
    }

    console.log(`[INFO] Received notification request. Type: ${req.headers.get("Content-Type")}`)

    const payload = await req.json()
    const record = payload.record
    if (!record?.user_id) return new Response("Missing user_id", { status: 200 })

    let notificationData: unknown = {}
    try {
      notificationData = typeof record.data === "string" ? JSON.parse(record.data) : record.data || {}
    } catch {
      console.warn("[WARN] Failed to parse record.data, using empty object")
    }
    const notificationPayload = (notificationData ?? {}) as AssetNotificationPayload
    const assetCode = notificationPayload.asset_code || notificationPayload.unique_code

    // 1. Resolve recipient context from a single resolver
    const recipientContext = await resolveAssetMailRecipientContext(supabase, record.user_id)
    if (!recipientContext) {
      console.log(`[INFO] Skipping notification for inactive recipient ${record.user_id}`)
      return new Response("Recipient is not active", { status: 200 })
    }

    const { recipientEmails, recipientName, recipientFirstName, recipientDept } = recipientContext
    if (recipientEmails.length === 0) return new Response("User has no recipient email", { status: 200 })

    const canReceiveEmail = await canEdgeUserReceiveEmail(supabase, record.user_id, "assets")
    if (!canReceiveEmail) {
      console.log(`[INFO] Asset email disabled by policy/preferences for recipient ${record.user_id}`)
      return new Response("Recipient email disabled by preference/policy", { status: 200 })
    }

    // Asset mail sends under the single org identity like every other automated
    // notification; replies route to the ICT mailbox via EDGE_MAIL_ROUTING.
    const assetEmailSender = EDGE_SENDERS.system

    const mailAudience = notificationPayload.mail_audience === "oversight" ? "oversight" : "assignee"
    const oversightTargetRole = notificationPayload.oversight_target_role || "Oversight Recipient"
    const assignedEmployeeName = notificationPayload.assigned_employee_name || recipientName
    const assignedEmployeeDepartment = notificationPayload.assigned_employee_department || recipientDept
    const assignedEmployeeEmail = notificationPayload.assigned_employee_email || recipientEmails.join(", ")

    // 2. Fetch Asset & Assignment Data
    let assetType = "Asset"
    let assetModel = "N/A"
    let serialNumber = "N/A"
    let assignedByName = "System Admin"
    const rawEventDate =
      notificationPayload.assigned_date ||
      notificationPayload.assigned_at ||
      notificationPayload.transfer_date ||
      notificationPayload.return_date ||
      notificationPayload.date ||
      record.created_at ||
      null
    const parsedEventDate = rawEventDate ? new Date(rawEventDate) : null
    const assignedDate =
      parsedEventDate && !isNaN(parsedEventDate.getTime())
        ? parsedEventDate.toLocaleDateString("en-GB")
        : new Date().toLocaleDateString("en-GB")

    if (assetCode) {
      const { data: assetData } = await supabase
        .from("assets")
        .select("asset_type, asset_model, serial_number, asset_name")
        .eq("unique_code", assetCode)
        .single()

      if (assetData) {
        // Get Friendly Label for Type
        const { data: typeData } = await supabase
          .from("asset_types")
          .select("label")
          .eq("code", assetData.asset_type)
          .single()
        assetType = typeData?.label || assetData.asset_type || "Asset"
        assetModel = assetData.asset_model || "N/A"
        serialNumber = assetData.serial_number || "N/A"
      }

      // Try fetch specific assignment if possible
      if (notificationPayload.assigned_by || notificationPayload.actor_id) {
        const actorId = notificationPayload.assigned_by || notificationPayload.actor_id

        // If it's a UUID, fetch the name. If it's already a name, use it.
        const isUuid = typeof actorId === "string" && actorId.length === 36 && actorId.includes("-")

        if (isUuid) {
          const { data: actorProfile } = await supabase.from("profiles").select("full_name").eq("id", actorId).single()
          if (actorProfile) {
            assignedByName = actorProfile.full_name
          }
        } else if (actorId) {
          assignedByName = actorId
        }
      }
    }

    // 3. Configure Email Content based on Type
    const rawEmailType = String(record.type || "asset_assigned")
    const emailType = normalizeAssetMailEventType(rawEmailType)
    if (!emailType) {
      console.log(`[INFO] Skipping unsupported asset event type: ${rawEmailType}`)
      return new Response("Unsupported asset event type", { status: 200 })
    }
    const statusAction = String(notificationPayload.status_action || "").toLowerCase()
    const statusIsResolved =
      rawEmailType === "asset_status_fixed" ||
      rawEmailType === "system_restored" ||
      statusAction.includes("resolved") ||
      statusAction.includes("restored")

    console.log(
      `Processing ${emailType} (${rawEmailType}) for ${recipientEmails.join(", ")}. Assigner: ${assignedByName}`
    )

    let subject = "Asset Notification"
    let title = "Asset Notification"
    let introText = "You have a new asset notification."
    let headerText = "Details"
    let headerColorClass = "status-header-neutral"
    const supportText = `If you experience any issue, please contact <br><a href="mailto:${ICT_SUPPORT_EMAIL}">${ICT_SUPPORT_EMAIL}</a>`

    if (mailAudience === "oversight") {
      switch (emailType) {
        case "asset_status_alert":
          if (statusIsResolved) {
            subject = `Asset Status Restored — ${assetCode}`
            title = "Asset Status Restored Notice"
            introText = `This is to notify you that an asset assigned to <strong>${assignedEmployeeName}</strong> has been restored to operational status. You are receiving this copy as ${oversightTargetRole}.`
            headerText = "Status Restored Oversight Details"
            headerColorClass = "status-header-success"
          } else {
            subject = `Asset Status Alert — ${assetCode}`
            title = "Asset Status Alert Notice"
            introText = `This is to notify you that an asset assigned to <strong>${assignedEmployeeName}</strong> has a reported issue. You are receiving this copy as ${oversightTargetRole}.`
            headerText = "Status Alert Oversight Details"
            headerColorClass = "status-header-alert"
          }
          break
        case "asset_returned":
          subject = `Asset Returned — ${assetCode}`
          title = "Asset Return Notice"
          introText = `This is to notify you that an asset assigned to <strong>${assignedEmployeeName}</strong> has been returned/unassigned. You are receiving this copy as ${oversightTargetRole}.`
          headerText = "Return Oversight Details"
          headerColorClass = "status-header-neutral"
          break
        case "asset_transfer_outgoing":
          subject = `Asset Transferred — ${assetCode}`
          title = "Asset Transfer Notice"
          introText = `This is to notify you that an organizational asset has been transferred out from <strong>${assignedEmployeeName}</strong>. You are receiving this copy as ${oversightTargetRole}.`
          headerText = "Transfer Oversight Details"
          headerColorClass = "status-header-neutral"
          break
        case "asset_transfer_incoming":
          subject = `Asset Transferred — ${assetCode}`
          title = "Asset Transfer Notice"
          introText = `This is to notify you that an organizational asset has been transferred to <strong>${assignedEmployeeName}</strong>. You are receiving this copy as ${oversightTargetRole}.`
          headerText = "Transfer Oversight Details"
          headerColorClass = "status-header-success"
          break
        default:
          subject = `Asset Assigned — ${assetCode}`
          title = "Asset Assignment Notice"
          introText = `This is to notify you that an organizational asset has been assigned to <strong>${assignedEmployeeName}</strong>. You are receiving this copy as ${oversightTargetRole}.`
          headerText = "Oversight Details"
          headerColorClass = "status-header-neutral"
          break
      }
    } else {
      switch (emailType) {
        case "asset_assigned":
          subject = `Asset Assigned — ${assetCode}`
          title = "Asset Officially Assigned"
          introText =
            "This is to officially notify you that an organizational asset has been assigned to you. Kindly review the details below."
          headerText = "Assignment Details"
          headerColorClass = "status-header-neutral"
          break

        case "asset_transfer_outgoing":
          subject = `Asset Transferred Out — ${assetCode}`
          title = "Asset Transfer Initiated"
          introText = "This asset has been transferred from your custody. It is no longer assigned to your account."
          headerText = "Transfer Details"
          headerColorClass = "status-header-neutral"
          break

        case "asset_transfer_incoming":
          subject = `Asset Transferred To You — ${assetCode}`
          title = "Asset Transfer Received"
          introText = "An asset has been transferred to your custody. You are now responsible for this item."
          headerText = "Incoming Transfer"
          headerColorClass = "status-header-success"
          break

        case "asset_returned":
          subject = `Asset Returned — ${assetCode}`
          title = "Asset Officially Returned"
          introText =
            "We confirm that you have returned the following asset. It has been successfully unassigned from your account."
          headerText = "Return Receipt"
          headerColorClass = "status-header-neutral"
          break

        case "asset_status_alert":
          if (statusIsResolved) {
            subject = `Asset Status Restored — ${assetCode}`
            title = "Asset Status Restored"
            introText = "The following asset has been repaired and is now fully <strong>OPERATIONAL</strong>."
            headerText = "Status Change: Operational"
            headerColorClass = "status-header-success"
          } else {
            subject = `Asset Status Alert — ${assetCode}`
            title = "Asset Status Alert"
            introText = `The status of the following asset has been updated to <strong>${(notificationPayload.status_action || "REPORTED").toUpperCase()}</strong>.`
            headerText = "Status Change: Alert"
            headerColorClass = "status-header-alert"
          }
          break
      }
    }

    // 4. Construct HTML
    const row = (label: string, value: string, isCode = false) => {
      const displayValue = isCode ? `<span class="asset-code">${value}</span>` : value
      return `
        <tr>
            <td class="label">${label}</td>
            <td class="value">
                ${displayValue}
            </td>
        </tr>`
    }

    // Base rows for ALL emails
    let tableRows =
      mailAudience === "oversight"
        ? `
        ${row("Recipient Role", oversightTargetRole)}
        ${row("Assigned Employee", assignedEmployeeName)}
        ${row("Employee Department", assignedEmployeeDepartment)}
        ${row("Employee Email", assignedEmployeeEmail)}
        ${row("Asset Code", assetCode || "N/A", true)}
        ${row("Asset Type", assetType)}
        ${row("Model", assetModel)}
        ${row("Serial Number", serialNumber)}
    `
        : `
        ${row("Asset Code", assetCode || "N/A", true)}
        ${row("Asset Type", assetType)}
        ${row("Model", assetModel)}
        ${row("Serial Number", serialNumber)}
        ${row("Assigned To", recipientName)}
        ${row("Department", recipientDept)}
    `

    // Specific rows appended after base rows
    if (emailType === "asset_transfer_outgoing") {
      tableRows += row("Authorized By", notificationPayload.authorized_by || assignedByName)
      tableRows += row("Transfer Date", assignedDate)
    } else if (emailType === "asset_transfer_incoming") {
      tableRows += row("Condition", notificationPayload.condition || "Good / Working")
      tableRows += row("Assigned By", assignedByName)
      tableRows += row("Assigned Date", assignedDate)
    } else if (emailType === "asset_returned") {
      tableRows += row("Returned By", recipientName)
      tableRows += row("Authorized By", notificationPayload.authorized_by || assignedByName)
      tableRows += row("Return Date", assignedDate)
    } else if (emailType === "asset_status_alert") {
      if (statusIsResolved) {
        tableRows += row("Resolution Note", notificationPayload.resolution_note || "Issue Resolved")
      } else {
        tableRows += row(
          "Status Note",
          notificationPayload.status_description || notificationPayload.status_action || "Updated"
        )
        tableRows += row("Reported By", notificationPayload.reported_by || assignedByName)
      }
      tableRows += row("Date", assignedDate)
    } else {
      // Default: Initial Assignment
      tableRows += row("Assigned By", assignedByName)
      tableRows += row("Assigned Date", assignedDate)
    }

    const emailHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body { margin: 0; padding: 0; background: #fff; font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif; }
        .email-shell { max-width: 600px; margin: 0 auto; overflow: hidden; }
        .wrapper { max-width: 600px; margin: 0 auto; background: #fff; padding: 32px 28px; }
        .title { font-size: 24px; font-weight: 700; color: #111827; margin-bottom: 14px; }
        .text { font-size: 15px; color: #374151; line-height: 1.6; margin: 0 0 18px 0; }
        .card { margin-top: 22px; border: 1px solid #d1d5db; overflow: hidden; background: #f9fafb; }
        .card-header { padding: 12px 18px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; border-bottom: 1px solid #d1d5db; }
        .status-header-success { background: #dcfce7; color: #166534; border-bottom-color: #bbf7d0; }
        .status-header-alert { background: #fee2e2; color: #991b1b; border-bottom-color: #fecaca; }
        .status-header-neutral { background: #eff6ff; color: #1e40af; border-bottom-color: #bfdbfe; }
        table { width: 100%; border-collapse: collapse; }
        td { padding: 12px 18px; font-size: 14px; border-bottom: 1px solid #d1d5db; }
        tr:last-child td { border-bottom: none; }
        .label { width: 40%; color: #4b5563; font-weight: 500; border-right: 1px solid #d1d5db; }
        .value { color: #111827; font-weight: 600; }
        .asset-code { background: #000; color: #fff; font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif; padding: 4px 8px; border-radius: 4px; font-size: 12px; letter-spacing: .5px; }
        .cta { text-align: center; margin-top: 32px; }
        .button { display: inline-block; background: #000; color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-weight: 600; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; }
        .support { text-align: center; font-size: 14px; color: #4b5563; margin-top: 24px; line-height: 1.5; }
        .support a { color: #16a34a; font-weight: 600; text-decoration: none; }
    </style>
</head>
<body>
    <div class="email-shell">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;mso-line-height-rule:exactly;">
        <tr><td align="center" style="padding:20px 0;background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;">
            <img src="${EMAIL_HEADER_LOGO_SRC}" height="65" alt="ACOB Lighting">
        </td></tr>
    </table>
    <div class="wrapper">
        <div class="title" style="${emailType === "asset_status_alert" ? (statusIsResolved ? "color: #166534;" : "color: #991b1b;") : emailType === "asset_transfer_incoming" ? "color: #166534;" : ""}">
            ${title}
        </div>
        <p class="text">Dear ${recipientFirstName},</p>
        <p class="text">${introText}</p>
        <div class="card">
            <div class="card-header ${headerColorClass}">${headerText}</div>
            <table>
                ${tableRows}
            </table>
        </div>

        <div class="support">${supportText}</div>
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;mso-line-height-rule:exactly;">
        <tr><td align="center" style="padding:20px;background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;font-size:11px;color:#d1d5db;">
            <span style="color:#f3f4f6;">Prepared by IT &amp; Communications</span><br>
            ICT Support Team<br>
            IT &amp; Communications Department<br>
            <strong style="color:#fff;">ACOB Lighting Technology Limited</strong><br>
            <span style="color:#16a34a;font-weight:600;">Asset Management System</span>
            <br><br>
            <i style="color:#9ca3af;">This is an automated notification, but replies are read — reply to this email and it reaches the team that sent it.</i>
        </td></tr>
    </table>
    </div>
</body>
</html>`

    await sendEdgeNotificationEmail({
      to: recipientEmails,
      subject,
      html: emailHtml,
      moduleName: "Assets",
      from: assetEmailSender,
      ...EDGE_MAIL_ROUTING.assets,
    })

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    })
  } catch (err: unknown) {
    console.error("Global Error:", err)
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    })
  }
})
