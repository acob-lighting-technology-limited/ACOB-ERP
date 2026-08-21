/**
 * Rooms & Offices Helper
 * Utilities for organizing and filtering company rooms and office locations by space type and department.
 */

export type RoomOrOfficeType = "office" | "department_office" | "conference_room" | "common_area"
export type OfficeType = RoomOrOfficeType

export interface RoomOrOfficeLocation {
  name: string
  type: RoomOrOfficeType
  department: string | null
  description?: string
}
export type OfficeLocation = RoomOrOfficeLocation

/**
 * Rooms and offices organized by type
 * Aligned with the 10 canonical company departments and standard facility spaces.
 */
export const ROOMS_AND_OFFICES_BY_TYPE: Record<RoomOrOfficeType, RoomOrOfficeLocation[]> = {
  // Executive offices (not linked to single departments)
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

  // Department offices (linked to the 10 canonical departments)
  department_office: [
    {
      name: "Accounts",
      type: "department_office",
      department: "Accounts",
      description: "Accounts Department Office",
    },
    {
      name: "Admin and HR",
      type: "department_office",
      department: "Admin and HR",
      description: "Admin and HR Department Office",
    },
    {
      name: "Business, Growth and Innovation",
      type: "department_office",
      department: "Business, Growth and Innovation",
      description: "Business, Growth and Innovation Department Office",
    },
    {
      name: "Corporate Services",
      type: "department_office",
      department: "Corporate Services",
      description: "Corporate Services Department Office",
    },
    {
      name: "Executive Management",
      type: "department_office",
      department: "Executive Management",
      description: "Executive Management Department Office",
    },
    {
      name: "IT and Communications",
      type: "department_office",
      department: "IT and Communications",
      description: "IT and Communications Department Office",
    },
    {
      name: "Operations and Maintenance",
      type: "department_office",
      department: "Operations and Maintenance",
      description: "Operations and Maintenance Department Office",
    },
    {
      name: "Project",
      type: "department_office",
      department: "Project",
      description: "Project Department Office",
    },
    {
      name: "Regulatory and Compliance",
      type: "department_office",
      department: "Regulatory and Compliance",
      description: "Regulatory and Compliance Department Office",
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
  ],

  // Conference rooms (shared meeting spaces)
  conference_room: [
    {
      name: "General Conference Room",
      type: "conference_room",
      department: null,
      description: "Main conference room for general meetings",
    },
    {
      name: "MD Conference Room",
      type: "conference_room",
      department: null,
      description: "Executive conference room",
    },
  ],

  // Common areas (shared spaces / facilities)
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
    {
      name: "SIWES",
      type: "common_area",
      department: null,
      description: "SIWES / Student Intern Workspace",
    },
  ],
}

// Backward compatibility alias
export const OFFICE_LOCATIONS_BY_TYPE = ROOMS_AND_OFFICES_BY_TYPE

/**
 * Get all rooms and office locations as a flat array
 */
export function getAllRoomsAndOffices(): RoomOrOfficeLocation[] {
  return Object.values(ROOMS_AND_OFFICES_BY_TYPE).flat()
}
export const getAllOfficeLocations = getAllRoomsAndOffices

/**
 * Get rooms / offices by space type
 */
export function getRoomsByType(type: RoomOrOfficeType): RoomOrOfficeLocation[] {
  return ROOMS_AND_OFFICES_BY_TYPE[type] || []
}
export const getOfficesByType = getRoomsByType

/**
 * Get department offices (offices linked to departments)
 */
export function getDepartmentOffices(): RoomOrOfficeLocation[] {
  return ROOMS_AND_OFFICES_BY_TYPE.department_office
}

/**
 * Get common areas (shared spaces not linked to single departments)
 */
export function getCommonAreas(): RoomOrOfficeLocation[] {
  return ROOMS_AND_OFFICES_BY_TYPE.common_area
}

/**
 * Get executive offices
 */
export function getExecutiveOffices(): RoomOrOfficeLocation[] {
  return ROOMS_AND_OFFICES_BY_TYPE.office
}

/**
 * Get conference rooms
 */
export function getConferenceRooms(): RoomOrOfficeLocation[] {
  return ROOMS_AND_OFFICES_BY_TYPE.conference_room
}

/**
 * Get offices for a specific department
 */
export function getOfficesForDepartment(department: string): RoomOrOfficeLocation[] {
  return ROOMS_AND_OFFICES_BY_TYPE.department_office.filter((office) => office.department === department)
}

/**
 * Get room or office location by name
 */
export function getRoomByName(name: string): RoomOrOfficeLocation | undefined {
  return getAllRoomsAndOffices().find((office) => office.name === name)
}
export const getOfficeByName = getRoomByName

/**
 * Check if an office belongs to a department
 */
export function isDepartmentOffice(officeName: string): boolean {
  const office = getRoomByName(officeName)
  return office?.type === "department_office" && office.department !== null
}

/**
 * Check if a space is a common area
 */
export function isCommonArea(officeName: string): boolean {
  const office = getRoomByName(officeName)
  return office?.type === "common_area"
}

/**
 * Get the linked department for a department office
 */
export function getDepartmentForOffice(officeName: string): string | null {
  const office = getRoomByName(officeName)
  return office?.department || null
}

/**
 * Get human-readable type label for display
 */
export function getRoomTypeLabel(type: RoomOrOfficeType): string {
  const labels: Record<RoomOrOfficeType, string> = {
    office: "Executive Office",
    department_office: "Department Office",
    conference_room: "Conference Room",
    common_area: "Common Area",
  }
  return labels[type] || "Other"
}
export const getOfficeTypeLabel = getRoomTypeLabel

/**
 * Group department offices by department
 */
export function getOfficesGroupedByDepartment(): Record<string, RoomOrOfficeLocation[]> {
  const grouped: Record<string, RoomOrOfficeLocation[]> = {}

  ROOMS_AND_OFFICES_BY_TYPE.department_office.forEach((office) => {
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
 * Flat array of all room & office names
 */
export const ROOMS_AND_OFFICES = getAllRoomsAndOffices().map((office) => office.name)
export const OFFICE_LOCATIONS = ROOMS_AND_OFFICES

export type RoomOrOfficeName = string
export type OfficeLocationName = string
