// Empty stub used by Turbopack `resolveAlias` (dev) to replace Node-core and
// optional browser-incompatible modules (canvas, fs, node:*) that export libs
// like jspdf/xlsx/docx reference but never actually use in the browser.
// Mirrors the `resolve.fallback: false` / `alias: false` entries in the
// webpack() config used for the production build.
module.exports = {}
