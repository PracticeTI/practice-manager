/**
 * semantic-release plugin: tag only the version that the release pull request merged.
 *
 * `release.config.mjs` no longer writes the manifests — `release-pr.mjs` does, through a pull
 * request — so this is what keeps the tag, `package.json` and the CHANGELOG entry from drifting
 * apart. A dry run publishes nothing and has to be able to analyse commits that are not released
 * yet, so the check only applies to a real release.
 */

import fs from 'node:fs'
import path from 'node:path'

/** @param {import('semantic-release').VerifyReleaseContext} context */
export async function verifyRelease(pluginConfig, { cwd, nextRelease, options, logger }) {
  if (options.dryRun) return

  const { version } = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'))

  if (version !== nextRelease.version) {
    throw new Error(
      `package.json is at ${version}, but the commits on this branch analyse to ${nextRelease.version}. ` +
        'A release only publishes the version its release pull request merged, so run the Release PR ' +
        'job to bring the manifests and CHANGELOG up to date before tagging.'
    )
  }

  logger.log('package.json is at %s, the version about to be tagged', version)
}
