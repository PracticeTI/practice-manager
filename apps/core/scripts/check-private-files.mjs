#!/usr/bin/env node
/**
 * Fail when private overlay files would enter the public repository.
 *
 * `scripts/sync-private-overlay.mjs` copies the private overlay into the public layout, and
 * `.gitignore` lists every destination it writes. Three invariants keep those copies out of
 * this repository's history:
 *
 *   1. No tracked file may match an ignore rule. A file that is tracked *and* ignored means
 *      someone committed an overlay copy (or a stale ignore entry hides a file it should not).
 *   2. No pushed commit may add a path the overlay produces. This is checked against
 *      `.private-overlay.json`, the manifest of the last mount.
 *   3. Every path the overlay would write must be excluded by the ignore rules, so a newly
 *      added private folder cannot silently escape the list. Needs the submodule on disk.
 *
 * All three run from the pre-push hook (`.githooks/pre-push`). CI runs invariant 1: it has no
 * private submodule, so the manifest and the overlay tree are not there to compare.
 *
 * Usage:
 *   node scripts/check-private-files.mjs                    # check the index and the ignore list
 *   node scripts/check-private-files.mjs --range A..B       # also check added paths in A..B
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { listOverlayDestinations } from './private-overlay-paths.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = path.join(repoRoot, '.private-overlay.json')

/** The empty tree, used as the base when a pushed branch is new to the remote. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

const problems = []

function git(args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    if (allowFailure) return null
    throw error
  }
}

function report(problem) {
  problems.push(problem)
}

/** Invariant 1: nothing in the index may be excluded by the ignore rules. */
function checkTrackedIgnoredFiles() {
  const output = git(['ls-files', '-z', '-i', '-c', '--exclude-standard'], { allowFailure: true })
  if (output === null) return

  for (const relativePath of output.split('\0').filter(Boolean)) {
    report(
      `${relativePath} is tracked but ignored by .gitignore - it is an overlay copy that must not be committed.\n` +
        `  fix: git rm --cached "${relativePath}"`
    )
  }
}

/** Overlay destinations recorded by the last `npm run private:sync`, or an empty set. */
function readOverlayPaths() {
  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch {
    return new Set()
  }

  return new Set(Array.isArray(manifest?.files) ? manifest.files : [])
}

/** Invariant 2: a pushed commit must not add a path the overlay produces. */
function checkRanges(ranges, overlayPaths) {
  if (overlayPaths.size === 0) return

  for (const range of ranges) {
    // A bare `<head>` means the branch is new to the remote, so every path in it is compared.
    const [rawBase, rawHead] = range.includes('..') ? range.split('..') : [EMPTY_TREE, range]
    if (!rawBase || !rawHead) {
      report(`ignoring malformed range "${range}" - expected <base>..<head> or <head>`)
      continue
    }

    const head = git(['rev-parse', '--verify', `${rawHead}^{commit}`], { allowFailure: true })
    if (head === null) continue

    // A base the local repository does not know (a branch the remote moved, or a fetch that has
    // not happened yet) falls back to the empty tree so every path in the branch is inspected.
    const base = rawBase === EMPTY_TREE || git(['rev-parse', '--verify', `${rawBase}^{tree}`], { allowFailure: true }) !== null
      ? rawBase
      : EMPTY_TREE

    const output = git(['diff', '--name-only', '-z', '--diff-filter=A', base, head.trim()], { allowFailure: true })
    if (output === null) continue

    for (const relativePath of output.split('\0').filter(Boolean)) {
      if (!overlayPaths.has(relativePath)) continue
      report(
        `${relativePath} is a private overlay path and would be pushed in ${range}.\n` +
          `  fix: git rm --cached "${relativePath}" and amend or revert the commit`
      )
    }
  }
}

/** Invariant 3: every path the overlay writes must be excluded by the ignore rules. */
function checkIgnoreCoverage() {
  const destinations = listOverlayDestinations(path.join(repoRoot, 'src/private/overlay'))
  // No submodule and nothing mounted (CI, or a public-only checkout): nothing to compare.
  if (destinations.length === 0) return

  let output = ''
  try {
    output = execFileSync('git', ['check-ignore', '--stdin'], {
      cwd: repoRoot,
      encoding: 'utf8',
      input: `${destinations.join('\n')}\n`,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch (error) {
    // Exit 1 means no path matched at all, which the loop below reports one path at a time.
    output = String(error?.stdout || '')
  }

  const ignored = new Set(output.split('\n').filter(Boolean))
  for (const destination of destinations) {
    if (ignored.has(destination)) continue
    report(
      `${destination} is written by the private overlay but .gitignore does not exclude it.\n` +
        '  fix: add it to the private domain overlay section of .gitignore'
    )
  }
}

const ranges = []
for (let index = 2; index < process.argv.length; index += 1) {
  if (process.argv[index] === '--range' && process.argv[index + 1]) {
    ranges.push(process.argv[index + 1])
    index += 1
  } else {
    ranges.push(process.argv[index])
  }
}

checkTrackedIgnoredFiles()
checkIgnoreCoverage()
checkRanges(ranges, readOverlayPaths())

if (problems.length > 0) {
  process.stderr.write(`[private-guard] refusing to publish private overlay files:\n  ${problems.join('\n  ')}\n`)
  process.exit(1)
}

process.stdout.write('[private-guard] no private overlay files in the repository\n')
