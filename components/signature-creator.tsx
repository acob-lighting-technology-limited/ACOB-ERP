"use client"
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Copy } from "lucide-react"
import { toast } from "sonner"
import {
  PHONE_ICON,
  MAIL_ICON,
  WEB_ICON,
  ACOB_LOGO,
  LINKEDIN_ICON,
  X_ICON,
  FACEBOOK_ICON,
  INSTAGRAM_ICON,
  ANNIVERSARY_LOGO,
} from "@/lib/signature-assets"

interface SignatureCreatorProps {
  profile: {
    first_name?: string | null
    other_names?: string | null
    last_name?: string | null
    designation?: string | null
    phone_number?: string | null
    additional_phone?: string | null
    company_email?: string | null
    additional_email?: string | null
  } | null
  authEmail?: string | null
  variant?: "default" | "anniversary" | "anniversary-hosted" | "selectable"
  defaultSelectableMode?: "default" | "anniversary" | "anniversary-hosted"
}

interface FormData {
  firstName: string
  middleName: string
  lastName: string
  companyRole: string
  phoneNumber: string
  companyEmail: string
  alternativeEmail: string
}

type PhoneContactOrder = "main-first" | "office-first"
type EmailContactOrder = "main-first" | "alternative-first"

const ANNIVERSARY_FONT_OPTIONS = [
  {
    id: "trebuchet",
    label: "Trebuchet",
    value: "'Trebuchet MS', Arial, sans-serif",
  },
] as const

const ANNIVERSARY_TEMPLATE_OPTIONS = [{ id: "minimal", label: "Template 7" }] as const

/** Absolute base URL used when generating "hosted images" anniversary signatures.
 *  Falls back to a relative root so signatures still render in dev/preview. */
const HOSTED_IMAGES_BASE = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "")
const OFFICE_PHONE_NUMBER_VALUE = "+2347049202634"
const OFFICE_PHONE_NUMBER_LABEL = "+234 704 920 2634"
const OFFICE_EMAIL = "info@acoblighting.com"

const normalizePreferredCompanyEmail = (email?: string | null) => {
  const normalizedEmail = email?.trim().toLowerCase() || ""
  return normalizedEmail
}

const buildCompanyEmailFallback = (firstName: string, lastName: string) => {
  const normalizedFirstName = firstName.trim().toLowerCase().replace(/\s+/g, "")
  const normalizedLastName = lastName.trim().toLowerCase()

  if (!normalizedFirstName || !normalizedLastName) {
    return ""
  }

  return `${normalizedLastName.charAt(0)}.${normalizedFirstName}@org.acoblighting.com`
}

