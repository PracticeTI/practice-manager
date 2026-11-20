import { isDdlPermissionError } from './pgOptionalDdl.js'

function normalizeQualifiedIdentifier(identifier) {
  if (!identifier) return null
  return identifier.replace(/\s*\.\s*/g, '.').trim()
}

function extractCreateTableTarget(createTableSql) {
  if (typeof createTableSql !== 'string') return null
  const match = createTableSql.match(
    /^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:"[^"]+"|[a-zA-Z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[a-zA-Z_][\w$]*))?)/i
  )
  return normalizeQualifiedIdentifier(match?.[1] || null)
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`
}

/**
 * Enabling RLS is a schema change, so only the table owner may do it. The runtime
 * usually is not the owner — hosted deployments connect as a constrained role, and
 * locally every domain-scoped connection switches to `POSTGRES_RLS_RUNTIME_ROLE`.
 * PostgreSQL refuses with SQLSTATE 42501 even when RLS is already enabled, which
 * made every lazy `CREATE TABLE IF NOT EXISTS` fail inside a report-queue write.
 *
 * Skipping is the documented path: `npm run db:prepare` installs RLS and its
 * policies with the owner credential (docs/postgres-rls-rollout.md).
 */
async function runRlsDdl(execute, sql) {
  try {
    await execute(sql)
    return true
  } catch (error) {
    if (isDdlPermissionError(error)) return false
    throw error
  }
}

export function isSupabaseConnectionString(connectionString) {
  if (!connectionString) return false
  try {
    const { hostname } = new URL(connectionString)
    return hostname.includes('supabase.co')
  } catch {
    return false
  }
}

export function isLocalPostgresConnectionString(connectionString) {
  if (!connectionString) return false
  try {
    const { hostname } = new URL(connectionString)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  } catch {
    return false
  }
}

export function shouldAutoEnableRls(connectionString) {
  if (!connectionString || typeof connectionString !== 'string') return false

  const normalized = connectionString.trim()
  if (!normalized) return false

  return normalized.toLowerCase().startsWith('postgres://')
    || normalized.toLowerCase().startsWith('postgresql://')
}

export async function enableRlsForTable(client, tableName, schema = 'public', connectionString = '') {
  if (!shouldAutoEnableRls(connectionString)) return false
  if (!tableName) return false
  const qualifiedTable = `${quoteIdentifier(schema)}.${quoteIdentifier(tableName)}`
  if (!(await runRlsDdl((sql) => client.query(sql), `ALTER TABLE ${qualifiedTable} ENABLE ROW LEVEL SECURITY`))) return false
  return true
}

export async function enableRlsForCreateStatement(client, createTableSql, connectionString = '') {
  if (!shouldAutoEnableRls(connectionString)) return false
  const target = extractCreateTableTarget(createTableSql)
  if (!target) return false
  if (!(await runRlsDdl((sql) => client.query(sql), `ALTER TABLE ${target} ENABLE ROW LEVEL SECURITY`))) return false
  return true
}

export async function runCreateTableWithRls(client, createTableSql, connectionString = '', fallback = null) {
  await client.query(createTableSql)
  if (!shouldAutoEnableRls(connectionString)) return

  if (fallback?.tableName) {
    await enableRlsForTable(client, fallback.tableName, fallback.schema || 'public', connectionString)
    return
  }

  await enableRlsForCreateStatement(client, createTableSql, connectionString)
}

export function wrapPgClientWithSupabaseRls(client, connectionString = '') {
  if (!shouldAutoEnableRls(connectionString)) return client
  if (!client?.query || client.__supabaseRlsWrapped) return client

  const originalQuery = client.query.bind(client)
  client.query = async (queryInput, ...params) => {
    const sql = typeof queryInput === 'string' ? queryInput : queryInput?.text
    const result = await originalQuery(queryInput, ...params)
    const createTarget = extractCreateTableTarget(sql)
    if (createTarget) {
      await runRlsDdl((statement) => originalQuery(statement), `ALTER TABLE ${createTarget} ENABLE ROW LEVEL SECURITY`)
    }
    return result
  }
  client.__supabaseRlsWrapped = true
  return client
}

export function wrapPgClientWithAutoRls(client, connectionString = '') {
  return wrapPgClientWithSupabaseRls(client, connectionString)
}
