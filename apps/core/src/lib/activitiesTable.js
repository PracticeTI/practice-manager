import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { runOptionalDdl, whenTablesMissing } from './pgOptionalDdl.js'

// Ensures the domain-scoped `activities` table that records the audit trail of
// key human and agent actions.
//
// A row is one completed action against one domain-scoped record: who did it
// (`actor_type` / `actor_id` / `actor_name`), what they did (`action`) to what
// (`entity_type` / `entity_id` / `entity_label`), and a `deep_link` back into the
// admin UI. `domain` is a first-class column so queries and retention jobs can
// scope by domain without joining. Rows are append-only — no foreign keys, so a
// deleted record's history survives it.
export async function ensureActivitiesTable() {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        throw new Error('Activities require a configured PostgreSQL database')
    }

    let connection = null
    try {
        connection = await getDatabaseConnection()

        await whenTablesMissing(connection, ['activities'], async () => {
            await connection.query(`
                CREATE TABLE IF NOT EXISTS activities (
                    id SERIAL PRIMARY KEY,
                    domain VARCHAR(100) NOT NULL,
                    actor_type VARCHAR(24) NOT NULL DEFAULT 'human',
                    actor_id VARCHAR(160),
                    actor_name VARCHAR(255),
                    actor_role VARCHAR(64),
                    action VARCHAR(32) NOT NULL,
                    entity_type VARCHAR(64) NOT NULL,
                    entity_id VARCHAR(160),
                    entity_label VARCHAR(255),
                    patient_id INTEGER,
                    patient_name VARCHAR(255),
                    deep_link TEXT,
                    summary TEXT,
                    metadata JSONB,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )
            `)
        })
        // Optional upgrades: `CREATE INDEX` still needs table ownership even when the
        // index is already there, and the runtime role is deliberately not the owner.
        await runOptionalDdl(connection, 'CREATE INDEX IF NOT EXISTS activities_domain_idx ON activities(domain)')
        await runOptionalDdl(connection, 'CREATE INDEX IF NOT EXISTS activities_domain_created_idx ON activities(domain, created_at DESC)')
        await runOptionalDdl(connection, 'CREATE INDEX IF NOT EXISTS activities_entity_idx ON activities(entity_type, entity_id)')
        await runOptionalDdl(connection, 'CREATE INDEX IF NOT EXISTS activities_domain_entity_idx ON activities(domain, entity_type, entity_id)')
        await runOptionalDdl(connection, 'CREATE INDEX IF NOT EXISTS activities_domain_patient_idx ON activities(domain, patient_id)')
        await runOptionalDdl(connection, 'CREATE INDEX IF NOT EXISTS activities_actor_idx ON activities(actor_type, actor_id)')
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
