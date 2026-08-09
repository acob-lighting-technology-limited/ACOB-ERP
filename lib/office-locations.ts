/**
 * Office Locations Helper
 * Utilities for organizing and filtering office locations by type and department
 */

export type OfficeType = "office" | "department_office" | "conference_room" | "common_area"

export interface OfficeLocation {
  name: string
  type: OfficeType
  department: string | null
  description?: string
}

/**
 * Office locations organized by type
 * This matches the office_locations table structure
 */
export const OFFICE_LOCATIONS_BY_TYPE: Record<OfficeType, OfficeLocation[]> = {
  // Executive offices (not linked to departments)
  office: [
    {
      name: "MD Office",
      type: "office",
      department: null,
      description: "Managing Director's private office",
    },
    {
      name: "Assistant Executive Director",
      type: "office",
      department: null,
      description: "Assistant Executive Director's private office",
    },
  ],

  // Department offices (linked to departments)
  department_office: [
    {
      name: "Accounts",
      type: "department_office",
      department: "Accounts",
      description: "Accounts Department Office",
    },
    {
      name: "Admin & HR",
      type: "department_office",
      department: "Admin & HR",
      description: "Admin & HR Department Office",
    },
    {
      name: "Business, Growth and Innovation",
      type: "department_office",
      department: "Business, Growth and Innovation",
      description: "Business, Growth and Innovation Department Office",
    },
    {
      name: "IT and Communications",
      type: "department_office",
      department: "IT and Communications",
      description: "IT and Communications Department Office",
    },
    {
      name: "Regulatory and Compliance",
      type: "department_office",
      department: "Regulatory and Compliance",
      description: "Regulatory and Compliance Department Office",
    },
    {
      name: "Operations and Maintenance",
      type: "department_office",
      department: "Operations and Maintenance",
      description: "Operations and Maintenance Department Office",
    },
    {
      name: "Technical",
      type: "department_office",
      department: "Technical",
      description: "Technical Department Office",
    },
    {
      name: "Technical Extension",
      type: "department_office",
      department: "Technical",
      description: "Technical Department Extension Office",
    },
    {
      name: "SIWES",
      type: "department_office",
      department: "SIWES",
      description: "SIWES Department Office",
    },
  ],

  // Conference rooms (shared meeting spaces)
  conference_room: [
    {
      name: "General Conference Room",
      type: "conference_room",
      department: null,
      description: "Main conference room for general meetings",
    },
  ],

  // Common areas (shared spaces, not linked to departments)
  common_area: [
    {
      name: "Reception",
      type: "common_area",
      department: null,
      description: "Main reception area",
    },
    {
      name: "Kitchen",
      type: "common_area",
      department: null,
      description: "Company kitchen/common area",
    },
  ],
}

/**
 * Get all office locations as a flat array
 */
export function getAllOfficeLocations(): OfficeLocation[] {
  return Object.values(OFFICE_LOCATIONS_BY_TYPE).flat()
}

/**
 * Get offices by type
 */
export function getOfficesByType(type: OfficeType): OfficeLocation[] {
  return OFFICE_LOCATIONS_BY_TYPE[type] || []
}

/**
 * Get department offices (offices linked to departments)
 */
export function getDepartmentOffices(): OfficeLocation[] {
  return OFFICE_LOCATIONS_BY_TYPE.department_office
}

/**
 * Get common areas (shared spaces not linked to departments)
 */
export function getCommonAreas(): OfficeLocation[] {
  return OFFICE_LOCATIONS_BY_TYPE.common_area
}

/**
 * Get executive offices
 */
export function getExecutiveOffices(): OfficeLocation[] {
  return OFFICE_LOCATIONS_BY_TYPE.office
}

/**
 * Get conference rooms
 */
export function getConferenceRooms(): OfficeLocation[] {
  return OFFICE_LOCATIONS_BY_TYPE.conference_room
}

/**
 * Get offices for a specific department
 */
export function getOfficesForDepartment(department: string): OfficeLocation[] {
  return OFFICE_LOCATIONS_BY_TYPE.department_office.filter((office) => office.department === department)
}

/**
 * Get office location by name
 */
export function getOfficeByName(name: string): OfficeLocation | undefined {
  return getAllOfficeLocations().find((office) => office.name === name)
}

/**
 * Check if an office belongs to a department
 */
export function isDepartmentOffice(officeName: string): boolean {
  const office = getOfficeByName(officeName)
  return office?.type === "department_office" && office.department !== null
}

/**
 * Check if an office is a common area
 */
export function isCommonArea(officeName: string): boolean {
  const office = getOfficeByName(officeName)
  return office?.type === "common_area"
}

/**
 * Get the department for a department office
 */
export function getDepartmentForOffice(officeName: string): string | null {
  const office = getOfficeByName(officeName)
  return office?.department || null
}

/**
 * Get office type label for display
 */
export function getOfficeTypeLabel(type: OfficeType): string {
  const labels: Record<OfficeType, string> = {
    office: "Executive Office",
    department_office: "Department Office",
    conference_room: "Conference Room",
    common_area: "Common Area",
  }
  return labels[type] || "Other"
}

/**
 * Group offices by department (for department offices only)
 */
export function getOfficesGroupedByDepartment(): Record<string, OfficeLocation[]> {
  const grouped: Record<string, OfficeLocation[]> = {}

  OFFICE_LOCATIONS_BY_TYPE.department_office.forEach((office) => {
    if (office.department) {
      if (!grouped[office.department]) {
        grouped[office.department] = []
      }
      grouped[office.department].push(office)
    }
  })

  return grouped
}

/**
 * Get all office names as a flat array (for backward compatibility)
 */
export const OFFICE_LOCATIONS = getAllOfficeLocations().map((office) => office.name)

export type OfficeLocationName = string
