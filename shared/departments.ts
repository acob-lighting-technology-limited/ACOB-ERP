export const CANONICAL_DEPARTMENT_ORDER = [
  "Accounts",
  "Business, Growth and Innovation",
  "Executive Management",
  "IT and Communications",
  "Admin & HR",
  "Legal, Regulatory and Compliance",
  "Operations and Maintenance",
  "Project",
  "Technical",
] as const

type CanonicalDepartment = (typeof CANONICAL_DEPARTMENT_ORDER)[number]

const DEPARTMENT_ALIASES: Partial<Record<CanonicalDepartment, readonly string[]>> = {
  Accounts: ["Finance"],
  "Business, Growth and Innovation": ["Business Growth and Innovation", "Business Growth & Innovation", "BGI"],
  "Operations and Maintenance": ["Operations"],
} as const

const DEPARTMENT_SHORT_CODES: Record<CanonicalDepartment, string> = {
  Accounts: "ACC",
  "Business, Growth and Innovation": "BGI",
  "Executive Management": "EXM",
  "IT and Communications": "ITC",
  "Admin & HR": "AHR",
  "Legal, Regulatory and Compliance": "LRC",
  "Operations and Maintenance": "OPM",
  Project: "PRJ",
  Technical: "TECH",
} as const

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
