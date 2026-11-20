/**
 * Launch plan for the desktop shell.
 *
 * Everything the shell does to start the app is plain Node: choose a port, spawn the core
 * workspace with the right environment, wait for `/api/health`. Keeping it out of
 * `main/index.cjs` means it can be tested and exercised headlessly (`npm run serve`), and
 * the Electron process stays thin wiring.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
export const CORE_WORKSPACE = '@practice-manager/core'

/** Workers the desktop app runs in-process. A single install has no other host. */
export const WORKER_FLAGS = [
  'REPORT_WORKER_ENABLED',
  'ANALYSIS_WORKER_ENABLED',
  'SCRIBE_WORKER_ENABLED',
  'BILLING_WORKER_ENABLED',
  'EMAIL_WORKER_ENABLED',
]

/** True when the core workspace has a production build the shell can start. */
export function hasProductionBuild(repoRoot = REPO_ROOT) {
  return existsSync(path.join(repoRoot, 'apps', 'core', '.next', 'BUILD_ID'))
}

/**
 * Directory holding a staged standalone server (`apps/core/server.js` inside it).
 *
 * Packaged builds look in `resources/app/standalone`; a repository checkout falls back to
 * the staging directory produced by `prepare-standalone.mjs`. Returns null when neither
 * exists, which is what makes the shell ask for a build instead of failing obscurely.
 */
export function resolveStandaloneDir({ repoRoot = REPO_ROOT, resourcesPath } = {}) {
  const candidates = []
  if (resourcesPath) candidates.push(path.join(resourcesPath, 'app', 'standalone'))
  candidates.push(path.join(repoRoot, 'deploy', 'desktop', '.stage', 'standalone'))

  return candidates.find((dir) => existsSync(path.join(dir, 'apps', 'core', 'server.js'))) || null
}

/**
 * Environment for the spawned server.
 *
 * `INLINE_WORKERS=true` is what makes queue writes and worker cycles stay in this process.
 * Worker flags default to on, but an operator's explicit `false` wins.
 */
export function buildServerEnv(baseEnv = process.env, { port } = {}) {
  const env = { ...baseEnv, INLINE_WORKERS: 'true' }
  if (port) env.PORT = String(port)
  if (env.PRACTICE_MANAGER_EDITION === undefined) env.PRACTICE_MANAGER_EDITION = 'solo'

  for (const flag of WORKER_FLAGS) {
    if (env[flag] === undefined) env[flag] = 'true'
  }

  return env
}

/** The command that starts the built core app on `port`. */
export function resolveServerCommand({ repoRoot = REPO_ROOT, port, env = process.env, standaloneDir = null, nodePath = null } = {}) {
  const nodeCommand = nodePath || (process.platform === 'win32' ? 'node.exe' : 'node')

  if (standaloneDir) {
    return {
      command: nodeCommand,
      args: ['server.js'],
      options: {
        cwd: path.join(standaloneDir, 'apps', 'core'),
        // Standalone binds 0.0.0.0 by default; the desktop app is loopback only.
        env: { ...buildServerEnv(env, { port }), HOSTNAME: '127.0.0.1' },
      },
    }
  }

  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: ['run', 'start', '--workspace', CORE_WORKSPACE, '--', '-p', String(port)],
    options: { cwd: repoRoot, env: buildServerEnv(env, { port }) },
  }
}

/** First port at or above `startPort` that nothing is listening on. */
export async function findFreePort(startPort = 3000, { host = '127.0.0.1', attempts = 50 } = {}) {
  for (let port = startPort; port < startPort + attempts; port += 1) {
    const free = await new Promise((resolve) => {
      const server = net.createServer()
      server.once('error', () => resolve(false))
      server.once('listening', () => server.close(() => resolve(true)))
      server.listen(port, host)
    })

    if (free) return port
  }

  throw new Error(`No free port between ${startPort} and ${startPort + attempts - 1}`)
}

/**
 * Poll `/api/health` until the server answers or the deadline passes.
 *
 * Returns `{ ok: true }` on the first success and `{ ok: false, error }` otherwise; it
 * never throws, so the caller decides how to present the failure.
 */
export async function waitForHealth(baseUrl, { timeoutMs = 90000, intervalMs = 500, fetchImpl = globalThis.fetch } = {}) {
  const deadline = Date.now() + timeoutMs
  let lastError = 'no response'

  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2500) })
      if (response.ok) return { ok: true }
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error?.name === 'TimeoutError' ? 'request timed out' : (error?.message || 'request failed')
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  return { ok: false, error: lastError }
}

/**
 * Start the core app and wait until it answers.
 *
 * @param {{ repoRoot?: string, port?: number, env?: object, timeoutMs?: number, fetchImpl?: Function, onOutput?: (line: string) => void }} [options]
 * @returns {Promise<{ ok: boolean, port: number, baseUrl: string, child?: import('node:child_process').ChildProcess, error?: string }>}
 */
export async function startCoreServer(options = {}) {
  const repoRoot = options.repoRoot || REPO_ROOT
  const port = options.port || await findFreePort(3000)
  const { command, args, options: spawnOptions } = resolveServerCommand({
    repoRoot,
    port,
    env: options.env,
    standaloneDir: options.standaloneDir || null,
    nodePath: options.nodePath || null,
  })

  const child = spawn(command, args, { ...spawnOptions, stdio: ['ignore', 'pipe', 'pipe'] })

  const forward = (chunk) => {
    if (typeof options.onOutput !== 'function') return
    for (const line of String(chunk).split('\n').filter(Boolean)) options.onOutput(line)
  }
  child.stdout?.on('data', forward)
  child.stderr?.on('data', forward)

  let exited = null
  child.once('exit', (code, signal) => {
    exited = { code, signal }
  })

  const baseUrl = `http://127.0.0.1:${port}`
  const health = await waitForHealth(baseUrl, { timeoutMs: options.timeoutMs, fetchImpl: options.fetchImpl })

  if (!health.ok) {
    child.kill('SIGTERM')
    return { ok: false, port, baseUrl, error: health.error || (exited ? `server exited (${JSON.stringify(exited)})` : 'server did not answer') }
  }

  return { ok: true, port, baseUrl, child }
}
