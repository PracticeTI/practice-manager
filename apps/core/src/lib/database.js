/**
 * Database configuration utilities
 */
import { wrapPgClientWithAutoRls } from '@/lib/supabaseRls'
import { assertDatabaseEnvironment } from '@/lib/databaseEnvironmentGuard'
import { buildPgClientConfig } from '@/lib/pgClientConfig'

function detectDatabaseTypeFromConnectionString(connectionString) {
  if (!connectionString || typeof connectionString !== 'string') {
    return null
  }

  try {
    const protocol = new URL(connectionString).protocol.replace(':', '').toLowerCase()
    if (protocol === 'postgres' || protocol === 'postgresql') return 'postgresql'
    if (protocol === 'mongodb' || protocol === 'mongodb+srv') return 'mongodb'
  } catch {
    return null
  }

  return null
}

/**
 * Detect which database type is configured
 */
export function detectDatabaseType() {
  if (process.env.POSTGRES_URL || process.env.DATABASE_URL) {
    return 'postgresql'
  }
  if (process.env.MONGODB_URI) {
    return 'mongodb'
  }
  return null
}

/**
 * Get database connection string based on type
 */
export function getDatabaseConnectionString() {
  // The lowest-level resolver, so a preview deployment pointed at the production
  // database fails loudly here rather than writing to it.
  assertDatabaseEnvironment()

  const type = detectDatabaseType()

  switch (type) {
    case 'postgresql':
      return process.env.POSTGRES_URL || process.env.DATABASE_URL
    case 'mongodb':
      return process.env.MONGODB_URI
    default:
      return null
  }
}

/**
 * Check if database is configured
 */
export function isDatabaseConfigured() {
  return detectDatabaseType() !== null
}

/**
 * Get database configuration info
 */
export function getDatabaseConfig() {
  const type = detectDatabaseType()

  if (!type) {
    return {
      configured: false,
      type: null,
      connectionString: null
    }
  }

  return {
    configured: true,
    type,
    connectionString: getDatabaseConnectionString()
  }
}

/**
 * Get a database connection based on the configured type.
 *
 * There is one database. This used to read `database_operation_mode` from
 * `system_settings` and fail over to `DATABASE_REPLICA_URL`, but the "replica"
 * was a second, manually synced copy of the same schema: a full copy of
 * `admin_users`, `user_settings` and the encrypted calendar tokens, kept in sync
 * by dropping and recreating tables from application code. Failover is now the
 * database provider's job (managed backup/restore), so there is no second target
 * to switch to.
 */
export async function getDatabaseConnection() {
  const connectionString = getDatabaseConnectionString()
  const type = detectDatabaseTypeFromConnectionString(connectionString) || detectDatabaseType()

  if (!type || !connectionString) {
    throw new Error('Database not configured')
  }

  switch (type) {
    case 'postgresql': {
      const { Client } = await import('pg')
      // buildPgClientConfig decodes the credentials and enables TLS for any remote
      // host — `pg` only negotiates TLS when `ssl` is set, and it has no
      // libpq-style "prefer" mode.
      const client = new Client(buildPgClientConfig(connectionString))
      await client.connect()
      return wrapPgClientWithAutoRls(client, connectionString)
    }
    case 'mongodb': {
      const { MongoClient } = await import('mongodb')
      const client = new MongoClient(connectionString)
      await client.connect()
      return client
    }
    default:
      throw new Error(`Unsupported database type: ${type}`)
  }
}
