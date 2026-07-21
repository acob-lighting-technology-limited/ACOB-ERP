import path from "path"

// ---------------------------------------------------------------------------
// Security headers applied to all routes
// ---------------------------------------------------------------------------
const supabaseHost = "https://itqegqxeqkeogwrvlzlj.supabase.co"

const securityHeaders = [
  // Prevent browsers from sniffing a different MIME type than declared
  { key: "X-Content-Type-Options", value: "nosniff" },

  // Prevent clickjacking while still allowing same-origin embedding
  { key: "X-Frame-Options", value: "SAMEORIGIN" },

  // Enforce HTTPS for 1 year, including subdomains
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },

  // Restrict browser feature access
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },

  // Referrer information limited to same-origin
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

  // Content Security Policy
  // Sources:
  //   - 'self'                    : App origin
  //   - supabaseHost              : Supabase API & storage
  //   - va.vercel-scripts.com     : Vercel Web Analytics script
  //   - vitals.vercel-insights.com: Vercel Speed Insights beacon
  //
  // Note: 'unsafe-inline' is required for:
  //   - style-src: Tailwind CSS + Radix UI inject inline styles at runtime.
  //     Remove once CSS-in-JS is eliminated or a nonce/hash approach is used.
  //   - script-src 'unsafe-inline': Next.js inlines small hydration scripts.
  //     Remove once Next.js supports nonce-based CSP (tracked roadmap item).
  //   - script-src 'unsafe-eval': Required by xlsx, jspdf, and docx packages
  //     which use eval() internally for formula parsing / rendering. Cannot be
  //     removed until those libs ship eval-free builds or are replaced.
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Scripts: self + Next.js inline hydration + xlsx/jspdf eval + Vercel Analytics
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com",
      // Styles: self + inline (Tailwind/Radix)
      "style-src 'self' 'unsafe-inline'",
      // Images: self + data URIs (avatar initials) + Supabase storage
      `img-src 'self' data: blob: ${supabaseHost}`,
      // Fonts: self-hosted Geist font only
      "font-src 'self'",
      // API calls: self + Supabase
      `connect-src 'self' ${supabaseHost} wss://itqegqxeqkeogwrvlzlj.supabase.co https://vitals.vercel-insights.com`,
      // Allow embedding only from the same origin
      "frame-ancestors 'self'",
      // Allow same-origin frame content
      "frame-src 'self'",
      // No plugins
      "object-src 'none'",
      // Base URI restricted to self
      "base-uri 'self'",
      // Form submissions only to self
      "form-action 'self'",
    ].join("; "),
  },
]

const nextConfig = {
  transpilePackages: ["xlsx", "jspdf", "jspdf-autotable", "docx", "file-saver"],

  // ---------------------------------------------------------------------------
  // Turbopack (dev only — `next dev --turbopack`). Production build still uses
  // webpack via `next build --webpack`, so the `webpack()` config below remains
  // the source of truth for prod bundling. These aliases mirror the canvas /
  // node-core stubs that the webpack config applies, so export libs (jspdf,
  // xlsx, docx) resolve in the browser during dev.
  // ---------------------------------------------------------------------------
  turbopack: {
    resolveAlias: {
      // jsPDF optional deps that must not resolve in the browser
      canvas: { browser: "./lib/empty-module.js" },
      encoding: { browser: "./lib/empty-module.js" },
      // node: scheme + bare node-core imports pulled in by export libs
      "node:fs": { browser: "./lib/empty-module.js" },
      "node:net": { browser: "./lib/empty-module.js" },
      "node:tls": { browser: "./lib/empty-module.js" },
      "node:path": { browser: "./lib/empty-module.js" },
      "node:stream": { browser: "./lib/empty-module.js" },
      "node:crypto": { browser: "./lib/empty-module.js" },
      "node:http": { browser: "./lib/empty-module.js" },
      "node:https": { browser: "./lib/empty-module.js" },
      fs: { browser: "./lib/empty-module.js" },
      net: { browser: "./lib/empty-module.js" },
      tls: { browser: "./lib/empty-module.js" },
      http: { browser: "./lib/empty-module.js" },
      https: { browser: "./lib/empty-module.js" },
    },
  },

  // Ensure build fails on TypeScript errors (matches Vercel behavior)
  typescript: {
    ignoreBuildErrors: false,
  },

  async headers() {
    return [
      {
        // Apply security headers to all routes
        source: "/(.*)",
        headers: securityHeaders,
      },
    ]
  },

  webpack: (config, { isServer }) => {
    // Handle canvas module for jsPDF
    config.resolve.alias.canvas = false
    config.resolve.alias.encoding = false

    // Externalize certain modules that have issues with webpack
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        http: false,
        https: false,
      }

      // Handle node: scheme for modern Node modules
      config.resolve.alias = {
        ...config.resolve.alias,
        "node:fs": false,
        "node:net": false,
        "node:tls": false,
        "node:path": false,
        "node:stream": false,
        "node:crypto": false,
        "node:http": false,
        "node:https": false,
      }

      // Specifically handle 'node:' scheme imports by treating them as externals or ignoring them
      config.externals = [
        ...(config.externals || []),
        ({ request }, callback) => {
          if (/^node:/.test(request)) {
            return callback(null, "{}")
          }
          callback()
        },
      ]
    }

    return config
  },
}

export default nextConfig
