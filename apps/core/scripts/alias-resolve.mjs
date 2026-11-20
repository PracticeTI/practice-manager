/**
 * Resolve the app's `@/` path alias for plain `node` scripts.
 *
 * Next.js resolves `@/lib/...` from `jsconfig.json`, but a script run outside the bundler
 * (schema bootstrap, maintenance jobs) gets no such help. This hook maps the alias onto
 * `apps/core/src`, mirroring the jsconfig paths so one import style works in both.
 */

import { statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')

function isFile(candidate) {
  try {
    return statSync(candidate).isFile()
  } catch {
    return false
  }
}

function resolveAliasedPath(specifier) {
  const base = path.join(SRC_ROOT, specifier.slice(2))
  const candidates = [
    base,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    path.join(base, 'index.js'),
    path.join(base, 'index.jsx'),
  ]

  return candidates.find(isFile) || null
}

export async function resolve(specifier, context, nextResolve) {
  // Next's own resolver allows extensionless subpaths (`next/server`); plain Node ESM
  // needs the file (`next/server.js`). Try the sibling before giving up.
  if (specifier.startsWith('next/') && !specifier.endsWith('.js')) {
    try {
      return await nextResolve(`${specifier}.js`, context)
    } catch {
      // fall through to the original specifier
    }
  }

  if (specifier.startsWith('@/')) {
    const resolved = resolveAliasedPath(specifier)
    if (resolved) {
      return { url: pathToFileURL(resolved).href, shortCircuit: true }
    }
    throw new Error(`Cannot resolve "${specifier}" from ${context.parentURL || 'the entry point'}`)
  }

  return nextResolve(specifier, context)
}
