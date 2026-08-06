export type NotificationModule =
  | "Onboarding"
  | "Help Desk"
  | "Leave"
  | "Assets"
  | "Meetings"
  | "Communications"
  | "Reports"
  | "Attendance"
  | "Exit"
  | "Birthday"
  | "Payments"
  | "Correspondence"

export function withSubjectPrefix(moduleName: NotificationModule, subject: string): string {
  return String(subject || "").trim() || "Notification"
}
