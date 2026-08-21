export const DEPT_ACCOUNTS = "Accounts" as const
export const DEPT_ADMIN_HR = "Admin and HR" as const
export const DEPT_BGI = "Business, Growth and Innovation" as const
export const DEPT_CORPORATE_SERVICES = "Corporate Services" as const
export const DEPT_EXECUTIVE_MANAGEMENT = "Executive Management" as const
export const DEPT_ITC = "IT and Communications" as const
export const DEPT_OPM = "Operations and Maintenance" as const
export const DEPT_PROJECT = "Project" as const
export const DEPT_REGULATORY = "Regulatory and Compliance" as const
export const DEPT_TECHNICAL = "Technical" as const

export const CANONICAL_DEPARTMENT_ORDER = [
  DEPT_ACCOUNTS,
  DEPT_ADMIN_HR,
  DEPT_BGI,
  DEPT_CORPORATE_SERVICES,
  DEPT_EXECUTIVE_MANAGEMENT,
  DEPT_ITC,
  DEPT_OPM,
  DEPT_PROJECT,
  DEPT_REGULATORY,
  DEPT_TECHNICAL,
] as const

export type CanonicalDepartment = (typeof CANONICAL_DEPARTMENT_ORDER)[number]

const DEPARTMENT_ALIASES: Partial<Record<CanonicalDepartment, readonly string[]>> = {
  [DEPT_ACCOUNTS]: ["Finance"],
  [DEPT_ADMIN_HR]: [
    "Admin & HR",
    "Admin/HR",
    "HR",
    "Administration & HR",
    "Administration and HR",
    "Human Resources",
    "AHR",
  ],
  [DEPT_BGI]: [
    "Business Growth and Innovation",
    "Business Growth & Innovation",
    "Business, Growth & Innovation",
    "BGI",
  ],
  [DEPT_OPM]: ["Operations", "Operations & Maintenance", "O&M", "OPM"],
  [DEPT_ITC]: [
    "ICT",
    "IT",
    "IT & Communications",
    "IT and Communication",
    "Information and Communications Technology",
    "Information Technology and Communications",
  ],
  [DEPT_REGULATORY]: [
    "Legal, Regulatory and Compliance",
    "Legal, Regulatory & Compliance",
    "Regulatory & Compliance",
    "Legal/Regulatory",
    "Legal Regulatory and Compliance",
    "LRC",
    "REG",
  ],
} as const

const DEPARTMENT_SHORT_CODES: Record<CanonicalDepartment, string> = {
  [DEPT_ACCOUNTS]: "ACC",
  [DEPT_ADMIN_HR]: "AHR",
  [DEPT_BGI]: "BGI",
  [DEPT_CORPORATE_SERVICES]: "CS",
  [DEPT_EXECUTIVE_MANAGEMENT]: "EXM",
  [DEPT_ITC]: "ITC",
  [DEPT_OPM]: "OPM",
  [DEPT_PROJECT]: "PRJ",
  [DEPT_REGULATORY]: "LRC",
  [DEPT_TECHNICAL]: "TECH",
} as const

export const DEFAULT_DEPARTMENT_DESCRIPTIONS: Record<string, string> = {
  [DEPT_ACCOUNTS]: "Finance, accounting, budgeting, expenditure control, and financial reporting.",
  [DEPT_ADMIN_HR]: "Human resources, staff welfare, office administration, and recruitment management.",
  [DEPT_BGI]: "Business development, strategic partnerships, sales expansion, and innovation initiatives.",
  [DEPT_CORPORATE_SERVICES]: "Corporate communications, facilities, legal support, and operational logistics.",
  [DEPT_EXECUTIVE_MANAGEMENT]: "Executive leadership, strategic direction, governance, and organizational oversight.",
  [DEPT_ITC]: "Information technology infrastructure, software systems, network security, and internal communications.",
  [DEPT_OPM]: "Field operations, system maintenance, infrastructure reliability, and quality assurance.",
  [DEPT_PROJECT]: "Project planning, execution, vendor coordination, and milestone delivery.",
  [DEPT_REGULATORY]: "Legal compliance, policy adherence, statutory regulations, and industry standards.",
  "Stakeholder Relations":
    "Stakeholder engagement, client partnerships, external communication, and relationship management.",
  [DEPT_TECHNICAL]: "Technical engineering, research and development, design specifications, and hardware solutions.",
  "Monitoring and Evaluation":
    "Performance tracking, project impact assessment, metrics evaluation, and quality audit.",
}

