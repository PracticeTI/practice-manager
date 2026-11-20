/**
 * The lazy schema upgrades the runtime runs before its first queue write.
 *
 * Each one adds a column or an index to a table the `two` worker owns, so the
 * runtime can only apply it while it is the table owner. It usually is not: hosted
 * deployments connect as a constrained login role, and locally every domain-scoped
 * connection switches to `POSTGRES_RLS_RUNTIME_ROLE` before its first statement.
 * PostgreSQL answers SQLSTATE 42501 (`must be owner of table …`) in that case — for
 * *any* `ALTER TABLE`, even one whose change is already in effect, which is why a
 * `DROP NOT NULL` on an already-nullable column still fails.
 *
 * Skipping is correct rather than merely convenient: schema belongs to
 * `npm run db:prepare`, run by an operator holding the owner credential (see
 * docs/postgres-rls-rollout.md). The write that follows is the real test — it fails
 * with a clear message if the column genuinely is missing.
 */

/**
 * The tables among `tables` that do not exist yet.
 *
 * `CREATE TABLE IF NOT EXISTS` still asks for CREATE on the schema, so a runtime
 * role that is deliberately not the owner is refused even when there is nothing
 * to create. Probing first makes a provisioned database issue no DDL at all.
 *
 * @param {{ query: Function }} connection
 * @param {string[]} tables
 * @returns {Promise<string[]>}
 */
export async function missingTables(connection, tables) {
    if (!Array.isArray(tables) || tables.length === 0) return []

    const result = await connection.query(
        `SELECT name FROM unnest($1::text[]) AS name
         WHERE to_regclass('public.' || quote_ident(name)) IS NULL`,
        [tables]
    )
    return (result?.rows || []).map((row) => row.name)
}

/**
 * Run table-creation DDL only when one of `tables` is missing.
 *
 * `CREATE TABLE IF NOT EXISTS` still requires CREATE on the schema, so a
 * constrained runtime role is refused even when the table is already there. These
 * initialisers run on every request to their feature, so on a provisioned
 * database the probe is the only statement that should execute.
 *
 * @param {{ query: Function }} connection
 * @param {string[]} tables
 * @param {() => Promise<void>} create
 * @returns {Promise<string[]>} the tables that were missing, empty when skipped
 */
export async function whenTablesMissing(connection, tables, create) {
    const missing = await missingTables(connection, tables)
    if (missing.length === 0) return missing
    await create()
    return missing
}

const warnedStatements = new Set()

/**
 * True when PostgreSQL refused a statement because the session does not own the
 * object it targets, rather than because the statement was wrong.
 *
 * @param {any} error
 * @returns {boolean}
 */
export function isDdlPermissionError(error) {
    if (!error) return false
    if (error.code === '42501') return true

    const message = String(error.message || '')
    return /must be owner of (table|relation|sequence)|permission denied for (table|relation|sequence|schema)/i.test(message)
}

/**
 * Run a schema upgrade that is expected to already be in place, and ignore the
 * owner check that a constrained runtime role cannot pass.
 *
 * A skipped upgrade is logged once per statement so a genuinely missing column is
 * not completely silent, but the request itself carries on.
 *
 * @param {{ query: Function }} connection
 * @param {string} sql
 * @returns {Promise<boolean>} Whether the statement ran.
 */
export async function runOptionalDdl(connection, sql) {
    try {
        await connection.query(sql)
        return true
    } catch (error) {
        if (!isDdlPermissionError(error)) throw error

        if (!warnedStatements.has(sql)) {
            warnedStatements.add(sql)
            console.warn(`[optional-ddl] skipped, run as the table owner (npm run db:prepare): ${sql.trim()}`)
        }

        return false
    }
}
