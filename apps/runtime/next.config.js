import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const projectRoot = path.dirname(fileURLToPath(import.meta.url))
// The workspace hoists dependencies to the monorepo root, so tracing has to start there
// for a packaged runtime (Docker image, Cloud Run job) to be self-contained.
const monorepoRoot = path.resolve(projectRoot, '..', '..')
const tracingRoot = fs.existsSync(path.join(monorepoRoot, 'package-lock.json')) ? monorepoRoot : projectRoot

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: tracingRoot,
  // The jobs package reaches its database driver through a non-literal import, so `pg`
  // stays external instead of being bundled. The deprecated MySQL and MongoDB drivers are
  // listed to keep a bundler from trying to resolve packages this distribution omits.
  serverExternalPackages: ['pg', 'mysql2', 'mongodb'],
  turbopack: {
    // Must match outputFileTracingRoot: tracing walks the hoisted workspace tree.
    root: tracingRoot,
  },
}

export default nextConfig
