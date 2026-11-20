/**
 * First-run prerequisite checks.
 *
 * A desktop install has no container runtime to hide behind: the operator supplies Node and
 * PostgreSQL, and the app's job is to say precisely what is missing and what to do about it.
 * Every check returns `{ ok, detail, fix }` so the shell can render it as a checklist and
 * the CLI can print the same thing.
 */

import { spawn } from 'node:child_process'

import { satisfiesRange } from './version.js'

export const REQUIRED_NODE_RANGE = '>=22.13.0 <23 || >=24'

const CONNECT_TIMEOUT_MS = 5000

/** Mask the password in a connection string before showing it to anyone. */
export function redactConnectionString(connectionString) {
  try {
    const url = new URL(String(connectionString))
    if (url.password) url.password = '***'
    return url.toString()
  } catch {
    return '[invalid connection string]'
  }
}

function readConnectionString(env) {
  return String(env.DATABASE_URL || env.POSTGRES_URL || '').trim()
}

/** Validate shape without connecting: URL parse, protocol, and a usable database name. */
export function describeConnectionString(connectionString) {
  if (!connectionString) {
    return { ok: false, detail: 'DATABASE_URL is not set', fix: 'Set DATABASE_URL to your local PostgreSQL connection string.' }
  }

  let url
  try {
    url = new URL(connectionString)
  } catch {
    return { ok: false, detail: 'DATABASE_URL is not a valid URL', fix: 'Use the form postgresql://user:password@host:5432/database' }
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    return { ok: false, detail: `DATABASE_URL uses ${url.protocol}`, fix: 'PostgreSQL is the only supported database.' }
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ''))
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(database)) {
    return { ok: false, detail: `DATABASE_URL names an invalid database (${database || 'empty'})`, fix: 'Use letters, numbers and underscores for the database name.' }
  }

  return { ok: true, detail: redactConnectionString(connectionString), database, url }
}

/**
 * Client options for a connection string.
 *
 * A local server speaks plaintext; `sslmode=disable` says the same for a remote one.
 * Anything else gets TLS without chain verification, matching the rest of the project
 * (the hosted pooler presents a chain node-postgres will not verify).
 */
export function buildClientOptions(connectionString) {
  const url = new URL(connectionString)
  const isLocal = ['localhost', '127.0.0.1', '::1', ''].includes(url.hostname)
  const sslDisabled = url.searchParams.get('sslmode') === 'disable'

  return {
    connectionString,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    ssl: isLocal || sslDisabled ? false : { rejectUnauthorized: false },
  }
}

async function connectForCheck(connectionString) {
  const { default: pg } = await import('pg')
  const client = new pg.Client(buildClientOptions(connectionString))
  await client.connect()
  return client
}

/**
 * Run every check.
 *
 * @param {{ env?: Record<string, string|undefined>, nodeVersion?: string, connect?: (cs: string) => Promise<{ query: Function, end: Function }> }} [options]
 * @returns {Promise<{ ok: boolean, checks: Array<{ name: string, ok: boolean, detail: string, fix?: string, required?: boolean }> }>}
 */
