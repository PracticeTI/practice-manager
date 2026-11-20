/**
 * Postgres unique-key helpers for the database sync tools.
 *
 * The sync tools (full sync, table sync, diff sync) recreate tables on the target
 * by copying column definitions only. That silently drops PRIMARY KEY / UNIQUE
 * constraints, which breaks two things on the target database:
 *
 *   1. Foreign keys pointing at the table fail with
 *      `there is no unique constraint matching given keys for referenced table "<table>"`.
 *   2. `INSERT ... ON CONFLICT (<cols>)` upserts fail with
 *      `there is no unique or exclusion constraint matching the ON CONFLICT specification`.
 *
 * These helpers read the source table's unique keys and (re)create the matching
 * ones on the target table.
 */

function quoteIdentifier(name) {
    return `"${String(name).replace(/"/g, '""')}"`
}

function keyFingerprint(columns) {
    return [...columns]
        .map((column) => String(column).toLowerCase())
        .sort()
        .join(',')
}

/**
 * node-postgres only decodes array OIDs it knows about, and `pg_attribute.attname`
 * is `name[]` (OID 1003), which it returns as a raw string. Accept both shapes.
 */
function normalizeColumnArray(value) {
    if (Array.isArray(value)) return value.filter(Boolean)
    if (typeof value !== 'string') return []
    const trimmed = value.trim()
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return []
    const inner = trimmed.slice(1, -1)
    if (!inner) return []
    return inner.split(',').map((entry) => entry.trim().replace(/^"(.*)"$/s, '$1')).filter(Boolean)
}

function sanitizeIdentifierPart(value) {
    return String(value)
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
}

function buildConstraintName(tableName, columns) {
    const parts = [tableName, ...columns].map(sanitizeIdentifierPart).filter(Boolean)
    const name = `${parts.join('_')}_key`
    return name.length <= 63 ? name : `${name.slice(0, 57)}_ukey`
}

// Unique, non-partial, non-expression indexes (PRIMARY KEY and UNIQUE alike).
// `indnkeyatts = indnatts` excludes indexes with INCLUDE columns, which cannot
// satisfy a foreign key reference on a plain column set.
// The ARRAY(...) is cast to text[] so node-postgres decodes it into a JS array
// instead of the raw '{id}' literal it would return for name[].
const UNIQUE_KEY_QUERY = `
  SELECT
    i.indexrelid::regclass::text AS index_name,
    i.indisprimary AS is_primary,
    ARRAY(
      SELECT a.attname::text
      FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
      WHERE k.ord <= i.indnkeyatts
      ORDER BY k.ord
    )::text[] AS columns
  FROM pg_index i
  JOIN pg_class t ON t.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = $1
    AND t.relname = $2
    AND i.indisunique
    AND i.indisvalid
    AND i.indpred IS NULL
    AND i.indexprs IS NULL
    AND i.indnkeyatts = i.indnatts
`

/**
 * @returns {Promise<Array<{ name: string, columns: string[], isPrimary: boolean }>>}
 */
export async function getUniqueKeys(client, schema, tableName) {
    const result = await client.query(UNIQUE_KEY_QUERY, [schema, tableName])
    return result.rows
        .map((row) => ({
            name: row.index_name,
            columns: normalizeColumnArray(row.columns),
            isPrimary: Boolean(row.is_primary)
        }))
        .filter((key) => key.columns.length > 0)
}

/**
 * Create a unique key on `columns`, preferring a real PRIMARY KEY when asked.
 * Falls back from PRIMARY KEY -> UNIQUE constraint -> unique index so that a
 * usable unique key exists even when the table has NULLs or duplicate rows
 * disqualify it from being a primary key.
 */
