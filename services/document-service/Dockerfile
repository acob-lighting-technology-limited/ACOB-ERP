# Document service — the native toolchain the PDF routes already shell out to.
#
# Vercel's serverless runtime has none of these binaries, which is why Compress,
# PDF→Image, Password and OCR could not work there. This image carries them and
# exposes the same operations over HTTP, so the Next.js routes keep their
# existing logic and just call out instead of exec'ing locally.
FROM node:22-bookworm-slim

# ghostscript    → PDF compression (gs)
# poppler-utils  → PDF→image (pdftoppm) and PDF merge (pdfunite)
# qpdf           → password protect / remove
# tesseract-ocr  → OCR to searchable PDF
# zip            → bundling converted page images
RUN apt-get update && apt-get install -y --no-install-recommends \
      ghostscript \
      poppler-utils \
      qpdf \
      tesseract-ocr \
      tesseract-ocr-eng \
      zip \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY server.mjs ./

# Run unprivileged — this process handles untrusted uploads.
USER node

ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
