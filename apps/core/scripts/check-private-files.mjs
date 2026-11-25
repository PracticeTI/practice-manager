#!/usr/bin/env node
/**
 * Fail when private overlay files would enter the public repository.
 *
 * `scripts/sync-private-overlay.mjs` copies the private overlay into the public layout, and
 * records every destination in the checkout-local `.git/info/exclude` (see
 * `private-overlay-excludes.mjs`). Three invariants keep those copies out of this
 * repository's history:
 *
 *   1. No tracked file may match an ignore rule. A file that is tracked *and* ignored means
 *      someone committed an overlay copy (or a stale ignore entry hides a file it should not).
 *   2. No pushed commit may add a path the overlay produces. This is checked against
 *      `.private-overlay.json`, the manifest of the last mount.
 *   3. Every path the overlay would write must be excluded by the ignore rules, so a newly
 *      added private folder cannot silently escape the list. Uses the mounted overlay tree
 *      when it is on disk, and the last mount's manifest otherwise.
 *   4. No tracked file inside a `supabase/` directory may name a private domain. Branching
 *      reads that directory from the public repository and replays it on every preview branch,
 *      so a customer name committed there is published twice.
 *
 * Invariants 1-3 and 4 run from the pre-push hook (`.githooks/pre-push`). CI runs invariant 1:
 * it has no private submodule, so the manifest, the overlay tree and the domain registry are not
 * there to compare, and invariant 4 has no terms to look for.
 *
 * Usage:
 *   node scripts/check-private-files.mjs                    # check the index and the ignore list
 *   node scripts/check-private-files.mjs --range A..B       # also check added paths in A..B
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { listOverlayDestinations } from './private-overlay-paths.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = path.join(repoRoot, '.private-overlay.json')

/** The empty tree, used as the base when a pushed branch is new to the remote. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

const problems = []

function gitAt(cwd, args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    if (allowFailure) return null
    throw error
  }
}

function git(args, options) {
  return gitAt(repoRoot, args, options)
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
      `${relativePath} is tracked but ignored - it is an overlay copy that must not be committed.\n` +
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

/** Overlay tree for coverage checks: PRIVATE_OVERLAY_DIR, then the git submodule. */
function resolveOverlayRoot() {
  const explicitDir = String(process.env.PRIVATE_OVERLAY_DIR || '').trim()
  if (explicitDir) {
    const resolved = path.resolve(repoRoot, explicitDir)
    if (fs.existsSync(resolved)) return resolved
  }

  const submoduleOverlayRoot = path.join(repoRoot, 'src/private/overlay')
  return fs.existsSync(submoduleOverlayRoot) ? submoduleOverlayRoot : null
}

/** Invariant 3: every path the overlay writes must be excluded by the ignore rules. */
function checkIgnoreCoverage(overlayPaths) {
  const overlayRoot = resolveOverlayRoot()
  // Without the overlay tree, fall back to the last mount's manifest (generated files included).
  const destinations = overlayRoot ? listOverlayDestinations(overlayRoot) : [...overlayPaths]
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
      `${destination} is written by the private overlay but no ignore rule excludes it.\n` +
        '  fix: run `npm run private:sync` to refresh the checkout-local exclude rules'
    )
  }
}

/** Domain terms the private overlay keeps out of the public tree; empty when it is not mounted. */
async function readPrivateDomainTerms() {
  const registryPath = path.join(repoRoot, 'src/lib/privateDomains.js')
  if (!fs.existsSync(registryPath)) return []

  let registry
  try {
    registry = await import(pathToFileURL(registryPath).href)
  } catch {
    // The generated module and its data file are removed together; a half-cleaned tree has no terms.
    return []
  }

  const terms = new Set()
  for (const domain of Array.isArray(registry.PRIVATE_DOMAINS) ? registry.PRIVATE_DOMAINS : []) {
    // The customer's own name and host labels identify them just as well as a full hostname.
    const values = [domain?.key, domain?.label, ...(domain?.hostnames ?? []), ...(domain?.hostLabels ?? [])]
    for (const value of values) {
      if (typeof value !== 'string') continue
      const term = value.trim()
      if (term.length >= 4) terms.add(term)
    }
  }

  return [...terms]
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Terms that appear as a whole word, so `novi` does not match `novitas`. */
function privateTermsIn(text, terms) {
  return terms.filter((term) => new RegExp(`(?<![a-z0-9-])${escapeRegExp(term)}(?![a-z0-9-])`, 'i').test(text))
}

/** The largest Supabase file worth scanning; a migration or seed is far smaller. */
const TEXT_FILE_LIMIT = 512 * 1024

function readTrackedText(absolutePath) {
  try {
    const stat = fs.statSync(absolutePath)
    if (!stat.isFile() || stat.size > TEXT_FILE_LIMIT) return null
    const buffer = fs.readFileSync(absolutePath)
    return buffer.includes(0) ? null : buffer.toString('utf8')
  } catch {
    return null
  }
}

/** Files the Supabase CLI publishes from a `supabase/` directory, wherever it sits. */
function isInSupabaseDirectory(relativePath) {
  return relativePath.startsWith('supabase/') || relativePath.includes('/supabase/')
}

/**
 * Tracked files belonging to a Supabase project. Prefers directories that carry a config file,
 * so a documentation folder that happens to be called `supabase` is not scanned; a migrations-only
 * directory (no config yet) still is.
 */
function supabaseProjectFiles(relativePaths) {
  const roots = new Set()
  for (const relativePath of relativePaths) {
    const match = relativePath.match(/^(?:(.*)\/)?supabase\/config\.(?:toml|jsonc)$/)
    if (!match) continue
    roots.add(match[1] ? `${match[1]}/supabase/` : 'supabase/')
  }

  if (roots.size === 0) return relativePaths.filter(isInSupabaseDirectory)
  return relativePaths.filter((relativePath) => [...roots].some((root) => relativePath.startsWith(root)))
}

/** Invariant 4: Supabase config, migrations and seeds must not name a private domain. */
async function checkSupabaseContent() {
  const gitRoot = git(['rev-parse', '--show-toplevel'], { allowFailure: true })?.trim()
  if (!gitRoot) return

  const tracked = gitAt(gitRoot, ['ls-files', '-z'], { allowFailure: true })
  if (tracked === null) return

  const files = supabaseProjectFiles(tracked.split('\0').filter(Boolean))
  if (files.length === 0) return

  const terms = await readPrivateDomainTerms()
  if (terms.length === 0) return

  for (const relativePath of files) {
    const text = readTrackedText(path.join(gitRoot, relativePath))
    if (text === null) continue

    const matches = []
    const seen = new Set()
    for (const term of privateTermsIn(text, terms)) {
      // `key`, `label` and hostnames repeat the same brand; one mention per name is enough.
      if (seen.has(term.toLowerCase())) continue
      seen.add(term.toLowerCase())
      matches.push(term)
    }
    if (matches.length === 0) continue

    report(
      `${relativePath} names ${matches.length === 1 ? 'the private domain' : 'private domains'} ` +
        `${matches.map((term) => `"${term}"`).join(', ')} and would be published.\n` +
        '  fix: keep customer names out of supabase/ - seeds and migrations need synthetic values'
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
const overlayPaths = readOverlayPaths()
checkIgnoreCoverage(overlayPaths)
checkRanges(ranges, overlayPaths)
await checkSupabaseContent()

if (problems.length > 0) {
  process.stderr.write(`[private-guard] refusing to publish private data:\n  ${problems.join('\n  ')}\n`)
  process.exit(1)
}

process.stdout.write('[private-guard] no private data in the repository\n')
