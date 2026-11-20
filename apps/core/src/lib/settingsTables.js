/**
 * Runtime check for the split settings tables.
 *
 * `system_settings`, `domain_settings` and `user_settings` are created by
 * `npm run db:prepare` against a database, not by a deployment: a Vercel build
 * never connects to Postgres, so nothing in the deploy path can change the schema.
 *
 * This module also owns the DDL so the migration script and the runtime share it.
 *
 * The helpers still create the tables when they are missing, because a freshly
 * restored or newly provisioned database would otherwise make every settings read
 * throw. That is a fallback, not the migration path, and it is deliberately cheap:
 *
 *   - a positive `to_regclass` probe is cached for the life of the process, so a
 *     warm process issues no DDL at all
 *   - a missing table is retried on the next call rather than cached, so running
 *     `db:prepare` fixes a running deployment without a restart
 *   - failing to create (a constrained runtime role has no CREATE on `schema
 *     public`) warns once and reports `false`; callers then use defaults instead
 *     of throwing
 *
 * Note that the wrapped client in `lib/supabaseRls.js` enables RLS on every table
 * it sees created. A table created here therefore has RLS on and no policy until
 * `npm run rls:policies` runs — another reason this is not the migration path.
 *
 * No `@/` imports: the probe is unit tested under plain `node --test`.
 */

export const SYSTEM_SETTINGS_TABLE_STATEMENT = `CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(255) PRIMARY KEY,
    value TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`

export const SETTINGS_TABLES = ['system_settings', 'domain_settings', 'user_settings']

export const SETTINGS_TABLE_STATEMENTS = [
    // system_settings must stay first: lib/systemState.js creates only that table.
    SYSTEM_SETTINGS_TABLE_STATEMENT,
    `CREATE TABLE IF NOT EXISTS domain_settings (
        domain VARCHAR(100) NOT NULL,
        key VARCHAR(255) NOT NULL,
        value TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (domain, key)
    )`,
    'CREATE INDEX IF NOT EXISTS domain_settings_key_idx ON domain_settings (key)',
    // Per-user values: one admin's dashboard layout today, other per-admin
    // preferences later. `domain` keeps a preference scoped to the tenant it was
    // set in, and the primary key already serves both list queries.
    `CREATE TABLE IF NOT EXISTS user_settings (
        domain VARCHAR(100) NOT NULL,
        username VARCHAR(100) NOT NULL,
        key VARCHAR(255) NOT NULL,
        value TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (domain, username, key)
    )`,
]

const EXISTS_SQL = `
  SELECT to_regclass('public.system_settings') IS NOT NULL AS system_settings,
         to_regclass('public.domain_settings') IS NOT NULL AS domain_settings,
         to_regclass('public.user_settings') IS NOT NULL AS user_settings
`

/**
 * Create a probe. Production code uses the shared `settingsTablesProbe`; tests
 * create their own so state cannot leak between cases.
 */
export function createSettingsTablesProbe({ statements = SETTINGS_TABLE_STATEMENTS, logger = console } = {}) {
    const state = { present: false, warned: false }
    // Concurrent first requests in one process would otherwise all run the DDL.
    // PostgreSQL raises a duplicate-object error when two sessions create the same
    // table at once (`pg_type_typname_nsp_index`), which read as "settings are
    // unavailable" and silently disabled the whole dashboard.
    let inFlight = null

    async function tablesExist(connection) {
        const result = await connection.query(EXISTS_SQL)
        const row = result?.rows?.[0] || {}
        return SETTINGS_TABLES.every((table) => row[table] === true)
    }

    async function ensureTables(connection) {
        try {
            if (await tablesExist(connection)) {
                state.present = true
                return true
            }
        } catch {
            // Treat an unreadable catalog as "missing" and try the DDL; if that also
            // fails the caller falls back rather than surfacing a schema error.
        }

        try {
            for (const statement of statements) {
                await connection.query(statement)
            }
            state.present = true
            return true
        } catch (error) {
            // Another process may have created the tables between the probe and the
            // DDL, so a duplicate-object error is a race, not a failure.
            try {
                if (await tablesExist(connection)) {
                    state.present = true
                    return true
                }
            } catch {
                // Fall through to the warning.
            }

            if (!state.warned) {
                state.warned = true
                logger.warn(
                    `[settings] system_settings/domain_settings/user_settings are unavailable (${error?.message || error}). ` +
                    'Run `npm run db:prepare` against this database.'
                )
            }
            return false
        }
    }

    async function ensure(connection) {
        if (!connection?.query) throw new Error('A PostgreSQL connection is required')
        if (state.present) return true

        if (!inFlight) {
            inFlight = ensureTables(connection).finally(() => {
                inFlight = null
            })
        }
        return inFlight
    }

    return {
        ensure,
        /** True once a probe has confirmed every settings table exists in this process. */
        isPresent: () => state.present,
        reset: () => {
            state.present = false
            state.warned = false
        },
    }
}

export const settingsTablesProbe = createSettingsTablesProbe()
