import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { runOptionalDdl, whenTablesMissing } from './pgOptionalDdl.js'

// Ensures the `patients` table can hold imported (external-system) records.
//
// The table itself is owned by the domain settings flow; the import feature only
// adds what it needs on top: the external system's primary key (`external_id`)
// and the system it came from (`external_source`), plus the unique index that
// makes a repeat import update a row instead of duplicating it. Existing rows
// keep NULL external ids, and NULLs are distinct in a PostgreSQL unique index,
// so manual records never collide.
export async function ensurePatientsImportSchema() {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        throw new Error('Patient import requires a configured PostgreSQL database')
    }

    let connection = null
    try {
        connection = await getDatabaseConnection()

        await whenTablesMissing(connection, ['patients'], async () => {
            await connection.query(`
                CREATE TABLE IF NOT EXISTS patients (
                    id SERIAL PRIMARY KEY,
                    patient_name VARCHAR(255) NOT NULL,
                    domain VARCHAR(100) NOT NULL,
                    metadata JSONB,
                    external_id VARCHAR(120),
                    external_source VARCHAR(64),
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )
            `)
        })
        await runOptionalDdl(connection, 'ALTER TABLE patients ADD COLUMN IF NOT EXISTS external_id VARCHAR(120)')
        await runOptionalDdl(connection, 'ALTER TABLE patients ADD COLUMN IF NOT EXISTS external_source VARCHAR(64)')
        // Optional upgrades: `CREATE INDEX` still needs table ownership even when the
        // index is already there, and the runtime role is deliberately not the owner.
        await runOptionalDdl(connection, 'CREATE INDEX IF NOT EXISTS patients_domain_idx ON patients(domain)')
        await runOptionalDdl(connection, `
            CREATE UNIQUE INDEX IF NOT EXISTS patients_domain_source_external_idx
            ON patients(domain, external_source, external_id)
        `)
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}

// The `patients` table is owned by the domain settings flow, so consumers that
// only want to *read* alongside it (for example the Contacts list showing which
// patients a contact is linked to) need to know whether it exists before joining.
// `to_regclass` resolves the name through the current search_path and returns
// NULL when the table has never been created, which keeps a domain that has no
// patients from failing a query that would otherwise work.
export async function patientsTableExists(connection) {
    if (!connection?.query) return false

    const result = await connection.query("SELECT to_regclass('patients') AS reg")
    return Boolean(result.rows?.[0]?.reg)
}

// Guards the optional contact->patient links: a contact may only be linked to
// patients that exist in the same domain, so a stale id or a cross-domain value is
// rejected instead of silently attaching to someone else's record. A missing
// patients table reads as "no match" rather than an error.
export async function patientsBelongToDomain(connection, patientIds, domain) {
    const ids = (Array.isArray(patientIds) ? patientIds : [])
        .map((value) => Number.parseInt(String(value || ''), 10))
        .filter((id) => Number.isFinite(id) && id > 0)

    if (ids.length === 0) return true
    if (!connection?.query || !domain) return false
    if (!(await patientsTableExists(connection))) return false

    const unique = Array.from(new Set(ids))
    const result = await connection.query(
        'SELECT COUNT(*)::int AS total FROM patients WHERE domain = $1 AND id = ANY($2::int[])',
        [domain, unique]
    )
    return (result.rows?.[0]?.total || 0) === unique.length
}
