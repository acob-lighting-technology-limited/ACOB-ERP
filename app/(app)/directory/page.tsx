import type { Metadata } from "next"
import { DirectoryContent } from "./directory-content"

export const metadata: Metadata = {
  title: "Staff Directory | ACOB Lighting Technology Limited",
  description: "Find any colleague's contact details — email, phone, department and office.",
}

export default function DirectoryPage() {
  return <DirectoryContent />
}