async function addUniqueKey(client, { schema, tableName, columns, preferPrimary = false }) {
    const qualifiedTable = `${quoteIdentifier(schema)}.${quoteIdentifier(tableName)}`
    const columnList = columns.map(quoteIdentifier).join(', ')
    const constraintName = buildConstraintName(tableName, columns)

    const attempts = []
    if (preferPrimary) {
        attempts.push({
            label: 'primary key',
            sql: `ALTER TABLE ${qualifiedTable} ADD CONSTRAINT ${quoteIdentifier(constraintName)} PRIMARY KEY (${columnList})`
        })
    }
    attempts.push({
        label: 'unique constraint',
        sql: `ALTER TABLE ${qualifiedTable} ADD CONSTRAINT ${quoteIdentifier(constraintName)} UNIQUE (${columnList})`
    })
    attempts.push({
        label: 'unique index',
        sql: `CREATE UNIQUE INDEX ${quoteIdentifier(constraintName)} ON ${qualifiedTable} (${columnList})`
    })

    const errors = []
    for (const attempt of attempts) {
        try {
            await client.query(attempt.sql)
            return { created: true, via: attempt.label, name: constraintName, errors }
        } catch (error) {
            errors.push(`${attempt.label}: ${error?.message || error}`)
        }
    }

    // A concurrent caller (or a partially applied earlier run) may have added an equivalent
    // key while these statements were failing, so confirm before reporting a failure.
    try {
        const currentKeys = await getUniqueKeys(client, schema, tableName)
        const fingerprint = keyFingerprint(columns)
        if (currentKeys.some((key) => keyFingerprint(key.columns) === fingerprint)) {
            return { created: false, alreadyPresent: true, via: 'existing', name: constraintName, errors }
        }
    } catch {
        // Fall through to the failure result below.
    }

    return { created: false, name: constraintName, errors }
}

/**
 * Resolve which schema holds unqualified tables for this connection (the first
 * schema on the search_path), so callers do not have to hard-code 'public'.
 */
async function resolveSchema(client, schema) {
    if (schema) return schema
    try {
        const result = await client.query('SELECT current_schema() AS schema')
        return result.rows?.[0]?.schema || 'public'
    } catch {
        return 'public'
    }
}

/**
 * Ensure a single table has a unique key covering exactly `columns`.
 * Used as a self-healing guard on the database the app is pointed at.
 */
export async function ensureUniqueKeyOnColumns(client, { schema, tableName, columns = [], preferPrimary = false } = {}) {
    const keyColumns = columns.filter(Boolean)
    if (!tableName || keyColumns.length === 0) {
        return { ensured: false, existed: false, reason: 'no-columns' }
    }

    const targetSchema = await resolveSchema(client, schema)
    const fingerprint = keyFingerprint(keyColumns)
    const existingKeys = await getUniqueKeys(client, targetSchema, tableName)
    if (existingKeys.some((key) => keyFingerprint(key.columns) === fingerprint)) {
        return { ensured: true, existed: true, columns: keyColumns }
    }

    const result = await addUniqueKey(client, { schema: targetSchema, tableName, columns: keyColumns, preferPrimary })
    return {
        ensured: result.created || result.alreadyPresent === true,
        existed: result.created === true ? false : result.alreadyPresent === true,
        columns: keyColumns,
        via: result.via,
        name: result.name,
        errors: result.errors,
        reason: result.created ? 'created' : result.alreadyPresent ? 'already-unique' : 'create-failed'
    }
}

/**
 * Mirror every unique key (PRIMARY KEY and UNIQUE) from the source table onto the
 * target table. Keys that already exist on the target are left untouched.
 *
 * Never throws: sync failures are reported per table so callers can surface them
 * as warnings without aborting the data sync.
 */
export async function syncUniqueKeys(sourceClient, targetClient, { schema = 'public', tableName } = {}) {
    const summary = { table: tableName, created: [], errors: [] }
    if (!sourceClient || !targetClient || !tableName) return summary

    let sourceKeys = []
    let targetKeys = []
    try {
        sourceKeys = await getUniqueKeys(sourceClient, schema, tableName)
        if (sourceKeys.length === 0) return summary
        targetKeys = await getUniqueKeys(targetClient, schema, tableName)
    } catch (error) {
        summary.errors.push(`Could not inspect unique keys: ${error?.message || error}`)
        return summary
    }

    const existingFingerprints = new Set(targetKeys.map((key) => keyFingerprint(key.columns)))
    const targetHasPrimaryKey = targetKeys.some((key) => key.isPrimary)

    for (const key of sourceKeys) {
        const fingerprint = keyFingerprint(key.columns)
        if (existingFingerprints.has(fingerprint)) continue

        const preferPrimary = key.isPrimary && !targetHasPrimaryKey
        try {
            const result = await addUniqueKey(targetClient, {
                schema,
                tableName,
                columns: key.columns,
                preferPrimary
            })

            if (result.created) {
                summary.created.push({ columns: key.columns, via: result.via, name: result.name })
                existingFingerprints.add(fingerprint)
            } else if (result.alreadyPresent) {
                existingFingerprints.add(fingerprint)
            } else {
                summary.errors.push(`${tableName} (${key.columns.join(', ')}): ${result.errors.join(' | ')}`)
            }
        } catch (error) {
            summary.errors.push(`${tableName} (${key.columns.join(', ')}): ${error?.message || error}`)
        }
    }

    return summary
}