export function SignatureCreator({
  profile,
  authEmail,
  variant = "default",
  defaultSelectableMode = "default",
}: SignatureCreatorProps) {
  const preferredCompanyEmail =
    normalizePreferredCompanyEmail(authEmail) ||
    normalizePreferredCompanyEmail(profile?.company_email) ||
    buildCompanyEmailFallback(profile?.first_name || "", profile?.last_name || "")

  const [formData, setFormData] = useState<FormData>({
    firstName: profile?.first_name || "",
    middleName: profile?.other_names || "",
    lastName: profile?.last_name || "",
    companyRole: profile?.designation || "",
    phoneNumber: profile?.phone_number || "",
    companyEmail: preferredCompanyEmail,
    alternativeEmail: profile?.additional_email || "",
  })

  const [emailError, setEmailError] = useState("")
  const [phoneError, setPhoneError] = useState("")
  const [alternativeEmailError, setAlternativeEmailError] = useState("")
  const [selectedAnniversaryFont] = useState<(typeof ANNIVERSARY_FONT_OPTIONS)[number]["value"]>(
    ANNIVERSARY_FONT_OPTIONS[0].value
  )
  const [selectedAnniversaryTemplate, setSelectedAnniversaryTemplate] =
    useState<(typeof ANNIVERSARY_TEMPLATE_OPTIONS)[number]["id"]>("minimal")
  const [selectedSignatureMode, setSelectedSignatureMode] = useState<"default" | "anniversary" | "anniversary-hosted">(
    defaultSelectableMode
  )
  const [phoneContactOrder, setPhoneContactOrder] = useState<PhoneContactOrder>("main-first")
  const [emailContactOrder, setEmailContactOrder] = useState<EmailContactOrder>("main-first")

  useEffect(() => {
    if (!formData.companyEmail.trim()) {
      const fallbackEmail = buildCompanyEmailFallback(formData.firstName, formData.lastName)

      if (fallbackEmail) {
        setFormData((prev) => ({ ...prev, companyEmail: fallbackEmail }))
      }
    }
  }, [formData.companyEmail, formData.firstName, formData.lastName])

  const formatPhoneNumber = (phone: string) => {
    const digits = phone.replace(/\D/g, "")

    if (digits.startsWith("0") && digits.length === 11) {
      const withoutLeadingZero = digits.substring(1)
      return `+234 ${withoutLeadingZero.substring(
        0,
        3
      )} ${withoutLeadingZero.substring(3, 6)} ${withoutLeadingZero.substring(6)}`
    }

    return phone
  }

  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(email)
  }

  const validateAlternativeEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(email)
  }

  const validatePhone = (phone: string) => {
    const digits = phone.replace(/\D/g, "")
    return digits.length >= 11
  }

  const formatNameProperly = (name: string) => {
    if (!name) return ""
    // Split by spaces first to preserve word boundaries
    return name
      .split(/\s+/)
      .map((word) => {
        // For each word, handle hyphens separately
        return word
          .split(/-/)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
          .join("-")
      })
      .join(" ")
  }

  const buildContactSequence = (sections: string[]) => {
    if (sections.length === 0) {
      return ""
    }

    const [firstSection, ...restSections] = sections
    return `${firstSection}${restSections
      .map(
        (section) =>
          `<span style="white-space: nowrap;"><span style="color: #6b7280;">&nbsp;|&nbsp;</span>${section}</span>`
      )
      .join("")}`
  }

  const buildPhoneContactHtml = (formattedPhone: string) => {
    const primaryPhoneHref = formData.phoneNumber.replace(/\s+/g, "")
    const officePhoneHref = OFFICE_PHONE_NUMBER_VALUE.replace(/\s+/g, "")
    const primaryPhoneSection = `<a href="tel:${primaryPhoneHref}" style="color: #1f2937; text-decoration: none; vertical-align: middle;">${formattedPhone}</a>`
    const officePhoneSection = `<a href="tel:${officePhoneHref}" style="color: #1f2937; text-decoration: none; vertical-align: middle;">${OFFICE_PHONE_NUMBER_LABEL}</a>`

    if (phoneContactOrder === "office-first") {
      return buildContactSequence([officePhoneSection, primaryPhoneSection])
    }

    return buildContactSequence([primaryPhoneSection, officePhoneSection])
  }

  const buildEmailContactHtml = () => {
    const primaryEmailSection = `<a href="mailto:${formData.companyEmail}" style="color: #1f2937; text-decoration: none; vertical-align: middle;">${formData.companyEmail}</a>`
    const alternativeEmailSection = formData.alternativeEmail
      ? `<a href="mailto:${formData.alternativeEmail}" style="color: #1f2937; text-decoration: none; vertical-align: middle;">${formData.alternativeEmail}</a>`
      : ""

    if (!alternativeEmailSection) {
      return primaryEmailSection
    }

    if (emailContactOrder === "alternative-first") {
      return buildContactSequence([alternativeEmailSection, primaryEmailSection])
    }

    return buildContactSequence([primaryEmailSection, alternativeEmailSection])
  }

  const buildOfficeEmailContactHtml = () =>
    `<a href="mailto:${OFFICE_EMAIL}" style="color: #1f2937; text-decoration: none; vertical-align: middle;">${OFFICE_EMAIL}</a>`

  const generateDefaultSignature = (fullName: string, formattedPhone: string) => {
    const phoneContactHtml = buildPhoneContactHtml(formattedPhone)
    const emailContactHtml = buildEmailContactHtml()
    const officeEmailContactHtml = buildOfficeEmailContactHtml()

    return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 1000px; margin: 0; padding: 12px 0; line-height: 1.5;">
  <!-- Thin green line -->
  <div style="color: #000000;">&mdash;&mdash;</div>
  
  <!-- Greeting -->
  <p style="margin: 0 0 4px 0; font-size: 14px; color: #374151; font-style: italic;">Best Regards,</p>

  <!-- Name & Role -->
  <div style="border-bottom: 1.5px solid #e5e7eb; padding-bottom: 6px; margin-bottom: 6px;">
    <p style="margin: 0 0 0 0; line-height: 1; font-size: 20px; font-weight: bold; color: #1f2937; letter-spacing: -0.025em;">${fullName}</p>
    <p style="margin: 0 0 10px 0; font-size: 14px; font-weight: 500; color: #1f2937;">${formData.companyRole}</p>
    
    <!-- Contact details -->
    <div style="font-size: 14px; color: #374151; line-height: 1.3;">
      <div style="margin: 0 0 1px 0;">
        <img src="${PHONE_ICON}" width="18" height="18" style="vertical-align: middle; opacity: 0.8; margin-right: 6px; display: inline-block;" alt="Phone" />${phoneContactHtml}
      </div>
      <div style="margin: 0 0 1px 0;">
        <img src="${MAIL_ICON}" width="18" height="18" style="vertical-align: middle; opacity: 0.8; margin-right: 6px; display: inline-block;" alt="Email" />${emailContactHtml}
      </div>
      <div style="margin: 0 0 1px 0;">
        <img src="${MAIL_ICON}" width="18" height="18" style="vertical-align: middle; opacity: 0.8; margin-right: 6px; display: inline-block;" alt="Office Email" />${officeEmailContactHtml}
      </div>
      <div>
        <img src="${WEB_ICON}" width="18" height="18" style="vertical-align: middle; opacity: 0.8; margin-right: 6px; display: inline-block;" alt="Website" /><a href="https://www.acoblighting.com" style="color: #1f2937; text-decoration: none; vertical-align: middle;">www.acoblighting.com</a>
      </div>
    </div>
  </div>
  
  <!-- Logo + Socials (stacked vertically) -->
  <div style="margin-bottom: 8px;">
    <img src="${ACOB_LOGO}" width="200" height="47" alt="ACOB Lighting Technology Limited" style="display: block; margin-bottom: 8px;" />
    
   <div style="display: inline-block;">
  <a href="https://www.linkedin.com/company/acob-lighting-technology-limited" style="text-decoration: none; display: inline-block;"><img src="${LINKEDIN_ICON}" width="22" height="22" alt="LinkedIn" style="border-radius: 4px; display: inline-block;" /></a>
  <a href="https://twitter.com/AcobLimited" style="text-decoration: none; display: inline-block; margin-left: 4px;"><img src="${X_ICON}" width="22" height="22" alt="X (Twitter)" style="border-radius: 4px; display: inline-block;" /></a>
  <a href="https://www.facebook.com/acoblightingtechltd" style="text-decoration: none; display: inline-block; margin-left: 4px;"><img src="${FACEBOOK_ICON}" width="22" height="22" alt="Facebook" style="border-radius: 4px; display: inline-block;" /></a>
  <a href="https://www.instagram.com/acob_lighting/" style="text-decoration: none; display: inline-block; margin-left: 4px;"><img src="${INSTAGRAM_ICON}" width="22" height="22" alt="Instagram" style="border-radius: 4px; display: inline-block;" /></a>
</div>
  </div>
  
  <!-- Footer -->
  <div style="border-top: 1.5px solid #e5e7eb; padding-top: 6px; font-size: 11px; color: #6b7280; line-height: 1.4;">
    <p style="margin: 0 0 6px 0; font-style: italic;">This email, including any attachments, contains confidential information intended solely for the recipient(s) named above. If you have received this email in error, please notify the sender immediately and delete the email from your system. Any unauthorized use, disclosure, distribution, or copying of this email is strictly prohibited and may be unlawful.</p>
    <p style="margin: 0 0 4px 0; font-weight: 600; font-style: italic;">ACOB Lighting Technology Limited is a renewable energy company registered under the Laws of the Federal Republic of Nigeria.</p>
    <p style="margin: 0 0 2px 0; font-weight: 600; font-style: italic;">We are a leading provider of solar and energy solutions for homes, businesses, and communities.</p>
    <p style="margin: 0; font-weight: 600; font-style: italic;">Lighting up Nigeria!</p>
  </div>
</div>`
  }

  const generateAnniversarySignature = (fullName: string, formattedPhone: string) => {
    const phoneContactHtml = buildPhoneContactHtml(formattedPhone)
    const emailContactHtml = buildEmailContactHtml()
    const officeEmailContactHtml = buildOfficeEmailContactHtml()

    const contactBlock = `<div style="font-size: 14px; color: #374151; line-height: 1.35;">
  <div style="margin: 0 0 1px 0;">
    <img src="${PHONE_ICON}" width="18" height="18" style="vertical-align: middle; opacity: 0.8; margin-right: 6px; display: inline-block;" alt="Phone" />${phoneContactHtml}
  </div>
  <div style="margin: 0 0 1px 0;">
    <img src="${MAIL_ICON}" width="18" height="18" style="vertical-align: middle; opacity: 0.8; margin-right: 6px; display: inline-block;" alt="Email" />${emailContactHtml}
  </div>
  <div style="margin: 0 0 1px 0;">
    <img src="${MAIL_ICON}" width="18" height="18" style="vertical-align: middle; opacity: 0.8; margin-right: 6px; display: inline-block;" alt="Office Email" />${officeEmailContactHtml}
  </div>
  <div>
    <img src="${WEB_ICON}" width="18" height="18" style="vertical-align: middle; opacity: 0.8; margin-right: 6px; display: inline-block;" alt="Website" /><a href="https://www.acoblighting.com" style="color: #1f2937; text-decoration: none; vertical-align: middle;">www.acoblighting.com</a>
  </div>
</div>`

    const mutedSocialIconStyle =
      "border-radius: 4px; display: inline-block; filter: brightness(0.9) saturate(0.92); opacity: 0.92;"

    const socialBlock = `<div style="display: inline-block;">
  <a href="https://www.linkedin.com/company/acob-lighting-technology-limited" style="text-decoration: none; display: inline-block;"><img src="${LINKEDIN_ICON}" width="22" height="22" alt="LinkedIn" style="${mutedSocialIconStyle}" /></a>
  <a href="https://twitter.com/AcobLimited" style="text-decoration: none; display: inline-block; margin-left: 4px;"><img src="${X_ICON}" width="22" height="22" alt="X (Twitter)" style="${mutedSocialIconStyle}" /></a>
  <a href="https://www.facebook.com/acoblightingtechltd" style="text-decoration: none; display: inline-block; margin-left: 4px;"><img src="${FACEBOOK_ICON}" width="22" height="22" alt="Facebook" style="${mutedSocialIconStyle}" /></a>
  <a href="https://www.instagram.com/acob_lighting/" style="text-decoration: none; display: inline-block; margin-left: 4px;"><img src="${INSTAGRAM_ICON}" width="22" height="22" alt="Instagram" style="${mutedSocialIconStyle}" /></a>
</div>`

    const contactTextBlock = `<div style="font-size: 14px; color: #374151; line-height: 1.45;">
  <div style="margin: 0 0 2px 0;">
    ${phoneContactHtml}
  </div>
  <div style="margin: 0 0 2px 0;">
    ${emailContactHtml}
  </div>
  <div style="margin: 0 0 2px 0;">
    ${officeEmailContactHtml}
  </div>
  <div>
    <a href="https://www.acoblighting.com" style="color: #1f2937; text-decoration: none;">www.acoblighting.com</a>
  </div>
</div>`

    const socialTextBlock = `<div style="margin-top: 8px; margin-bottom: 12px; font-size: 12px; color: #374151; line-height: 1.5;">
  <a href="https://www.linkedin.com/company/acob-lighting-technology-limited" style="color: #0f5c4d; text-decoration: none;">LinkedIn</a>
  <span style="color: #9ca3af;"> | </span>
  <a href="https://twitter.com/AcobLimited" style="color: #0f5c4d; text-decoration: none;">X</a>
  <span style="color: #9ca3af;"> | </span>
  <a href="https://www.facebook.com/acoblightingtechltd" style="color: #0f5c4d; text-decoration: none;">Facebook</a>
  <span style="color: #9ca3af;"> | </span>
  <a href="https://www.instagram.com/acob_lighting/" style="color: #0f5c4d; text-decoration: none;">Instagram</a>
</div>`

    const anniversaryLogo = `<img src="${ANNIVERSARY_LOGO}" width="250" height="auto" alt="ACOB Lighting Technology Limited 2026 Anniversary Logo" style="display: block;" />`

    const anniversaryNarrative = `<p style="margin: 0 0 5px 0; font-size: 13px; font-weight: 700; color: #0f5c4d;">A decade of purpose, progress, and power.</p>
<p style="margin: 0 0 5px 0; font-size: 12px; color: #374151;">For 10 remarkable years, ACOB Lighting Technology Limited has remained committed to lighting up communities, driving innovation, and creating lasting impact across Nigeria.</p>
<p style="margin: 0 0 5px 0; font-size: 11.5px; color: #4b5563;">From 2016 to 2026, this journey has been one of excellence, growth, and transformation.</p>
<p style="margin: 0; font-size: 11.5px; color: #4b5563;">We celebrate 10 years of impact and look forward to many more years of lighting up lives and shaping a brighter future.</p>`

    const compactNarrative = `<p style="margin: 0 0 5px 0; font-size: 13px; font-weight: 700; color: #0f5c4d;">A decade of purpose, progress, and power.</p>
<p style="margin: 0; font-size: 12px; color: #374151;">From 2016 to 2026, ACOB Lighting Technology Limited has remained committed to lighting up communities, driving innovation, and creating lasting impact across Nigeria.</p>`

    const legalCopyBlock = `<div style="margin-top: 8px; padding-top: 8px; border-top: 0.5px solid #e7dec2;">
  <p style="margin: 0; font-size: 11px; font-weight: 600; color: #7a828e;">ACOB Lighting Technology Limited is a renewable energy company registered under the Laws of the Federal Republic of Nigeria.</p>
</div>`

    const anniversaryFooter = `<div style="border-top: 0.5px solid #e7dec2; padding-top: 8px; font-size: 11px; color: #6b7280; line-height: 1.4;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 0; font-weight: 600; font-style: italic; color: #6b7280; text-align: left;">
        Celebrating 10 Years of Impact &bull; Lighting up Nigeria!
      </td>
      <td style="padding: 0; font-weight: 600; color: #6b7280; text-align: right; white-space: nowrap; vertical-align: top;">
        2016 &ndash; 2026
      </td>
    </tr>
  </table>
  <div style="margin-top: 8px; border-top: 0.5px solid #e7dec2;"></div>
  <p style="margin: 8px 0 0 0; font-size: 10.5px; color: #7a828e; font-style: italic;">This email, including any attachments, contains confidential information intended solely for the recipient(s) named above. If you have received this email in error, please notify the sender immediately and delete the email from your system. Any unauthorized use, disclosure, distribution, or copying of this email is strictly prohibited and may be unlawful.</p>
</div>`

    const executiveAnniversaryFooter = `<div style="border-top: 0.5px solid #e7dec2; padding-top: 8px; font-size: 11px; color: #6b7280; line-height: 1.4;">
  <p style="margin: 0 0 5px 0; font-size: 10.75px; color: #7a828e;">ACOB Lighting Technology Limited is a renewable energy company registered under the Laws of the Federal Republic of Nigeria.</p>
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 0; font-weight: 600; font-style: italic; color: #6b7280; text-align: left;">
        Celebrating 10 Years of Impact &bull; Lighting up Nigeria!
      </td>
      <td style="padding: 0; font-weight: 600; color: #6b7280; text-align: right; white-space: nowrap; vertical-align: top;">
        2016 &ndash; 2026
      </td>
    </tr>
  </table>
  <div style="margin-top: 8px; border-top: 0.5px solid #e7dec2;"></div>
  <p style="margin: 8px 0 0 0; font-size: 10.25px; color: #7a828e; font-style: italic;">This email, including any attachments, contains confidential information intended solely for the recipient(s) named above. If you have received this email in error, please notify the sender immediately and delete the email from your system. Any unauthorized use, disclosure, distribution, or copying of this email is strictly prohibited and may be unlawful.</p>
</div>`

    const renderAnniversaryLayout = (
      body: string
    ) => `<div style="font-family: ${selectedAnniversaryFont}; max-width: 1000px; margin: 0; padding: 12px 0; line-height: 1.5; color: #1f2937;">
  ${body}
</div>`

    const templates: Record<string, string> = {
      classic: renderAnniversaryLayout(`<div style="color: #d4af37;">&mdash;&mdash;</div>
  <p style="margin: 0 0 4px 0; font-size: 14px; color: #4b5563; font-style: italic;">Best Regards,</p>
  <table cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; margin-bottom: 8px;">
    <tr>
      <td style="width: 4px; background: linear-gradient(180deg, #c5a028, #d4af37, #e8c947); border-radius: 4px;" width="4"></td>
      <td style="padding-left: 14px;">
        <p style="margin: 0; line-height: 1; font-size: 20px; font-weight: 700; color: #0f172a; letter-spacing: -0.025em;">${fullName}</p>
        <p style="margin: 0; font-size: 14px; font-weight: 600; color: #0f5c4d;">${formData.companyRole}</p>
      </td>
    </tr>
  </table>
  <div style="margin-bottom: 8px;">${contactBlock}</div>
  <div style="margin: 14px 0 16px 0; border-top: 1px solid #d4af37;"></div>
  <div style="padding: 8px 0 14px 0; border-top: 2px solid #e7dec2; border-bottom: 2px solid #e7dec2;">
    <div style="margin-bottom: 8px;">${anniversaryLogo}</div>
    ${anniversaryNarrative}${legalCopyBlock}
    <div style="margin-top: 8px; margin-bottom: 8px;">${socialBlock}</div>
    ${anniversaryFooter}
  </div>`),
      timeline: renderAnniversaryLayout(`<div style="color: #d4af37;">&mdash;&mdash;</div>
  <p style="margin: 0 0 4px 0; font-size: 14px; color: #4b5563; font-style: italic;">Best Regards,</p>
  <p style="margin: 0; line-height: 1; font-size: 20px; font-weight: 700; color: #0f172a;">${fullName}</p>
  <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #0f5c4d;">${formData.companyRole}</p>
  <div style="margin-bottom: 8px;">${contactBlock}</div>
  <div style="padding: 8px 0 14px 0; border-top: 2px solid #e7dec2; border-bottom: 2px solid #e7dec2;">
    <div style="margin-bottom: 8px;">${anniversaryLogo}</div>
    ${compactNarrative}
    <table cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; width: 100%; margin-bottom: 10px;">
      <tr>
        <td style="width: 56px; text-align: center; vertical-align: top;">
          <p style="margin: 0; font-size: 13px; font-weight: 700; color: #8a6b08;">2016</p>
        </td>
        <td style="vertical-align: top; padding: 0 10px;">
          <div style="margin-top: 7px; border-top: 2px solid #d4af37;"></div>
        </td>
        <td style="width: 56px; text-align: center; vertical-align: top;">
          <p style="margin: 0; font-size: 13px; font-weight: 700; color: #8a6b08;">2026</p>
        </td>
      </tr>
    </table>
    ${legalCopyBlock}
    <div style="margin-top: 8px; margin-bottom: 8px;">${socialBlock}</div>
    ${anniversaryFooter}
  </div>`),
      heritage: renderAnniversaryLayout(`<div style="color: #d4af37;">&mdash;&mdash;</div>
  <p style="margin: 0 0 4px 0; font-size: 14px; color: #4b5563; font-style: italic;">Best Regards,</p>
  <div style="margin-bottom: 10px;">
    <div style="padding-left: 12px; border-left: 3px solid #d4af37;">
      <p style="margin: 0; line-height: 1; font-size: 20px; font-weight: 700; color: #0f172a;">${fullName}</p>
      <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #0f5c4d;">${formData.companyRole}</p>
    </div>
    ${contactBlock}
  </div>
  <div style="padding: 8px 0 14px 0; border-top: 2px solid #e7dec2; border-bottom: 2px solid #e7dec2;">
    <div style="margin-bottom: 8px;">${anniversaryLogo}</div>
    ${anniversaryNarrative}
    ${legalCopyBlock}
    <div style="margin-top: 8px; margin-bottom: 8px;">${socialBlock}</div>
    ${anniversaryFooter}
  </div>`),
      renewal: renderAnniversaryLayout(`<div style="color: #d4af37;">&mdash;&mdash;</div>
  <p style="margin: 0 0 4px 0; font-size: 14px; color: #4b5563; font-style: italic;">Best Regards,</p>
  <p style="margin: 0; line-height: 1; font-size: 20px; font-weight: 700; color: #0f172a;">${fullName}</p>
  <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #0f5c4d;">${formData.companyRole}</p>
  <div style="margin-bottom: 10px;">${contactBlock}</div>
  <div style="padding: 8px 0 14px 0; border-top: 2px solid #e7dec2; border-bottom: 2px solid #e7dec2;">
    <div style="margin-bottom: 8px;">${anniversaryLogo}</div>
    ${compactNarrative}${legalCopyBlock}
    <div style="margin-top: 8px; margin-bottom: 8px;">${socialBlock}</div>
    ${anniversaryFooter}
  </div>`),
      "renewal-accent": renderAnniversaryLayout(`<div style="color: #d4af37;">&mdash;&mdash;</div>
  <p style="margin: 0 0 4px 0; font-size: 14px; color: #4b5563; font-style: italic;">Best Regards,</p>
  <table cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; margin-bottom: 10px;">
    <tr>
      <td style="width: 1px; background: #e7dec2;" width="1"></td>
      <td style="padding-left: 12px;">
        <p style="margin: 0; line-height: 1; font-size: 20px; font-weight: 700; color: #0f172a;">${fullName}</p>
        <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #0f5c4d;">${formData.companyRole}</p>
      </td>
    </tr>
  </table>
  <div style="margin-bottom: 10px;">${contactBlock}</div>
  <div style="padding: 8px 0 14px 0; border-top: 2px solid #e7dec2; border-bottom: 2px solid #e7dec2;">
    <div style="margin-bottom: 8px;">${anniversaryLogo}</div>
    ${compactNarrative}${legalCopyBlock}
    <div style="margin-top: 8px; margin-bottom: 8px;">${socialBlock}</div>
    ${anniversaryFooter}
  </div>`),
      "renewal-executive": renderAnniversaryLayout(`<div style="color: #d4af37;">&mdash;&mdash;</div>
  <p style="margin: 0 0 4px 0; font-size: 14px; color: #4b5563; font-style: italic;">Best Regards,</p>
  <table cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; margin-bottom: 10px;">
    <tr>
      <td style="width: 1px; background: #e7dec2;" width="1"></td>
      <td style="padding-left: 12px;">
        <p style="margin: 0; line-height: 1; font-size: 20px; font-weight: 700; color: #0f172a;">${fullName}</p>
        <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #0f5c4d;">${formData.companyRole}</p>
      </td>
    </tr>
  </table>
  <div style="margin-bottom: 10px;">${contactBlock}</div>
  <div style="padding: 8px 0 14px 0; border-top: 2px solid #e7dec2; border-bottom: 2px solid #e7dec2;">
    <div style="margin-bottom: 8px;">${anniversaryLogo}</div>
    ${compactNarrative}
    <div style="margin-top: 8px; margin-bottom: 8px;">${socialBlock}</div>
    ${executiveAnniversaryFooter}
  </div>`),
      minimal: renderAnniversaryLayout(`<div style="color: #d4af37;">&mdash;&mdash;</div>
  <p style="margin: 0 0 4px 0; font-size: 14px; color: #4b5563; font-style: italic;">Best Regards,</p>
  <p style="margin: 0; line-height: 1; font-size: 20px; font-weight: 700; color: #0f172a;">${fullName}</p>
  <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #0f5c4d;">${formData.companyRole}</p>
  <div style="margin-bottom: 10px;">${contactBlock}</div>
  <div style="padding: 8px 0 14px 0; border-top: 2px solid #e7dec2; border-bottom: 2px solid #e7dec2;">
    <div style="margin-bottom: 8px;">${anniversaryLogo}</div>
    ${compactNarrative}
    <div style="margin-top: 8px; margin-bottom: 12px;">${socialBlock}</div>
    ${anniversaryFooter}
  </div>`),
      "minimal-clean": renderAnniversaryLayout(`<div style="color: #d4af37;">&mdash;&mdash;</div>
  <p style="margin: 0 0 4px 0; font-size: 14px; color: #4b5563; font-style: italic;">Best Regards,</p>
  <p style="margin: 0; line-height: 1; font-size: 20px; font-weight: 700; color: #0f172a;">${fullName}</p>
  <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #0f5c4d;">${formData.companyRole}</p>
  <div style="margin-bottom: 10px;">${contactBlock}</div>
  <div style="padding: 8px 0 14px 0; border-top: 2px solid #e7dec2; border-bottom: 2px solid #e7dec2;">
    <div style="margin-bottom: 8px;">${anniversaryLogo}</div>
    ${compactNarrative}
    <div style="margin-top: 8px; margin-bottom: 12px;">${socialBlock}</div>
    ${anniversaryFooter}
  </div>`),
      "minimal-confidential": renderAnniversaryLayout(`<div style="color: #d4af37;">&mdash;&mdash;</div>
  <p style="margin: 0 0 4px 0; font-size: 14px; color: #4b5563; font-style: italic;">Best Regards,</p>
  <p style="margin: 0; line-height: 1; font-size: 20px; font-weight: 700; color: #0f172a;">${fullName}</p>
  <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #0f5c4d;">${formData.companyRole}</p>
  <div style="margin-bottom: 10px;">${contactBlock}</div>
  <div style="padding: 8px 0 14px 0; border-top: 2px solid #e7dec2; border-bottom: 2px solid #e7dec2;">
    <div style="margin-bottom: 8px;">${anniversaryLogo}</div>
    ${compactNarrative}
    <div style="margin-top: 8px; margin-bottom: 8px;">${socialBlock}</div>
    ${anniversaryFooter}
  </div>`),
      "diagnostic-logo-only": renderAnniversaryLayout(`<div style="color: #d4af37;">&mdash;&mdash;</div>
  <p style="margin: 0 0 4px 0; font-size: 14px; color: #4b5563; font-style: italic;">Best Regards,</p>
  <p style="margin: 0; line-height: 1; font-size: 20px; font-weight: 700; color: #0f172a;">${fullName}</p>
  <p style="margin: 0 0 10px 0; font-size: 14px; font-weight: 600; color: #0f5c4d;">${formData.companyRole}</p>
  <div style="padding: 8px 0 14px 0; border-top: 2px solid #e7dec2; border-bottom: 2px solid #e7dec2;">
    <div style="margin-bottom: 8px;">${anniversaryLogo}</div>
    ${compactNarrative}
    ${anniversaryFooter}
  </div>`),
      "diagnostic-contact-text": renderAnniversaryLayout(`<div style="color: #d4af37;">&mdash;&mdash;</div>
  <p style="margin: 0 0 4px 0; font-size: 14px; color: #4b5563; font-style: italic;">Best Regards,</p>
  <p style="margin: 0; line-height: 1; font-size: 20px; font-weight: 700; color: #0f172a;">${fullName}</p>
  <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #0f5c4d;">${formData.companyRole}</p>
  <div style="margin-bottom: 10px;">${contactTextBlock}</div>
  <div style="padding: 8px 0 14px 0; border-top: 2px solid #e7dec2; border-bottom: 2px solid #e7dec2;">
    <div style="margin-bottom: 8px;">${anniversaryLogo}</div>
    ${compactNarrative}
    ${anniversaryFooter}
  </div>`),
      "diagnostic-social-text": renderAnniversaryLayout(`<div style="color: #d4af37;">&mdash;&mdash;</div>
  <p style="margin: 0 0 4px 0; font-size: 14px; color: #4b5563; font-style: italic;">Best Regards,</p>
  <p style="margin: 0; line-height: 1; font-size: 20px; font-weight: 700; color: #0f172a;">${fullName}</p>
  <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #0f5c4d;">${formData.companyRole}</p>
  <div style="margin-bottom: 10px;">${contactTextBlock}</div>
  <div style="padding: 8px 0 14px 0; border-top: 2px solid #e7dec2; border-bottom: 2px solid #e7dec2;">
    <div style="margin-bottom: 8px;">${anniversaryLogo}</div>
    ${compactNarrative}
    ${socialTextBlock}
    ${anniversaryFooter}
  </div>`),
    }

    return templates[selectedAnniversaryTemplate]
  }

  /** Generates the anniversary signature using publicly hosted image URLs instead of
   *  base64 data-URIs. The layout is identical to generateAnniversarySignature. */
  const generateAnniversaryHostedSignature = (fullName: string, formattedPhone: string) => {
    const base = HOSTED_IMAGES_BASE
    const phoneContactHtml = buildPhoneContactHtml(formattedPhone)
    const emailContactHtml = buildEmailContactHtml()
    const officeEmailContactHtml = buildOfficeEmailContactHtml()

    // Hosted icon URLs
    const PHONE_ICON_URL = `${base}/images/signature/phone-email.png`
    const MAIL_ICON_URL = `${base}/images/signature/mail-email.png`
    const WEB_ICON_URL = `${base}/images/signature/web-email.png`
    const LINKEDIN_ICON_URL = `${base}/images/signature/linkedin-email.png`
    const X_ICON_URL = `${base}/images/signature/x-email.png`
    const FACEBOOK_ICON_URL = `${base}/images/signature/facebook-email.png`
    const INSTAGRAM_ICON_URL = `${base}/images/signature/instagram-email.png`
    const ANNIVERSARY_LOGO_URL = `${base}/images/signature/acob-10th-anniversary-email.jpg`

    const contactBlock = `<div style="font-size: 14px; color: #374151; line-height: 1.35;">
  <div style="margin: 0 0 1px 0;">
    <img src="${PHONE_ICON_URL}" width="18" height="18" style="vertical-align: middle; opacity: 0.8; margin-right: 6px; display: inline-block;" alt="Phone" />${phoneContactHtml}
  </div>
  <div style="margin: 0 0 1px 0;">
    <img src="${MAIL_ICON_URL}" width="18" height="18" style="vertical-align: middle; opacity: 0.8; margin-right: 6px; display: inline-block;" alt="Email" />${emailContactHtml}
  </div>
  <div style="margin: 0 0 1px 0;">
    <img src="${MAIL_ICON_URL}" width="18" height="18" style="vertical-align: middle; opacity: 0.8; margin-right: 6px; display: inline-block;" alt="Office Email" />${officeEmailContactHtml}
  </div>
  <div>
    <img src="${WEB_ICON_URL}" width="18" height="18" style="vertical-align: middle; opacity: 0.8; margin-right: 6px; display: inline-block;" alt="Website" /><a href="https://www.acoblighting.com" style="color: #1f2937; text-decoration: none; vertical-align: middle;">www.acoblighting.com</a>
  </div>
</div>`

    const mutedSocialIconStyle =
      "border-radius: 4px; display: inline-block; filter: brightness(0.9) saturate(0.92); opacity: 0.92;"

    const socialBlock = `<div style="display: inline-block;">
  <a href="https://www.linkedin.com/company/acob-lighting-technology-limited" style="text-decoration: none; display: inline-block;"><img src="${LINKEDIN_ICON_URL}" width="22" height="22" alt="LinkedIn" style="${mutedSocialIconStyle}" /></a>
  <a href="https://twitter.com/AcobLimited" style="text-decoration: none; display: inline-block; margin-left: 4px;"><img src="${X_ICON_URL}" width="22" height="22" alt="X (Twitter)" style="${mutedSocialIconStyle}" /></a>
  <a href="https://www.facebook.com/acoblightingtechltd" style="text-decoration: none; display: inline-block; margin-left: 4px;"><img src="${FACEBOOK_ICON_URL}" width="22" height="22" alt="Facebook" style="${mutedSocialIconStyle}" /></a>
  <a href="https://www.instagram.com/acob_lighting/" style="text-decoration: none; display: inline-block; margin-left: 4px;"><img src="${INSTAGRAM_ICON_URL}" width="22" height="22" alt="Instagram" style="${mutedSocialIconStyle}" /></a>
</div>`

    const compactNarrative = `<p style="margin: 0 0 5px 0; font-size: 13px; font-weight: 700; color: #0f5c4d;">A decade of purpose, progress, and power.</p>
<p style="margin: 0; font-size: 12px; color: #374151;">From 2016 to 2026, ACOB Lighting Technology Limited has remained committed to lighting up communities, driving innovation, and creating lasting impact across Nigeria.</p>`

    const anniversaryLogo = `<img src="${ANNIVERSARY_LOGO_URL}" width="250" height="auto" alt="ACOB Lighting Technology Limited 2026 Anniversary Logo" style="display: block;" />`

    const anniversaryFooter = `<div style="border-top: 0.5px solid #e7dec2; padding-top: 8px; font-size: 11px; color: #6b7280; line-height: 1.4;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 0; font-weight: 600; font-style: italic; color: #6b7280; text-align: left;">
        Celebrating 10 Years of Impact &bull; Lighting up Nigeria!
      </td>
      <td style="padding: 0; font-weight: 600; color: #6b7280; text-align: right; white-space: nowrap; vertical-align: top;">
        2016 &ndash; 2026
      </td>
    </tr>
  </table>
  <div style="margin-top: 8px; border-top: 0.5px solid #e7dec2;"></div>
  <p style="margin: 8px 0 0 0; font-size: 10.5px; color: #7a828e; font-style: italic;">This email, including any attachments, contains confidential information intended solely for the recipient(s) named above. If you have received this email in error, please notify the sender immediately and delete the email from your system. Any unauthorized use, disclosure, distribution, or copying of this email is strictly prohibited and may be unlawful.</p>
</div>`

    const renderLayout = (body: string) =>
      `<div style="font-family: ${"Trebuchet MS"}, Arial, sans-serif; max-width: 1000px; margin: 0; padding: 12px 0; line-height: 1.5; color: #1f2937;">
  ${body}
</div>`

    return renderLayout(`<div style="color: #d4af37;">&mdash;&mdash;</div>
  <p style="margin: 0 0 4px 0; font-size: 14px; color: #4b5563; font-style: italic;">Best Regards,</p>
  <p style="margin: 0; line-height: 1; font-size: 20px; font-weight: 700; color: #0f172a;">${fullName}</p>
  <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #0f5c4d;">${formData.companyRole}</p>
  <div style="margin-bottom: 10px;">${contactBlock}</div>
  <div style="padding: 8px 0 14px 0; border-top: 2px solid #e7dec2; border-bottom: 2px solid #e7dec2;">
    <div style="margin-bottom: 8px;">${anniversaryLogo}</div>
    ${compactNarrative}
    <div style="margin-top: 8px; margin-bottom: 12px;">${socialBlock}</div>
    ${anniversaryFooter}
  </div>`)
  }

  const generateSignature = () => {
    const formattedFirstName = formatNameProperly(formData.firstName)
    const formattedMiddleName = formData.middleName ? formatNameProperly(formData.middleName) : ""
    const formattedLastName = formatNameProperly(formData.lastName)

    const fullName = `${formattedFirstName}${
      formattedMiddleName ? " " + formattedMiddleName : ""
    } ${formattedLastName}`.trim()
    const formattedPhone = formatPhoneNumber(formData.phoneNumber)

    const activeVariant = variant === "selectable" ? selectedSignatureMode : variant

    if (activeVariant === "anniversary") {
      return generateAnniversarySignature(fullName, formattedPhone)
    }

    if (activeVariant === "anniversary-hosted") {
      return generateAnniversaryHostedSignature(fullName, formattedPhone)
    }

    return generateDefaultSignature(fullName, formattedPhone)
  }

  const copyToClipboard = async () => {
    const signature = generateSignature()

    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
        const clipboardItem = new ClipboardItem({
          "text/html": new Blob([signature], { type: "text/html" }),
          "text/plain": new Blob([signature], { type: "text/plain" }),
        })

        await navigator.clipboard.write([clipboardItem])
      } else {
        await navigator.clipboard.writeText(signature)
      }

      toast.success("Base64 signature copied to clipboard!")
    } catch {
      toast.error("Failed to copy signature")
    }
  }

  const handleInputChange = (field: keyof FormData, value: string) => {
    if (field === "phoneNumber") {
      const numbersOnly = value.replace(/\D/g, "")
      setFormData((prev) => ({ ...prev, [field]: numbersOnly }))

      if (numbersOnly && !validatePhone(numbersOnly)) {
        setPhoneError("Phone number must be at least 11 digits")
      } else {
        setPhoneError("")
      }
      return
    }

    if (field === "companyEmail") {
      setFormData((prev) => ({ ...prev, [field]: value }))

      if (value && !validateEmail(value)) {
        setEmailError("Enter a valid email")
      } else {
        setEmailError("")
      }
      return
    }

    if (field === "alternativeEmail") {
      setFormData((prev) => ({ ...prev, [field]: value }))

      if (value && !validateAlternativeEmail(value)) {
        setAlternativeEmailError("Enter a valid alternative email")
      } else {
        setAlternativeEmailError("")
      }
      return
    }

    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const isFormValid =
    formData.firstName &&
    formData.lastName &&
    formData.companyRole &&
    formData.phoneNumber &&
    validatePhone(formData.phoneNumber) &&
    formData.companyEmail &&
    validateEmail(formData.companyEmail) &&
    (!formData.alternativeEmail || validateAlternativeEmail(formData.alternativeEmail)) &&
    !emailError &&
    !phoneError &&
    !alternativeEmailError

  const activeVariant = variant === "selectable" ? selectedSignatureMode : variant

  const isAnniversaryVariant = activeVariant === "anniversary" || activeVariant === "anniversary-hosted"

  const pageTitle = isAnniversaryVariant ? "10th Anniversary Signature" : "Personal Information"
  const pageDescription =
    activeVariant === "anniversary"
      ? "Generate the temporary 10th anniversary email signature (base64 images)"
      : activeVariant === "anniversary-hosted"
        ? "Generate the anniversary signature with publicly hosted images (recommended for email clients that block data URIs)"
        : variant === "selectable"
          ? "Choose between the standard and anniversary employee signature"
          : "Fill in your details to generate your signature"
  const previewTitle = isAnniversaryVariant ? "Anniversary Preview" : "Signature Preview"
  const previewDescription = isAnniversaryVariant
    ? "This is how your temporary anniversary signature will look"
    : "This is how your signature will look"
  const copyButtonLabel =
    activeVariant === "anniversary"
      ? "Copy Anniversary Signature"
      : activeVariant === "anniversary-hosted"
        ? "Copy Anniversary Signature (Hosted)"
        : "Copy Signature"

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* Form */}
      <Card>
        <CardHeader>
          <CardTitle>{pageTitle}</CardTitle>
          <CardDescription>{pageDescription}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {variant === "selectable" && (
            <div className="space-y-2">
              <Label>Signature Type</Label>
              <Tabs
                value={selectedSignatureMode}
                onValueChange={(value) =>
                  setSelectedSignatureMode(value as "default" | "anniversary" | "anniversary-hosted")
                }
              >
                <TabsList className="h-auto w-full justify-start">
                  <TabsTrigger value="default">Standard</TabsTrigger>
                  <TabsTrigger value="anniversary">10th Anniversary</TabsTrigger>
                  <TabsTrigger value="anniversary-hosted">Anniversary (Hosted Images)</TabsTrigger>
                </TabsList>
              </Tabs>
              <p className="text-muted-foreground text-xs">
                Use <strong>Anniversary (Hosted Images)</strong> when your email client strips data-URI images. It uses
                the same anniversary design but loads images from our hosted public URL.
              </p>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name *</Label>
              <Input
                id="firstName"
                value={formData.firstName}
                onChange={(e) => handleInputChange("firstName", e.target.value)}
                placeholder="John"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="middleName">Middle Name</Label>
              <Input
                id="middleName"
                value={formData.middleName}
                onChange={(e) => handleInputChange("middleName", e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="lastName">Last Name *</Label>
            <Input
              id="lastName"
              value={formData.lastName}
              onChange={(e) => handleInputChange("lastName", e.target.value)}
              placeholder="Akpa"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="companyRole">Designation *</Label>
            <Input
              id="companyRole"
              value={formData.companyRole}
              onChange={(e) => handleInputChange("companyRole", e.target.value)}
              placeholder="IT Support employee"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="phoneNumber">Phone Number *</Label>
              <Input
                id="phoneNumber"
                value={formData.phoneNumber}
                onChange={(e) => handleInputChange("phoneNumber", e.target.value)}
                placeholder="07012345678"
              />
              {phoneError && <p className="text-destructive text-sm">{phoneError}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="officePhoneNumber">Office Phone Number</Label>
              <Input id="officePhoneNumber" value={OFFICE_PHONE_NUMBER_LABEL} readOnly disabled />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="companyEmail">Company Email *</Label>
              <Input
                id="companyEmail"
                type="email"
                value={formData.companyEmail}
                onChange={(e) => handleInputChange("companyEmail", e.target.value)}
                placeholder="a.john@org.acoblighting.com"
              />
              {emailError && <p className="text-destructive text-sm">{emailError}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="alternativeEmail">Alternative Email</Label>
              <Input
                id="alternativeEmail"
                type="email"
                value={formData.alternativeEmail}
                onChange={(e) => handleInputChange("alternativeEmail", e.target.value)}
                placeholder="info@example.com"
              />
              {alternativeEmailError && <p className="text-destructive text-sm">{alternativeEmailError}</p>}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Phone Order</Label>
              <Tabs
                value={phoneContactOrder}
                onValueChange={(value) => setPhoneContactOrder(value as PhoneContactOrder)}
              >
                <TabsList className="h-auto w-full justify-start">
                  <TabsTrigger value="main-first">Main First</TabsTrigger>
                  <TabsTrigger value="office-first">Office First</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className="space-y-2">
              <Label>Email Order</Label>
              <Tabs
                value={emailContactOrder}
                onValueChange={(value) => setEmailContactOrder(value as EmailContactOrder)}
              >
                <TabsList className="h-auto w-full justify-start">
                  <TabsTrigger value="main-first">Main First</TabsTrigger>
                  <TabsTrigger value="alternative-first">Alternative First</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>

          {activeVariant === "anniversary-hosted" && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/20">
              <p className="text-xs text-amber-800 dark:text-amber-300">
                <strong>Hosted Images Edition</strong> — This signature uses absolute HTTPS URLs for all images instead
                of embedded base64 data. Images will only display correctly when the receiving email client can reach{" "}
                <code>{HOSTED_IMAGES_BASE || window?.location?.origin}</code>.
              </p>
            </div>
          )}

          <div className="flex">
            <Button onClick={copyToClipboard} disabled={!isFormValid} className="flex-1">
              <Copy className="mr-2 h-4 w-4" />
              {copyButtonLabel}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Preview */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>{previewTitle}</CardTitle>
            <CardDescription>{previewDescription}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {isFormValid ? (
            <div
              className="rounded-lg border bg-white p-4 text-sm"
              dangerouslySetInnerHTML={{ __html: generateSignature() }}
            />
          ) : (
            <div className="flex h-64 items-center justify-center rounded-lg border border-dashed">
              <p className="text-muted-foreground">Fill in the required fields to see preview</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
