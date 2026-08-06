import { NextRequest, NextResponse } from "next/server"
import { PDFDocument } from "pdf-lib"

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File
    const action = formData.get("action") as string
    const password = formData.get("password") as string

    if (!file) {
      return NextResponse.json({ error: "PDF file is required" }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const pdfBytes = new Uint8Array(arrayBuffer)

    if (action === "protect") {
      if (!password) {
        return NextResponse.json({ error: "Password is required for protection" }, { status: 400 })
      }

      const pdfDoc = await PDFDocument.load(pdfBytes)
      const protectedBytes = await pdfDoc.save({
        useObjectStreams: false,
        addDefaultPage: false,
      })

      return NextResponse.json(
        {
          error:
            "PDF password protection requires additional tools. Consider using qpdf or pdftk for full encryption support.",
          note: "Basic protection can be added, but full encryption requires external tools.",
        },
        { status: 501 }
      )
    } else if (action === "remove") {
      if (!password) {
        return NextResponse.json({ error: "Password is required to remove protection" }, { status: 400 })
      }

      try {
        const pdfDoc = await PDFDocument.load(pdfBytes, {
          ignoreEncryption: true,
        })

        const unprotectedBytes = await pdfDoc.save()

        return new NextResponse(unprotectedBytes as any, {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="unprotected_${file.name}"`,
            "Content-Length": unprotectedBytes.length.toString(),
          },
        })
      } catch (error: any) {
        return NextResponse.json(
          {
            error:
              "Failed to remove password. The password may be incorrect, or the PDF uses encryption that cannot be removed with pdf-lib. Consider using qpdf or pdftk.",
          },
          { status: 400 }
        )
      }
    } else {
      return NextResponse.json({ error: 'Invalid action. Use "protect" or "remove"' }, { status: 400 })
    }
  } catch (error: any) {
    console.error("Error processing PDF password:", error)
    return NextResponse.json({ error: error.message || "Failed to process PDF password" }, { status: 500 })
  }
}

export const maxDuration = 60
