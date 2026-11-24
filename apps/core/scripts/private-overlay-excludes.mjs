/**
 * Checkout-local ignore rules for the private overlay.
 *
 * `scripts/sync-private-overlay.mjs` copies private files into the public layout, and those
 * copies must never be committed. Listing them in the tracked `.gitignore` would publish the
 * private domains and file names, so the sync writes them to `.git/info/exclude` instead — a
 * per-clone file that git never commits. `scripts/check-private-files.mjs` still verifies
 * coverage through `git check-ignore`, which reads the same rules.
 *
 * The block is rewritten on every mount and removed by `private:clean`, so it always matches
 * the files the last sync wrote.
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

export const EXCLUDE_BLOCK_BEGIN = '# >>> private overlay (managed by npm run private:sync) >>>'
export const EXCLUDE_BLOCK_END = '# <<< private overlay <<<'

function git(repoRoot, args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
}

/**
 * Resolve the checkout's `info/exclude` path.
 *
 * Returns null outside a git checkout (a Docker build, a source archive), where nothing can
 * be committed and therefore nothing needs excluding.
 *
 * @param {string} repoRoot
 * @returns {{ topLevel: string, excludePath: string } | null}
 */
export function resolveExcludeLocation(repoRoot) {
  try {
    const topLevel = path.resolve(repoRoot, git(repoRoot, ['rev-parse', '--show-toplevel']))
    const excludePath = path.resolve(repoRoot, git(repoRoot, ['rev-parse', '--git-path', 'info/exclude']))
    return { topLevel, excludePath }
  } catch {
    return null
  }
}

/** Escape a path so gitignore treats every character literally. */
function escapePattern(relativePath) {
  let escaped = ''
  for (const character of relativePath) {
    escaped += '\\*?[]'.includes(character) ? `\\${character}` : character
  }
  if (escaped.endsWith(' ')) escaped = `${escaped.slice(0, -1)}\\ `
  return escaped
}

/**
 * Build the managed block for repo-relative paths.
 *
 * Patterns are anchored to the repository root, where `info/exclude` lives, and escaped so a
 * path containing brackets or backslashes stays literal.
 *
 * @param {string[]} relativePaths
 * @returns {string}
 */
export function buildExcludeBlock(relativePaths) {
  const patterns = [...new Set(relativePaths.map((value) => String(value || '').trim()).filter(Boolean))]
    .map((relativePath) => escapePattern(`/${relativePath.split(path.sep).join('/')}`))
    .sort()
  return `${[EXCLUDE_BLOCK_BEGIN, ...patterns, EXCLUDE_BLOCK_END].join('\n')}\n`
}

function stripManagedBlock(contents) {
  const lines = contents.split('\n')
  const kept = []
  let inside = false
  for (const line of lines) {
    if (line === EXCLUDE_BLOCK_BEGIN) {
      inside = true
      continue
    }
    if (inside) {
      if (line === EXCLUDE_BLOCK_END) inside = false
      continue
    }
    kept.push(line)
  }
  return kept.join('\n').replace(/[\s\n]+$/, '')
}

/**
 * Rewrite the managed block in `.git/info/exclude`, leaving any user entries untouched.
 *
 * @param {string} repoRoot
 * @param {string[]} projectRelativePaths Paths relative to `repoRoot` (the app directory).
 * @returns {{ written: boolean, reason: string }}
 */
export function writeExcludeBlock(repoRoot, projectRelativePaths) {
  const location = resolveExcludeLocation(repoRoot)
  if (!location) return { written: false, reason: 'not a git checkout' }

  const repoRelativePaths = projectRelativePaths.map((relativePath) =>
    path.relative(location.topLevel, path.resolve(repoRoot, relativePath))
  )
  const existing = fs.existsSync(location.excludePath) ? fs.readFileSync(location.excludePath, 'utf8') : ''
  const base = stripManagedBlock(existing)
  const next = base ? `${base}\n\n${buildExcludeBlock(repoRelativePaths)}` : buildExcludeBlock(repoRelativePaths)
  if (next === existing) return { written: false, reason: 'unchanged' }

  fs.mkdirSync(path.dirname(location.excludePath), { recursive: true })
  fs.writeFileSync(location.excludePath, next)
  return { written: true, reason: 'updated' }
}

/**
 * Remove the managed block, keeping any user entries.
 *
 * @param {string} repoRoot
 * @returns {{ written: boolean, reason: string }}
 */
export function clearExcludeBlock(repoRoot) {
  const location = resolveExcludeLocation(repoRoot)
  if (!location || !fs.existsSync(location.excludePath)) return { written: false, reason: 'absent' }

  const existing = fs.readFileSync(location.excludePath, 'utf8')
  const base = stripManagedBlock(existing)
  const next = base ? `${base}\n` : ''
  if (next === existing) return { written: false, reason: 'unchanged' }

  fs.writeFileSync(location.excludePath, next)
  return { written: true, reason: 'cleared' }
}