export async function runPreflight(options = {}) {
  const env = options.env || process.env
  const nodeVersion = options.nodeVersion || process.versions.node
  const connect = options.connect || connectForCheck

  const checks = []

  checks.push({
    name: 'Node.js',
    ok: satisfiesRange(nodeVersion, REQUIRED_NODE_RANGE),
    required: true,
    detail: `v${nodeVersion} (requires ${REQUIRED_NODE_RANGE})`,
    fix: 'Install a supported Node.js release, then reopen the app.',
  })

  const connection = describeConnectionString(readConnectionString(env))
  checks.push({
    name: 'DATABASE_URL',
    ok: connection.ok,
    required: true,
    detail: connection.detail,
    fix: connection.fix,
  })

  if (!connection.ok) {
    // Everything below needs a connection; report them as blocked rather than skipped.
    for (const name of ['PostgreSQL', 'Schema']) {
      checks.push({
        name,
        ok: false,
        required: true,
        detail: 'not checked — no usable DATABASE_URL',
        fix: 'Set DATABASE_URL first.',
      })
    }
    return { ok: false, checks }
  }

  let client = null
  try {
    client = await connect(readConnectionString(env))
    await client.query('SELECT 1')
    checks.push({
      name: 'PostgreSQL',
      ok: true,
      required: true,
      detail: `reachable at ${connection.url.host}`,
    })
  } catch (error) {
    const missingDatabase = error?.code === '3D000'
    checks.push({
      name: 'PostgreSQL',
      ok: false,
      required: true,
      detail: missingDatabase
        ? `database "${connection.database}" does not exist yet`
        : `not reachable at ${connection.url.host}: ${error?.message || 'connection failed'}`,
      fix: missingDatabase
        ? 'Run `npm run setup --workspace @practice-manager/desktop` to create it.'
        : 'Start PostgreSQL, or correct DATABASE_URL.',
    })
  }

  if (!client) {
    checks.push({
      name: 'Schema',
      ok: false,
      required: true,
      detail: 'not checked — database unreachable',
      fix: 'Resolve the PostgreSQL connection first.',
    })
    return { ok: false, checks }
  }

  if (client) {
    try {
      const result = await client.query('SELECT to_regclass($1) AS table_name', ['public.patients'])
      const present = Boolean(result.rows?.[0]?.table_name)
      checks.push({
        name: 'Schema',
        ok: present,
        required: true,
        detail: present ? 'patients table present' : 'database is empty — setup has not run',
        fix: present ? undefined : 'Run `npm run setup --workspace @practice-manager/desktop`.',
      })
    } catch (error) {
      checks.push({
        name: 'Schema',
        ok: false,
        required: true,
        detail: `could not read the schema: ${error?.message || 'query failed'}`,
        fix: 'Check that the database user can read the public schema.',
      })
    } finally {
      await client.end?.().catch?.(() => {})
    }
  }

  return { ok: checks.every((check) => !check.required || check.ok), checks }
}

/**
 * Version of the Node.js the operator installed, not the one Electron embeds.
 *
 * The desktop app runs the server with the system runtime (that is a stated prerequisite),
 * so the engine check has to measure that runtime. A missing `node` is a first-class
 * result, not an exception.
 *
 * @param {{ command?: string, timeoutMs?: number }} [options]
 * @returns {Promise<{ ok: boolean, version?: string, error?: string }>}
 */
export function probeSystemNode(options = {}) {
  const timeoutMs = options.timeoutMs || 5000
  const candidates = options.candidates || [
    options.command || 'node',
    // GUI launches get a minimal PATH; these are where package managers put `node`.
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node',
  ]

  return probeCandidates(candidates)
}

function probeCandidates(candidates, index = 0) {
  const command = candidates[index]
  if (!command) return Promise.resolve({ ok: false, error: 'node was not found on PATH or in the usual install locations' })

  return probeCommand(command).then((result) => {
    if (result.ok) return result
    if (result.error && !/not found|ENOENT/i.test(result.error)) return result
    return probeCandidates(candidates, index + 1)
  })
}

function probeCommand(command) {
  const timeoutMs = 5000

  return new Promise((resolve) => {
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    let child
    try {
      child = spawn(command, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      finish({ ok: false, error: error?.message || 'could not run node' })
      return
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish({ ok: false, error: `node --version timed out after ${timeoutMs}ms` })
    }, timeoutMs)

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => { stdout += chunk })
    child.stderr?.on('data', (chunk) => { stderr += chunk })

    child.once('error', (error) => {
      clearTimeout(timer)
      finish({ ok: false, error: error?.code === 'ENOENT' ? `node was not found (${command})` : (error?.message || 'could not run node') })
    })

    child.once('close', (code) => {
      clearTimeout(timer)
      const version = String(stdout).trim().replace(/^v/, '')
      if (code !== 0 || !version) {
        finish({ ok: false, error: String(stderr).trim() || `node --version exited with ${code}` })
        return
      }
      finish({ ok: true, version, path: command })
    })
  })
}
