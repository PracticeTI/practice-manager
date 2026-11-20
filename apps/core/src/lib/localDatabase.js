import { exec } from 'child_process'
import { promisify } from 'util'
import net from 'net'
import fs from 'fs'
import os from 'os'
import path from 'path'

const execAsync = promisify(exec)

/**
 * Parse database URL to determine type and connection details
 */
export function parseDatabaseUrl(url) {
  if (!url) return null

  try {
    const urlObj = new URL(url)
    const protocol = urlObj.protocol.replace(':', '')

    let type = null
    if (protocol === 'postgresql' || protocol === 'postgres') {
      type = 'postgresql'
    }

    return {
      type,
      host: urlObj.hostname,
      port: urlObj.port || '5432',
      database: urlObj.pathname.substring(1),
      isLocal: urlObj.hostname === 'localhost' || urlObj.hostname === '127.0.0.1'
    }
  } catch (error) {
    console.error('Error parsing database URL:', error)
    return null
  }
}

/**
 * Check if PostgreSQL is installed on the system
 */
export async function isPostgreSQLInstalled() {
  try {
    const command = process.platform === 'win32' ? 'where psql' : 'which psql'
    await execAsync(command)
    return true
  } catch {
    return false
  }
}

/**
 * Check if PostgreSQL is running locally
 */
export async function isPostgreSQLRunning() {
  try {
    // Try multiple methods to check if PostgreSQL is running

    // Method 1: Check with pg_isready (if available)
    try {
      const { stdout } = await execAsync('pg_isready -h localhost')
      return stdout.includes('accepting connections')
    } catch {
      // pg_isready not available or failed, try next method
    }

    // Method 2: Check if process is running
    try {
      await execAsync('pgrep -x postgres')
      return true
    } catch {
      // Process not found
    }

    // Method 3: Try to list running services (macOS with Homebrew)
    try {
      const { stdout } = await execAsync('brew services list 2>/dev/null | grep postgresql')
      return stdout.includes('started')
    } catch {
      // Homebrew services not available
    }

    return false
  } catch (error) {
    console.error('Error checking PostgreSQL status:', error)
    return false
  }
}

/**
 * Lightweight TCP probe to see if a host:port is accepting connections
 */
async function isPortOpen(host, port, timeout = 1500) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false

    const finalize = (result) => {
      if (!settled) {
        settled = true
        socket.destroy()
        resolve(result)
      }
    }

    socket.setTimeout(timeout)
    socket.on('connect', () => finalize(true))
    socket.on('timeout', () => finalize(false))
    socket.on('error', () => finalize(false))

    try {
      socket.connect(port, host)
    } catch (err) {
      finalize(false)
    }
  })
}

/**
 * Detect a locally running PostgreSQL by probing common ports
 */
export async function detectLocalPostgres(ports = [5432, 5433]) {
  for (const port of ports) {
    const open = await isPortOpen('127.0.0.1', port) || await isPortOpen('localhost', port)
    if (open) {
      return {
        running: true,
        host: 'localhost',
        port: String(port)
      }
    }
  }

  return {
    running: false,
    message: 'No local PostgreSQL detected on common ports (5432, 5433)'
  }
}

/**
 * Read pgpass entries from typical locations (Windows/AppData and Unix ~/.pgpass)
 */
export function readPgPassEntries() {
  const entries = []
  const candidates = []
  if (process.platform === 'win32' && process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'postgresql', 'pgpass.conf'))
  }
  candidates.push(path.join(os.homedir(), '.pgpass'))

  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) continue
      const content = fs.readFileSync(filePath, 'utf8')
      const lines = content.split(/\r?\n/).filter(l => l && !l.startsWith('#'))
      for (const line of lines) {
        const parts = line.split(':')
        if (parts.length >= 5) {
          const [host, port, database, user, password] = parts
          entries.push({ host, port, database, user, password })
        }
      }
    } catch {
      // ignore file read errors
    }
  }
  return entries
}

/**
 * Find a pgpass entry matching host/port and database (or wildcard)
 */
export function findPgPassEntry(host, port, database = 'postgres') {
  const entries = readPgPassEntries()
  const stringPort = String(port)
  // Prefer exact matches, then wildcard matches
  const isHostMatch = (entryHost) => {
    return entryHost === host || entryHost === '*' || (host === 'localhost' && entryHost === '127.0.0.1')
  }

  const candidates = entries.filter(e => isHostMatch(e.host) && (e.port === stringPort || e.port === '*') && (e.database === database || e.database === '*'))
  return candidates[0] || null
}

/**
 * Try a non-interactive psql connection; returns true on success
 */
export async function tryPsqlConnect({ host, port, user, database, password }) {
  const env = { ...process.env }
  if (password) env.PGPASSWORD = password
  const cmd = `psql --no-password -h ${host} -p ${port} -U ${user} -d ${database} -c "select 1"`
  try {
    await execAsync(cmd, { env })
    return true
  } catch (err) {
    return false
  }
}

/**
 * Start PostgreSQL locally
 */
export async function startPostgreSQL() {
  try {
    // Try Homebrew services first (most common on macOS)
    try {
      const { stdout } = await execAsync('brew services start postgresql@14 || brew services start postgresql')
      return {
        success: true,
        method: 'homebrew',
        message: 'PostgreSQL started via Homebrew services',
        output: stdout
      }
    } catch (brewError) {
      // Homebrew not available, try other methods
    }

    // Try pg_ctl (standard PostgreSQL tool)
    try {
      const { stdout } = await execAsync('pg_ctl start -D /usr/local/var/postgres')
      return {
        success: true,
        method: 'pg_ctl',
        message: 'PostgreSQL started via pg_ctl',
        output: stdout
      }
    } catch (pgctlError) {
      // pg_ctl failed
    }

    return {
      success: false,
      message: 'Could not start PostgreSQL. Please start it manually.',
      suggestions: [
        'brew services start postgresql',
        'pg_ctl start -D /usr/local/var/postgres',
        'Check if PostgreSQL is installed: brew install postgresql'
      ]
    }
  } catch (error) {
    return {
      success: false,
      message: 'Error starting PostgreSQL',
      error: error.message
    }
  }
}

/**
 * Check and start local database if needed
 */
export async function checkAndStartLocalDatabase(databaseUrl) {
  const dbInfo = parseDatabaseUrl(databaseUrl)

  if (!dbInfo || !dbInfo.isLocal) {
    return {
      isLocal: false,
      message: 'Not a local database connection'
    }
  }

  const result = {
    isLocal: true,
    type: dbInfo.type,
    host: dbInfo.host,
    port: dbInfo.port
  }

  // Check if database software is installed
  if (dbInfo.type === 'postgresql') {
    const installed = await isPostgreSQLInstalled()
    if (!installed) {
      return {
        ...result,
        installed: false,
        running: false,
        message: 'PostgreSQL is not installed on this system',
        suggestions: ['Install PostgreSQL: brew install postgresql']
      }
    }

    // Check if it's running
    const running = await isPostgreSQLRunning()
    result.installed = true
    result.running = running

    if (!running) {
      // Try to start it
      const startResult = await startPostgreSQL()
      result.startAttempt = startResult

      // Wait a moment and check again
      await new Promise(resolve => setTimeout(resolve, 2000))
      result.running = await isPostgreSQLRunning()
    }
  }

  return result
}
