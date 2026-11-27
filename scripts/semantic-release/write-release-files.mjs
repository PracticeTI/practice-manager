/**
 * Write a computed release into the manifests and CHANGELOG, ahead of the release pull request.
 *
 * These are the writes `@semantic-release/changelog`, `@semantic-release/npm` and the old
 * app-version sync performed as prepare steps of the release itself. They happen here instead
 * because `main` is protected: the result goes onto a `release/next` branch that reaches `main`
 * through a pull request, and the publish run only tags it.
 *
 * The repository has a single version across all workspaces, so the release touches the root
 * manifests plus the app manifest that `next.config.js` reads `NEXT_PUBLIC_APP_VERSION` from.
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// The changelog entry is written by the plugin that used to run the step, so CHANGELOG.md keeps its
// exact format: release notes already carry the `## version (date)` heading and compare link.
import changelog from '@semantic-release/changelog'

export const RELEASE_MANIFESTS = ['package.json', path.join('apps', 'core', 'package.json')]

const CHANGELOG_CONFIG = { changelogFile: 'CHANGELOG.md', changelogTitle: '# Changelog' }

/**
 * @param {object} release
 * @param {string} release.cwd Repository root.
 * @param {string} release.version Version to write.
 * @param {string} release.notes Release notes from `@semantic-release/release-notes-generator`.
 * @param {{log: Function}} [release.logger]
 * @returns {Promise<string[]>} The manifests whose version changed.
 */
export async function writeReleaseFiles({ cwd = process.cwd(), version, notes, logger = console }) {
  const written = []

  for (const manifestPath of RELEASE_MANIFESTS) {
    const absolutePath = path.join(cwd, manifestPath)
    const manifest = JSON.parse(fs.readFileSync(absolutePath, 'utf8'))

    if (manifest.version === version) continue

    manifest.version = version
    fs.writeFileSync(absolutePath, `${JSON.stringify(manifest, null, 2)}\n`)
    written.push(manifestPath)
    logger.log('Wrote version %s to %s', version, manifestPath)
  }

  await changelog.prepare(CHANGELOG_CONFIG, { cwd, nextRelease: { notes }, logger })

  // `@semantic-release/npm` refreshed the lockfile as part of writing the version; the manifest is
  // written here now, so refresh it here too, for the root and the workspace entries alike.
  execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd,
    stdio: 'inherit',
  })

  return written
}