export function getDefaultDepartmentDescription(departmentName: string): string {
  const canonical = normalizeDepartmentName(departmentName)
  if (DEFAULT_DEPARTMENT_DESCRIPTIONS[canonical]) {
    return DEFAULT_DEPARTMENT_DESCRIPTIONS[canonical]
  }
  const matchedKey = Object.keys(DEFAULT_DEPARTMENT_DESCRIPTIONS).find(
    (key) => key.toLowerCase() === departmentName.trim().toLowerCase()
  )
  if (matchedKey) {
    return DEFAULT_DEPARTMENT_DESCRIPTIONS[matchedKey]
  }
  return `Department responsible for ${departmentName.trim()} operations and initiatives.`
}

function comparableDepartmentValue(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\./g, "")
    .replace(/,/g, "")
    .replace(/\s+/g, " ")
}

const CANONICAL_BY_COMPARABLE = new Map<string, string>(
  CANONICAL_DEPARTMENT_ORDER.flatMap((department) => {
    const aliases = DEPARTMENT_ALIASES[department] ?? []
    return [department, ...aliases].map((value) => [comparableDepartmentValue(value), department] as const)
  })
)

export function normalizeDepartmentName(value: string | null | undefined): string {
  if (!value) return ""
  const comparable = comparableDepartmentValue(value)
  if (!comparable) return value.trim()
  return CANONICAL_BY_COMPARABLE.get(comparable) ?? value.trim()
}

export function isSameDepartment(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const normA = normalizeDepartmentName(a)
  const normB = normalizeDepartmentName(b)
  if (!normA || !normB) return false
  return normA.toLowerCase() === normB.toLowerCase()
}

export function normalizeDepartmentList(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => normalizeDepartmentName(value)).filter(Boolean)))
}

export function getDepartmentAliases(value: string): string[] {
  const canonical = normalizeDepartmentName(value) as CanonicalDepartment
  const aliases = Object.entries(DEPARTMENT_ALIASES).find(([department]) => department === canonical)?.[1] ?? []
  return Array.from(new Set([canonical, value.trim(), ...aliases].filter(Boolean)))
}

export function getCanonicalDepartmentOrder(): string[] {
  return [...CANONICAL_DEPARTMENT_ORDER]
}

export function getDepartmentShortCode(value: string): string {
  const canonical = normalizeDepartmentName(value) as CanonicalDepartment
  return DEPARTMENT_SHORT_CODES[canonical] ?? normalizeDepartmentName(value)
}

export function getDepartmentSortIndex(value: string): number {
  return CANONICAL_DEPARTMENT_ORDER.indexOf(normalizeDepartmentName(value) as CanonicalDepartment)
}

export function compareDepartments(a: string, b: string): number {
  const canonicalA = normalizeDepartmentName(a)
  const canonicalB = normalizeDepartmentName(b)
  const indexA = getDepartmentSortIndex(canonicalA)
  const indexB = getDepartmentSortIndex(canonicalB)

  if (indexA !== -1 && indexB !== -1) return indexA - indexB
  if (indexA !== -1) return -1
  if (indexB !== -1) return 1
  return canonicalA.localeCompare(canonicalB)
}

export function getActionPointsDepartmentHeading(value: string): string {
  return `${normalizeDepartmentName(value).toUpperCase()}:`
}
