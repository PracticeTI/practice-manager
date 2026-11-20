/**
 * First-run setup: make a database usable.
 *
 * Two steps, in the order the operator experiences them: create the database if it is
 * missing, then hand the schema to the core app's bootstrap (`npm run db:init`). The
 * desktop shell calls the same functions the CLI does, so there is one path to test.
 */

import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { buildClientOptions, describeConnectionString } from './preflight.js'

const execFileAsync = promisify(execFile)
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** Point a connection string at another database on the same server. */
export function withDatabaseName(connectionString, databaseName) {
  const url = new URL(connectionString)
  url.pathname = `/${databaseName}`
  return url.toString()
}

function quoteIdentifer(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`"${name}" is not a safe PostgreSQL identifier`)
  }
  return `"${name}"`
}

async function connect(connectionString) {
  const { default: pg } = await import('pg')
  const client = new pg.Client(buildClientOptions(connectionString))
  await client.connect()
  return client
}

async function defaultRunBootstrap(connectionString, log) {
  log('applying schema…')
  try {
    const { stdout } = await execFileAsync(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['run', 'db:init', '--workspace', '@practice-manager/core'],
      { cwd: REPO_ROOT, env: { ...process.env, DATABASE_URL: connectionString }, maxBuffer: 10 * 1024 * 1024 }
    )
    for (const line of String(stdout).split('\n').filter(Boolean)) log(line)
  } catch (error) {
    const output = `${error?.stdout || ''}${error?.stderr || ''}`.trim()
    throw new Error(`schema bootstrap failed${output ? `:\n${output}` : `: ${error?.message || error}`}`)
  }
}

/**
 * Create the database when missing and apply the schema.
 *
 * @param {{
 *   connectionString?: string,
 *   log?: (message: string) => void,
 *   runBootstrap?: (connectionString: string, log: (message: string) => void) => Promise<void>,
 *   connect?: (connectionString: string) => Promise<{ query: Function, end: Function }>,
 * }} [options]
 * @returns {Promise<{ database: string, createdDatabase: boolean, bootstrapped: boolean }>}
 */
export async function provisionDatabase(options = {}) {
  const log = typeof options.log === 'function' ? options.log : () => {}
  const runBootstrap = options.runBootstrap || defaultRunBootstrap
  const openConnection = options.connect || connect
  const connectionString = String(options.connectionString || process.env.DATABASE_URL || process.env.POSTGRES_URL || '').trim()

  const described = describeConnectionString(connectionString)
  if (!described.ok) {
    throw new Error(`${described.detail}. ${described.fix || ''}`.trim())
  }

  const { database } = described
  log(`target database: ${database}`)

  let createdDatabase = false
  let admin = null
  try {
    admin = await openConnection(withDatabaseName(connectionString, 'postgres'))
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database])

    if (existing.rowCount === 0) {
      log(`creating database ${database}`)
      await admin.query(`CREATE DATABASE ${quoteIdentifer(database)}`)
      createdDatabase = true
    } else {
      log(`database ${database} already exists`)
    }
  } finally {
    await admin?.end?.().catch?.(() => {})
  }

  await runBootstrap(connectionString, log)
  log('schema applied')

  return { database, createdDatabase, bootstrapped: true }
}
