/**
 * Point this checkout at the tracked hooks in `.githooks`.
 *
 * `prepare` runs after `npm install`, so the pre-push guard is installed without a manual step.
 * An existing `core.hooksPath` is left alone: a contributor who already chose one (husky, or a
 * global setting) keeps it rather than having it silently replaced.
 */

import { execFileSync } from 'node:child_process'

function gitOrNull(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

if (gitOrNull(['rev-parse', '--is-inside-work-tree']) !== 'true') process.exit(0)

if (gitOrNull(['config', '--get', 'core.hooksPath'])) {
  process.stdout.write('[hooks] core.hooksPath is already set; leaving it as is\n')
  process.exit(0)
}

execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'inherit' })
process.stdout.write('[hooks] core.hooksPath -> .githooks\n')
