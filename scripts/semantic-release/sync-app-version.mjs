/**
 * semantic-release plugin: mirror the released version into the app's own manifest.
 *
 * `apps/core/next.config.js` reads `NEXT_PUBLIC_APP_VERSION` from `apps/core/package.json`, but
 * `@semantic-release/npm` only versions the workspace root. This runs after that plugin (see the
 * plugin order in `release.config.mjs`) and refreshes the lockfile so the workspace entry keeps
 * matching the manifest.
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const APP_MANIFEST = path.join('apps', 'core', 'package.json')

/** @param {import('semantic-release').PrepareContext} context */
export async function prepare(pluginConfig, { cwd, nextRelease, logger }) {
  const manifestPath = path.join(cwd, APP_MANIFEST)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

  if (manifest.version === nextRelease.version) {
    logger.log('apps/core/package.json is already at %s', nextRelease.version)
    return
  }

  manifest.version = nextRelease.version
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  logger.log('Wrote version %s to %s', nextRelease.version, APP_MANIFEST)

  execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd,
    stdio: 'inherit',
  })
}
