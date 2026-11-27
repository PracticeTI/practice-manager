/**
 * Whether a version is sitting on `main` unpublished.
 *
 * A release takes two pushes to `main`: the release pull request writes the version bump and the
 * CHANGELOG entry, and the next push tags that merge. `package.json` carrying a version that no
 * `v<version>` tag points at is what tells the two apart, so the `Release` workflow runs the
 * release pull request job while the version is tagged and the publish job while it is not.
 *
 * Run directly, it writes `pending`, `version` and `latest_tag` as GitHub Actions step outputs.
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const TAG_PATTERN = 'v[0-9]*'

export function readReleaseState(cwd = process.cwd()) {
  const { version } = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'))

  let latestTag = null
  try {
    latestTag = execFileSync('git', ['describe', '--tags', '--abbrev=0', '--match', TAG_PATTERN], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    // No tag on this branch yet: the first release is still to be cut.
  }

  return { version, latestTag, pending: latestTag !== null && latestTag !== `v${version}` }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { version, latestTag, pending } = readReleaseState()

  console.log(
    pending
      ? `package.json is at ${version} and the latest tag is ${latestTag}: that version is merged but not published yet.`
      : `package.json is at ${version} and the latest tag is ${latestTag ?? '(none)'}: nothing is waiting to be published.`
  )

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `version=${version}\nlatest_tag=${latestTag ?? ''}\npending=${pending}\n`
    )
  }
}
