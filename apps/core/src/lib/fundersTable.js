import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { runOptionalDdl, whenTablesMissing } from './pgOptionalDdl.js'

/**
 * Ensures the reference tables that back the "Funders" entity.
 *
 * `funders` holds one row per funding body (NDIS, TAC, DVA, WorkCover, HCP, ...)
 * and `funder_documents` holds the published documentation that belongs to it
 * (pricing schedules, the support catalogue, legislation, guidance). Both are
 * **platform-wide reference data**: a funder's documents are the same for every
 * domain, so — unlike patient data — neither table carries a `domain` column.
 *
 * The tables follow the conventions of the other feature tables in this platform
 * (metadata JSON, no foreign keys) deliberately: the database sync tools recreate
 * tables from column definitions only, which drops constraints, and a missing
 * foreign key would silently break inserts. Document rows are therefore cleaned
 * up in code when their funder is deleted.
 */
export async function ensureFundersTables() {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        throw new Error('Funders require a configured PostgreSQL database')
    }

    let connection = null
    try {
        connection = await getDatabaseConnection()

        await whenTablesMissing(connection, ['funders'], async () => {
            await connection.query(`
                CREATE TABLE IF NOT EXISTS funders (
                    id BIGSERIAL PRIMARY KEY,
                    key VARCHAR(64) NOT NULL,
                    name VARCHAR(160) NOT NULL DEFAULT '',
                    full_name VARCHAR(255) NOT NULL DEFAULT '',
                    description TEXT NOT NULL DEFAULT '',
                    jurisdiction VARCHAR(160) NOT NULL DEFAULT '',
                    website_url TEXT NOT NULL DEFAULT '',
                    status VARCHAR(24) NOT NULL DEFAULT 'published',
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    metadata JSONB,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            `)
        })
        await connection.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS funders_key_idx ON funders(key)
        `)
        await connection.query('CREATE INDEX IF NOT EXISTS funders_status_idx ON funders(status)')

        await whenTablesMissing(connection, ['funder_documents'], async () => {
            await whenTablesMissing(connection, ['will'], async () => {
    await connection.query(`
                    CREATE TABLE IF NOT EXISTS funder_documents (
                        id BIGSERIAL PRIMARY KEY,
                        funder_id BIGINT NOT NULL,
                        key VARCHAR(120) NOT NULL DEFAULT '',
                        title VARCHAR(255) NOT NULL DEFAULT '',
                        url TEXT NOT NULL DEFAULT '',
                        category VARCHAR(64) NOT NULL DEFAULT 'reference',
                        doc_type VARCHAR(32) NOT NULL DEFAULT 'link',
                        description TEXT NOT NULL DEFAULT '',
                        effective_period VARCHAR(32) NOT NULL DEFAULT '',
                        is_primary BOOLEAN NOT NULL DEFAULT FALSE,
                        position INTEGER NOT NULL DEFAULT 0,
                        status VARCHAR(24) NOT NULL DEFAULT 'published',
                        link_status VARCHAR(24) NOT NULL DEFAULT '',
                        http_status INTEGER,
                        link_checked_at TIMESTAMPTZ,
                        metadata JSONB,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                `)
            })

            // Added after the table shipped: CREATE TABLE IF NOT EXISTS will not add
            // columns to a table that already exists, so backfill them separately.
            // These are written only by the funder link check, never by the admin UI.
            await runOptionalDdl(connection, "ALTER TABLE funder_documents ADD COLUMN IF NOT EXISTS link_status VARCHAR(24) NOT NULL DEFAULT ''")
            await runOptionalDdl(connection, 'ALTER TABLE funder_documents ADD COLUMN IF NOT EXISTS http_status INTEGER')
            await runOptionalDdl(connection, 'ALTER TABLE funder_documents ADD COLUMN IF NOT EXISTS link_checked_at TIMESTAMPTZ')
            await connection.query('CREATE INDEX IF NOT EXISTS funder_documents_funder_idx ON funder_documents(funder_id)')
            await connection.query('CREATE INDEX IF NOT EXISTS funder_documents_category_idx ON funder_documents(category)')
            // A document key is unique within its funder. Blank keys are excluded so a
            // hand-added document without a key never collides with another.
            await connection.query(`
                CREATE UNIQUE INDEX IF NOT EXISTS funder_documents_funder_key_idx
                    ON funder_documents(funder_id, key)
                    WHERE key <> ''
            `)
    })
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
        else if (connection?.close) await connection.close().catch(() => { })
    }
}
