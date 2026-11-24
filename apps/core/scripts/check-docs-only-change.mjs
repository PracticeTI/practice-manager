#!/usr/bin/env node
/**
 * Vercel Ignored Build Step, wired up as `ignoreCommand` in `vercel.json`.
 *
 * Vercel runs this before it installs anything and skips the build when it exits 0, so a
 * documentation-only commit costs no build minutes. Exit 0 means every changed path is
 * documentation: markdown anywhere, or the repository-level `docs/` tree. Anything else builds.
 *
 * The diff is taken from the repository root rather than from this workspace: the app bundles
 * `packages/` at build time, so a change there has to rebuild even though no file under
 * `apps/core` moved.
 *
 * Every failure path (no checkout, a shallow clone without the parent commit, a git error) exits
 * 1. A build nobody needed wastes a few minutes; a skipped build ships nothing at all.
 *
 * Redeploys apply the same rule with "Use project's Ignore Build Step" ticked in the redeploy
 * dialog. Untick it when the new deployment is the point, such as after changing environment
 * variables.
 */

import { execFileSync } from 'node:child_process'

const DOCUMENTATION = [/\.md$/i, /^docs\//]

/** True when no path outside documentation changed. An empty diff has no code to ship either. */
export function isDocumentationOnly(changedPaths) {
  return changedPaths.every((changedPath) => DOCUMENTATION.some((pattern) => pattern.test(changedPath)))
}

function git(args, options = {}) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options })
  } catch {
    return null
  }
}

function firstNonDocumentationPath(changedPaths) {
  return changedPaths.find((changedPath) => !isDocumentationOnly([changedPath]))
}

const toplevel = git(['rev-parse', '--show-toplevel'])
if (toplevel === null) {
  process.stdout.write('[vercel-ignore] building: not inside a git checkout\n')
  process.exit(1)
}

const diff = git(['diff', '--name-only', '-z', 'HEAD^', 'HEAD'], { cwd: toplevel.trim() })
if (diff === null) {
  process.stdout.write('[vercel-ignore] building: no parent commit to diff against\n')
  process.exit(1)
}

const changedPaths = diff.split('\0').filter(Boolean)
if (isDocumentationOnly(changedPaths)) {
  process.stdout.write(`[vercel-ignore] skipping build: ${changedPaths.length} documentation file(s)\n`)
  process.exit(0)
}

process.stdout.write(`[vercel-ignore] building: ${firstNonDocumentationPath(changedPaths)} is not documentation\n`)
process.exit(1)
