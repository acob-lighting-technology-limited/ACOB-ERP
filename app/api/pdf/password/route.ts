import { NextRequest, NextResponse } from "next/server"
import { PDFDocument } from "pdf-lib"
import { callDocumentService, isDocumentServiceConfigured } from "@/lib/pdf/document-service"

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

      // pdf-lib cannot encrypt, which is why this used to return 501. qpdf in the
      // document service does real AES-256.
      if (!isDocumentServiceConfigured()) {
        return NextResponse.json(
          {
            error:
              "PDF password protection is unavailable: the document service is not configured on this environment.",
          },
          { status: 501 }
        )
      }

      const result = await callDocumentService("encrypt", pdfBytes, { password })
      return new NextResponse(result.bytes as any, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="protected_${file.name}"`,
          "Content-Length": result.bytes.length.toString(),
        },
      })
    } else if (action === "remove") {
      if (!password) {
        return NextResponse.json({ error: "Password is required to remove protection" }, { status: 400 })
      }

      // qpdf decrypts properly when available; pdf-lib's ignoreEncryption only
      // works for the narrow case of a PDF that is not really encrypted.
      if (isDocumentServiceConfigured()) {
        const result = await callDocumentService("decrypt", pdfBytes, { password })
        return new NextResponse(result.bytes as any, {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="unprotected_${file.name}"`,
            "Content-Length": result.bytes.length.toString(),
          },
        })
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
