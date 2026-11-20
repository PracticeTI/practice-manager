#!/usr/bin/env node
/**
 * Assemble the self-contained server the installer ships.
 *
 *   npm run build && npm run prepare:standalone --workspace @practice-manager/desktop
 *
 * `next build` emits `.next/standalone` (server.js, traced node_modules, app code) but
 * leaves out the static assets and `public/`, which it expects the host to copy. This
 * stages one directory that can be pointed at directly — `node server.js` — by the shell,
 * the Docker image or an operator.
 */

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const CORE = path.join(REPO_ROOT, 'apps', 'core')
const STANDALONE = path.join(CORE, '.next', 'standalone')
// Tracing runs from the monorepo root, so the output mirrors the workspace:
// `apps/core/server.js`, `packages/`, and the hoisted `node_modules`.
const APP_IN_STANDALONE = path.join(STANDALONE, 'apps', 'core')
const STAGE = path.join(REPO_ROOT, 'deploy', 'desktop', '.stage', 'standalone')

function fail(message) {
  console.error(`[prepare] ${message}`)
  process.exit(1)
}

if (!existsSync(path.join(APP_IN_STANDALONE, 'server.js'))) {
  fail('no standalone build found — run `npm run build` first')
}

rmSync(STAGE, { recursive: true, force: true })
mkdirSync(path.dirname(STAGE), { recursive: true })
cpSync(STANDALONE, STAGE, { recursive: true })

// Next documents these two as the host's responsibility for standalone output.
cpSync(path.join(CORE, '.next', 'static'), path.join(STAGE, 'apps', 'core', '.next', 'static'), { recursive: true })

if (existsSync(path.join(CORE, 'public'))) {
  cpSync(path.join(CORE, 'public'), path.join(STAGE, 'apps', 'core', 'public'), { recursive: true })
}

// Report templates are read from disk at runtime (outputFileTracingIncludes covers one
// route); copying the tree removes any doubt for the desktop install.
if (existsSync(path.join(CORE, 'content'))) {
  cpSync(path.join(CORE, 'content'), path.join(STAGE, 'apps', 'core', 'content'), { recursive: true })
}

console.log(`[prepare] staged ${path.relative(REPO_ROOT, STAGE)}`)
