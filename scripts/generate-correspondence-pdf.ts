import { createClient } from "@supabase/supabase-js"
import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import * as fs from "fs"
import * as path from "path"
import * as dotenv from "dotenv"

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error("Error: Missing Supabase URL or Service Role Key in environment variables.")
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false }
})

async function generatePDF() {
  console.log("Fetching correspondence records from Supabase...")
  
  // Fetch up to 5000 records
  const { data: records, error } = await supabase
    .from("correspondence_records")
    .select("reference_number, subject, recipient_name, recipient_code, status, created_at")
    .order("created_at", { ascending: false })
    .limit(5000)

  if (error) {
    console.error("Failed to fetch records:", error.message)
    process.exit(1)
  }

  if (!records || records.length === 0) {
    console.log("No correspondence records found in the database.")
    process.exit(0)
  }

  console.log(`Successfully fetched ${records.length} records. Generating PDF...`)

  const doc = new jsPDF({ orientation: "portrait" })

  // Report Title
  doc.setFont("helvetica", "bold")
  doc.setFontSize(18)
  doc.setTextColor(15, 23, 42) // Slate 900
  doc.text("Correspondence Report", 14, 20)

  // Subtitle/Metadata
  doc.setFont("helvetica", "normal")
  doc.setFontSize(10)
  doc.setTextColor(71, 85, 105) // Slate 600
  const dateStr = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  })
  doc.text(`Generated on: ${dateStr}`, 14, 27)
  doc.text(`Total Records: ${records.length}`, 14, 33)

  // Table columns
  const headers = ["S/N", "Reference Number", "Subject", "Recipient Name", "Recipient Code"]

  // Table rows
  const body = records.map((record, index) => {
    // Show reference number only if status allows it, or show what is there
    // The previous implementation checked: ["approved", "sent", "filed"].includes(record.status)
    // but the user wants a PDF of all correspondence, so we can display whatever reference number is stored,
    // falling back to "-" if null. Let's make it robust:
    const ref = record.reference_number || "-"
    const subject = record.subject || "-"
    const recName = record.recipient_name || "-"
    const recCode = record.recipient_code || "-"
    
    return [String(index + 1), ref, subject, recName, recCode]
  })

  autoTable(doc, {
    head: [headers],
    body: body,
    startY: 40,
    styles: {
      fontSize: 9,
      cellPadding: 3,
      font: "helvetica"
    },
    headStyles: {
      fillColor: [15, 23, 42], // Slate 900 for a clean premium look
      textColor: 255,
      fontStyle: "bold"
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252] // Slate 50
    },
    columnStyles: {
      0: { cellWidth: 10, halign: "center" }, // S/N
      1: { cellWidth: 45 },                  // Reference
      2: { cellWidth: 67 },                  // Subject
      3: { cellWidth: 35 },                  // Recipient Name
      4: { cellWidth: 25 }                   // Recipient Code
    },
    margin: { top: 40, bottom: 20, left: 14, right: 14 }
  })

  // Add page numbers
  const pageCount = (doc as any).internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(8)
    doc.setTextColor(148, 163, 184) // Slate 400
    doc.text(
      `Page ${i} of ${pageCount}`,
      doc.internal.pageSize.getWidth() - 14,
      doc.internal.pageSize.getHeight() - 10,
      { align: "right" }
    )
  }

  const outputPath = path.resolve(process.cwd(), "all-correspondence.pdf")
  const arrayBuffer = doc.output("arraybuffer")
  fs.writeFileSync(outputPath, Buffer.from(arrayBuffer))
  
  console.log(`Success! PDF generated at: ${outputPath}`)
}

generatePDF()
