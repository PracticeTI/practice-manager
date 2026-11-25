import { runOptionalDdl, whenTablesMissing } from './pgOptionalDdl.js'
import {
    IDENTITY_INDEX_STATEMENTS,
    IDENTITY_RLS_STATEMENTS,
    IDENTITY_TABLE_STATEMENTS,
    IDENTITY_TABLES,
} from './identitySchema.js'

/**
 * Create the identity model when a database predates it.
 *
 * The owner pass owns this schema: `npm run db:prepare` and `db:init` both apply
 * `identitySchema.js`. This fallback is for an older database, and it follows the
 * `settingsTables.js` pattern so a provisioned database issues no DDL at all:
 *
 *   - a positive probe is what a deployed runtime normally sees, and then not even
 *     an index statement runs
 *   - an index the runtime role cannot create is skipped with a warning; the
 *     tables themselves are already there
 *
 * Nothing reads the model yet, so this is deliberately not on any request or login
 * path: a missing identity model must never be able to block an existing admin.
 *
 * @param {{ query: Function }} connection
 * @returns {Promise<string[]>} the tables that were missing, empty when none were
 */
export async function ensureIdentityTables(connection) {
    if (!connection || typeof connection.query !== 'function') {
        throw new Error('ensureIdentityTables requires a database connection')
    }

    const missing = await whenTablesMissing(connection, IDENTITY_TABLES, async () => {
        for (const statement of IDENTITY_TABLE_STATEMENTS) {
            await connection.query(statement)
        }
    })

    if (missing.length === 0) return missing

    for (const statement of [...IDENTITY_INDEX_STATEMENTS, ...IDENTITY_RLS_STATEMENTS]) {
        await runOptionalDdl(connection, statement)
    }

    return missing
}
