/**
 * Where the private overlay writes into the public tree.
 *
 * Shared by `scripts/sync-private-overlay.mjs` (which copies the files) and
 * `scripts/check-private-files.mjs` (which refuses to publish them), so the mapping and the
 * `.gitignore` entries it must match can never disagree.
 */

import fs from 'node:fs'
import path from 'node:path'

/** Overlay directory -> destination directory, relative to the project root. */
export const DEST_ROOTS = {
  app: 'src/app',
  components: 'src/components',
  lib: 'src/lib',
  'admin-ui': 'src/admin-ui',
  test: 'test',
  scripts: 'scripts',
  public: 'public',
  docs: 'docs',
  content: 'content',
}

/** Overlay directories that are kept in the private repo only, or consumed by the sync
 * script instead of being copied (the tailwind theme is inlined into a generated module). */
export const NON_COPIED_DIRS = new Set(['src-legacy', 'tailwind'])

/**
 * Every file the overlay writes, as project-relative paths.
 * @param {string} overlayRoot
 * @returns {string[]}
 */
export function listOverlayDestinations(overlayRoot) {
  const destinations = []
  if (!fs.existsSync(overlayRoot)) return destinations

  for (const [sourceDir, destinationRoot] of Object.entries(DEST_ROOTS)) {
    const sourceRoot = path.join(overlayRoot, sourceDir)
    if (!fs.existsSync(sourceRoot)) continue

    const walk = (current) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (entry.name === '.DS_Store' || entry.name === '.git') continue
        const absolute = path.join(current, entry.name)
        if (entry.isDirectory()) walk(absolute)
        else if (entry.isFile()) destinations.push(path.join(destinationRoot, path.relative(sourceRoot, absolute)))
      }
    }

    walk(sourceRoot)
  }

  return destinations
}
