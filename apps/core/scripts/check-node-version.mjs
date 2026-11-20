// Fails a local dev/build when the running Node does not match the version pinned in .nvmrc.
// Hosted builds are skipped: CI selects Node from .nvmrc via actions/setup-node and Vercel reads
// the same file, so `engine-strict` in .npmrc already guards those environments.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

function readPinnedNodeMajor() {
  try {
    const pinned = readFileSync(path.join(repoRoot, '.nvmrc'), 'utf8').trim()
    return pinned.split('.')[0] || null
  } catch {
    return null
  }
}

if (process.env.CI || process.env.VERCEL) {
  process.exit(0)
}

const expectedMajor = readPinnedNodeMajor()

if (!expectedMajor) {
  console.warn('[check-node-version] Could not read .nvmrc; skipping Node version check')
  process.exit(0)
}

const runningVersion = process.versions.node

if (runningVersion.split('.')[0] === expectedMajor) {
  process.exit(0)
}

console.error(
  [
    `[check-node-version] Running Node ${runningVersion} but this repo is pinned to Node ${expectedMajor} (.nvmrc).`,
    '',
    'Switch to the pinned version before running dev/build commands:',
    '  nvm use        # reads .nvmrc',
    '  fnm use        # reads .nvmrc',
    `  export PATH="/opt/homebrew/opt/node@${expectedMajor}/bin:$PATH"   # Homebrew`,
    '',
    'See package.json "engines" for the supported range.',
  ].join('\n'),
)
process.exit(1)
