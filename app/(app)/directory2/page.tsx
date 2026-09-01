import type { Metadata } from "next"
import { Directory2Content } from "./directory2-content"

export const metadata: Metadata = {
  title: "Staff Directory | ACOB Lighting Technology Limited",
  description: "Find any colleague's contact details — email, phone, department and office.",
}

export default function Directory2Page() {
  return <Directory2Content />
}
