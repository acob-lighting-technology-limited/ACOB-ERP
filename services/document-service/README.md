# Document service

Ghostscript, Poppler, qpdf and Tesseract behind a small HTTP API.

## Why this exists

Four PDF tools shell out to native binaries that **do not exist on Vercel's
serverless runtime**, so they could never work in production:

| Tool | Binary | Symptom before |
|---|---|---|
| Compress | `gs` | Silently fell back to a pdf-lib re-save: ~1% smaller, target ignored |
| PDF → Image | `pdftoppm` / `gs` | "PDF to image conversion requires pdftoppm or ghostscript." |
| Password protect | `qpdf` | HTTP 501, "requires additional tools" |
| OCR | `tesseract` | "OCR requires Tesseract OCR. Install with: brew install…" |

The route code already knew how to drive these binaries — they just had nowhere
to run. This service gives them a home; the routes call it instead of `exec`.

## Behaviour when not configured

The routes check `isDocumentServiceConfigured()`. With the environment variables
unset they behave exactly as before (local binary if present, else the previous
fallback or error). Deploying this repo without the service changes nothing.

## API

Body is always the raw PDF. Auth is `Authorization: Bearer $DOCUMENT_SERVICE_TOKEN`.
PDF passwords travel in the `x-pdf-password` **header**, never the query string,
so they stay out of access logs.

| Method | Path | Params | Returns |
|---|---|---|---|
| GET | `/health` | — | `{"ok":true}` (no auth) |
| POST | `/compress` | `targetBytes` | `application/pdf` |
| POST | `/convert` | `format=png\|jpg\|webp` | `application/zip` |
| POST | `/encrypt` | header `x-pdf-password` | `application/pdf` |
| POST | `/decrypt` | header `x-pdf-password` | `application/pdf` |
| POST | `/ocr` | `lang` (default `eng`) | `application/pdf`, searchable |

`/compress` escalates through progressively harsher Ghostscript settings and
stops as soon as the target is met, so a document is never degraded more than
necessary. It reports `x-original-bytes`, `x-result-bytes` and `x-target-met`.

## Run locally

```bash
docker build -t acob-document-service services/document-service
docker run --rm -p 8080:8080 -e DOCUMENT_SERVICE_TOKEN=dev-token acob-document-service
```

Then in `.env.local`:

```
DOCUMENT_SERVICE_URL=http://localhost:8080
DOCUMENT_SERVICE_TOKEN=dev-token
```

## Deploy (Azure Container Apps)

Generate a strong token first — this is the only thing standing between the
internet and a PDF-processing engine:

```bash
openssl rand -base64 32
```

Then, with your own subscription and names substituted:

```bash
az acr build --registry <registry> --image document-service:v1 services/document-service

az containerapp create \
  --name acob-document-service \
  --resource-group <resource-group> \
  --environment <containerapp-env> \
  --image <registry>.azurecr.io/document-service:v1 \
  --target-port 8080 \
  --ingress internal \
  --min-replicas 1 \
  --secrets service-token=<generated-token> \
  --env-vars DOCUMENT_SERVICE_TOKEN=secretref:service-token
```

Finally set `DOCUMENT_SERVICE_URL` and `DOCUMENT_SERVICE_TOKEN` in the Vercel
project environment.

### Ingress

`--ingress internal` keeps the service off the public internet, which is the
right default. Vercel functions call from arbitrary egress IPs, so reaching an
internal-only Container App needs private networking (VNet integration). If that
is not in place, use `--ingress external`: the bearer token is then the only
control, so the token must be strong and rotated if leaked.

## Notes

- Runs as the unprivileged `node` user; it handles untrusted uploads.
- Uses `execFile`, not `exec` — arguments never reach a shell, so filenames and
  passwords cannot be interpreted as shell syntax.
- Uploads are capped (`MAX_UPLOAD_BYTES`, default 100 MB) and every command has a
  timeout (`EXEC_TIMEOUT_MS`, default 240s).
- Temp directories are removed in a `finally`, including on failure.
- Client errors are generic; the real cause is logged server-side only.
- Add languages by installing more `tesseract-ocr-*` packages in the Dockerfile.
