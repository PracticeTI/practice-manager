import { createRequire } from 'module'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
const require = createRequire(import.meta.url)
// semantic-release keeps this version current on each release; see docs/developer-guide/versioning.md.
const { version } = require('./package.json')
// AGPL-3.0 section 13: network users must be offered the source of the version they interact with.
// Operators of a modified copy point this at their own repository.
const sourceUrl = process.env.NEXT_PUBLIC_SOURCE_URL || 'https://github.com/PracticeTI/practice-manager'
const projectRoot = path.dirname(fileURLToPath(import.meta.url))
// Standalone tracing only follows files inside the tracing root, and this workspace hoists
// its dependencies to the monorepo root. Trace from there so the bundle is self-contained.
const monorepoRoot = path.resolve(projectRoot, '..', '..')
const tracingRoot = fs.existsSync(path.join(monorepoRoot, 'package-lock.json')) ? monorepoRoot : projectRoot

// Domains from the optional private overlay (see scripts/sync-private-overlay.mjs).
const { getPrivateDevOrigins } = await import('./src/lib/domainExtension.js')
const privateDevOrigins = getPrivateDevOrigins()

// Which API routes bind app.current_domain, captured for the admin RLS panel. It runs
// after the overlay sync in `prebuild`, so private-domain routes are classified too,
// and it is injected rather than read at request time because a serverless unit has no
// source tree. lib/rlsRouteCoverage.js is the same classifier `npm run rls:coverage` prints.
const { collectRouteCoverage } = await import('./src/lib/rlsRouteCoverageFiles.js')
const rlsRouteCoverage = collectRouteCoverage(path.join(projectRoot, 'src', 'app', 'api'))

/** First non-empty environment variable from `names`. */
function firstEnv(...names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim()
    if (value) return value
  }
  return ''
}

function gitOutput(command) {
  try {
    return execSync(command, { cwd: projectRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return ''
  }
}

// Build identity, resolved the same way everywhere so the fields survive a move between
// hosts: each provider's variable name is tried in order and the first non-empty value wins.
// Vercel uses VERCEL_GIT_COMMIT_*, Cloud Build injects COMMIT_SHA/BUILD_ID for free, GitHub
// Actions supplies GITHUB_SHA. The git fallback only covers local builds — images that
// exclude .git (see two/.dockerignore) must pass BUILD_COMMIT_SHA in instead.
const buildCommit = firstEnv('BUILD_COMMIT_SHA', 'VERCEL_GIT_COMMIT_SHA', 'COMMIT_SHA', 'GITHUB_SHA')
  || gitOutput('git rev-parse HEAD')
const buildRef = firstEnv('BUILD_COMMIT_REF', 'VERCEL_GIT_COMMIT_REF', 'GITHUB_REF_NAME')
  || gitOutput('git rev-parse --abbrev-ref HEAD')
const buildId = firstEnv('BUILD_ID', 'GITHUB_RUN_NUMBER')

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: [
    'localhost',
    ...privateDevOrigins,
  ],
  outputFileTracingRoot: tracingRoot,
  // Ships a self-contained server under `.next/standalone` for the desktop installer and
  // the Docker image. Vercel ignores it.
  output: 'standalone',
  // The jobs package opens its own connection per cycle and reaches the drivers through
  // dynamic `import()`, so the drivers stay external: `pg` is the only one this
  // distribution installs, and the deprecated MySQL/Mongo branches must not force a build
  // to resolve packages the product does not ship. The jobs package itself is bundled —
  // that keeps the standalone build (desktop installer, Docker image) self-contained.
  serverExternalPackages: ['pg', 'mysql2', 'mongodb'],
  turbopack: {
    // Must match outputFileTracingRoot: tracing walks the hoisted workspace tree.
    root: tracingRoot,
  },
  experimental: {
    // Next.js buffers request bodies in memory so the proxy (middleware.js) and the
    // route handler can both read them. Anything beyond this limit is silently
    // truncated, which makes request.formData() fail for multipart uploads.
    // Keep this above the largest accepted upload: MAX_FILE_SIZE_BYTES (25MB) in
    // src/app/api/database/patient-files/route.js, plus multipart overhead.
    proxyClientMaxBodySize: '30mb',
  },
  images: {
    qualities: [75, 78, 82],
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
    NEXT_PUBLIC_BUILD_COMMIT: buildCommit,
    NEXT_PUBLIC_BUILD_REF: buildRef,
    NEXT_PUBLIC_BUILD_ID: buildId,
    NEXT_PUBLIC_SOURCE_URL: sourceUrl,
    // Consumed only by the server-side RLS routes; never referenced from client code.
    PRACTICE_RLS_ROUTE_COVERAGE: JSON.stringify(rlsRouteCoverage),
  },
  outputFileTracingExcludes: {
    '/api/images/local': ['./.git/**/*', './media/**/*', './content/**/*', './.next/cache/**/*', './package-lock.json'],
    '/api/images/resolve': ['./.git/**/*', './media/**/*', './content/**/*', './.next/cache/**/*', './package-lock.json'],
  },
  outputFileTracingIncludes: {
    // Template Library reads private .md templates from ./content at runtime. Runtime
    // fs reads aren't statically traceable, so the directory must be bundled explicitly.
    '/api/settings/reports/template-library': ['./content/**/*'],
  },
  async headers() {
    return [
      {
        // Allow CORS from admin portal
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,DELETE,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization, Cache-Control, Pragma' },
        ],
      },
    ]
  },
}

export default nextConfig