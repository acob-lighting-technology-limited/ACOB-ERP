import type { Metadata } from "next"
import { Directory4Content } from "./directory4-content"

export const metadata: Metadata = {
  title: "Staff Directory | ACOB Lighting Technology Limited",
  description: "Find any colleague's contact details — email, phone, department and office.",
}

export default function Directory4Page() {
  return <Directory4Content />
}
