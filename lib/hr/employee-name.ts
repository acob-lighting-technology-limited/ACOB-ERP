/**
 * Single source for how an employee's name is rendered on HR surfaces.
 *
 * "Surname, Firstname" is the HR/payroll convention, and it makes an A–Z sort
 * order by surname rather than by first name — sorting a "Firstname Lastname"
 * string silently orders by first name, which is what the attendance summary
 * used to do.
 */
export interface EmployeeNameParts {
  first_name?: string | null
  last_name?: string | null
  full_name?: string | null
}

/**
 * Renders "Surname, Firstname". Falls back to whichever part exists so a profile
 * missing one never renders a stray comma.
 *
 * `full_name` is only used when the split fields are unavailable — it is stored
 * as free text, and guessing which token is the surname would mangle names with
 * multiple given names or compound surnames.
 */
export function formatEmployeeName(parts: EmployeeNameParts | null | undefined): string {
  const first = String(parts?.first_name ?? "").trim()
  const last = String(parts?.last_name ?? "").trim()

  if (first && last) return `${last}, ${first}`
  if (last || first) return last || first

  return String(parts?.full_name ?? "").trim() || "Unknown"
}

/** Comparator for sorting employees by the rendered surname-first name. */
export function compareEmployeeName(a: string, b: string): number {
  return a.localeCompare(b)
}
