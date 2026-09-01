#!/usr/bin/env node
/**
 * Export the spa birthday voucher to a high-resolution PNG.
 *
 * Renders the page in headless Chromium at a viewport wide enough for the full
 * card, then screenshots the .voucher element only — so the output is cropped
 * to the voucher's exact bounds, never to the visible screen.
 *
 * Usage:
 *   node scripts/export-voucher-png.mjs                       # default 3x scale
 *   node scripts/export-voucher-png.mjs --scale 4             # ~4040px wide
 *   node scripts/export-voucher-png.mjs --in other.html --out other.png
 *   node scripts/export-voucher-png.mjs --transparent         # no page background
 */

import { chromium } from "playwright"
import { pathToFileURL } from "node:url"
import path from "node:path"
import fs from "node:fs"

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback
}
const has = (name) => args.includes(`--${name}`)

const root = process.cwd()
const input = path.resolve(root, flag("in", "spa_birthday_voucher2.html"))
const output = path.resolve(root, flag("out", input.replace(/\.html$/i, ".png")))
const scale = Number(flag("scale", "3"))
const selector = flag("selector", ".voucher")

if (!fs.existsSync(input)) {
  console.error(`✗ Not found: ${input}`)
  process.exit(1)
}
if (!Number.isFinite(scale) || scale < 1 || scale > 6) {
  console.error(`✗ --scale must be between 1 and 6 (got ${flag("scale", "3")})`)
  process.exit(1)
}

// This repo's playwright install has the full chromium build but not always the
// matching headless-shell, so fall back to the full browser when the shell is missing.
let browser
try {
  browser = await chromium.launch()
} catch (err) {
  if (!/Executable doesn't exist/.test(String(err))) throw err
  browser = await chromium.launch({ channel: "chromium" })
}
const page = await browser.newPage({
  // Wide enough that the 1010px card never hits the responsive breakpoint.
  viewport: { width: 1400, height: 1000 },
  deviceScaleFactor: scale,
})

await page.goto(pathToFileURL(input).href, { waitUntil: "networkidle" })

// Web fonts must be fully loaded or the PNG bakes in fallback faces.
await page.evaluate(() => document.fonts.ready)

// Drop the screen-only chrome so it can't appear in the capture.
await page.addStyleTag({
  content: `.toolbar, .hint { display: none !important; }
            body { padding: 0 !important; }`,
})

const card = page.locator(selector).first()
await card.waitFor({ state: "visible" })

const box = await card.boundingBox()
await card.screenshot({
  path: output,
  omitBackground: has("transparent"),
})

await browser.close()

const { size } = fs.statSync(output)
console.log(
  `✓ ${path.relative(root, output)}  ` +
    `${Math.round(box.width * scale)}×${Math.round(box.height * scale)}px  ` +
    `(${scale}x, ${(size / 1024).toFixed(0)} KB)`,
)
