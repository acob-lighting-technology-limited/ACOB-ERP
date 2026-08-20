export const CANONICAL_DEPARTMENT_ORDER = [
  "Accounts",
  "Admin & HR",
  "Business, Growth and Innovation",
  "Corporate Services",
  "Executive Management",
  "IT and Communications",
  "Operations and Maintenance",
  "Project",
  "Regulatory and Compliance",
  "Technical",
] as const

type CanonicalDepartment = (typeof CANONICAL_DEPARTMENT_ORDER)[number]

const DEPARTMENT_ALIASES: Partial<Record<CanonicalDepartment, readonly string[]>> = {
  Accounts: ["Finance"],
  "Business, Growth and Innovation": ["Business Growth and Innovation", "Business Growth & Innovation", "BGI"],
  "Operations and Maintenance": ["Operations"],
  "IT and Communications": ["ICT", "IT", "IT & Communications", "Information and Communications Technology"],
  "Regulatory and Compliance": [
    "Legal, Regulatory and Compliance",
    "Regulatory & Compliance",
    "Legal/Regulatory",
    "Legal Regulatory and Compliance",
    "LRC",
    "REG",
  ],
} as const

const DEPARTMENT_SHORT_CODES: Record<CanonicalDepartment, string> = {
  Accounts: "ACC",
  "Admin & HR": "AHR",
  "Business, Growth and Innovation": "BGI",
  "Corporate Services": "CS",
  "Executive Management": "EXM",
  "IT and Communications": "ITC",
  "Operations and Maintenance": "OPM",
  Project: "PRJ",
  "Regulatory and Compliance": "LRC",
  Technical: "TECH",
} as const

export const DEFAULT_DEPARTMENT_DESCRIPTIONS: Record<string, string> = {
  Accounts: "Finance, accounting, budgeting, expenditure control, and financial reporting.",
  "Admin & HR": "Human resources, staff welfare, office administration, and recruitment management.",
  "Business, Growth and Innovation":
    "Business development, strategic partnerships, sales expansion, and innovation initiatives.",
  "Corporate Services": "Corporate communications, facilities, legal support, and operational logistics.",
  "Executive Management": "Executive leadership, strategic direction, governance, and organizational oversight.",
  "IT and Communications":
    "Information technology infrastructure, software systems, network security, and internal communications.",
  "Operations and Maintenance":
    "Field operations, system maintenance, infrastructure reliability, and quality assurance.",
  Project: "Project planning, execution, vendor coordination, and milestone delivery.",
  "Regulatory and Compliance": "Legal compliance, policy adherence, statutory regulations, and industry standards.",
  "Stakeholder Relations":
    "Stakeholder engagement, client partnerships, external communication, and relationship management.",
  Technical: "Technical engineering, research and development, design specifications, and hardware solutions.",
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

export function normalizeDepartmentName(value: string): string {
  const comparable = comparableDepartmentValue(value)
  if (!comparable) return value
  return CANONICAL_BY_COMPARABLE.get(comparable) ?? value.trim()
}

export function normalizeDepartmentList(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => normalizeDepartmentName(value)).filter(Boolean)))
}

export function getDepartmentAliases(value: string): string[] {
  const canonical = normalizeDepartmentName(value)
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
