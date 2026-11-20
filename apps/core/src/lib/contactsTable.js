import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { missingTables, runOptionalDdl } from './pgOptionalDdl.js'
import { patientsTableExists } from '@/lib/patientsTable'

// Arbitrary application-level key for the one-time `contacts.patient_id`
// migration lock. Only needs to be unique within this app.
const LEGACY_LINK_LOCK_KEY = 4783142

// Ensures the domain-scoped tables that back the Contacts entity.
//
// A contact is a person or organisation the domain deals with. Following the
// other feature tables in this platform the rows carry a `domain` so each domain
// keeps its own address book, and there are no foreign keys — the `association`
// a contact belongs to is free text rather than a link, so renaming or removing
// an organisation never orphans a contact.
//
// The patient link is many-to-many: one support coordinator or plan manager is
// normally looking after several patients, so `contact_patients` holds the pairs
// rather than a single column. The ids stay plain integers with no FK so a
// contact imported before (or without) the patients table never blocks, and a
// row whose patient is gone simply reads as unlinked.
export async function ensureContactsTable() {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        throw new Error('Contacts require a configured PostgreSQL database')
    }

    let connection = null
    try {
        connection = await getDatabaseConnection()

        // Probe first: `CREATE TABLE IF NOT EXISTS` still needs CREATE on the
        // schema, which the constrained runtime role does not hold, so a provisioned
        // database must not issue the statement at all.
        const missing = await missingTables(connection, ['contacts', 'contact_patients'])

        if (missing.includes('contacts')) await connection.query(`
            CREATE TABLE IF NOT EXISTS contacts (
                id SERIAL PRIMARY KEY,
                domain VARCHAR(100) NOT NULL,
                name VARCHAR(255) NOT NULL DEFAULT '',
                email VARCHAR(320) NOT NULL DEFAULT '',
                phone VARCHAR(64) NOT NULL DEFAULT '',
                association VARCHAR(255) NOT NULL DEFAULT '',
                role VARCHAR(160) NOT NULL DEFAULT '',
                notes TEXT NOT NULL DEFAULT '',
                metadata JSONB,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        `)
        if (missing.includes('contact_patients')) await connection.query(`
            CREATE TABLE IF NOT EXISTS contact_patients (
                id SERIAL PRIMARY KEY,
                domain VARCHAR(100) NOT NULL,
                contact_id INTEGER NOT NULL,
                patient_id INTEGER NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE (contact_id, patient_id)
            )
        `)
        await runOptionalDdl(connection, 'CREATE INDEX IF NOT EXISTS contacts_domain_idx ON contacts(domain)')
        // The list is alphabetical, so back the ordered read rather than recency.
        await runOptionalDdl(connection, 'CREATE INDEX IF NOT EXISTS contacts_domain_name_idx ON contacts(domain, LOWER(name))')
        await runOptionalDdl(connection, 'CREATE INDEX IF NOT EXISTS contacts_domain_updated_idx ON contacts(domain, updated_at)')
        // Links are read from both ends: a patient's contacts panel and a directory
        // row's linked patients.
        await runOptionalDdl(connection, 'CREATE INDEX IF NOT EXISTS contact_patients_domain_patient_idx ON contact_patients(domain, patient_id)')
        await runOptionalDdl(connection, 'CREATE INDEX IF NOT EXISTS contact_patients_contact_idx ON contact_patients(contact_id)')

        await migrateLegacyPatientLink(connection)
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
    }
}

// Deployments that predate the join table held a single patient per contact in
// `contacts.patient_id`. Carry those links over and retire the column so a link
// only ever lives in one place. Several requests can run this concurrently, so
// the check/backfill/drop sequence is serialised with a transaction-scoped
// advisory lock: the second caller waits, then finds the column already gone.
export async function migrateLegacyPatientLink(connection) {
    if (!connection?.query) return

    const columnExists = async () => {
        const result = await connection.query(`
            SELECT 1
              FROM information_schema.columns
             WHERE table_schema = current_schema()
               AND table_name = 'contacts'
               AND column_name = 'patient_id'
             LIMIT 1
        `)
        return (result.rows?.length || 0) > 0
    }

    if (!(await columnExists())) return

    await connection.query('BEGIN')
    try {
        await connection.query('SELECT pg_advisory_xact_lock($1)', [LEGACY_LINK_LOCK_KEY])

        if (await columnExists()) {
            // Only links that resolve to a real patient are worth carrying over.
            if (await patientsTableExists(connection)) {
                await connection.query(`
                    INSERT INTO contact_patients (domain, contact_id, patient_id)
                    SELECT c.domain, c.id, c.patient_id
                      FROM contacts c
                      JOIN patients p ON p.id = c.patient_id
                     WHERE c.patient_id IS NOT NULL
                    ON CONFLICT (contact_id, patient_id) DO NOTHING
                `)
            }
            await connection.query('ALTER TABLE contacts DROP COLUMN IF EXISTS patient_id')
        }

        await connection.query('COMMIT')
    } catch (error) {
        await connection.query('ROLLBACK').catch(() => { })
        throw error
    }
}

/** Link a contact to a patient. Repeating the same pair is a no-op. */
export async function linkContactToPatient(connection, { domain, contactId, patientId }) {
    if (!connection?.query) return
    await connection.query(
        `INSERT INTO contact_patients (domain, contact_id, patient_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (contact_id, patient_id) DO NOTHING`,
        [domain, contactId, patientId]
    )
}

/** Remove a single patient link, leaving any other links (and the contact) alone. */
export async function unlinkContactFromPatient(connection, { domain, contactId, patientId }) {
    if (!connection?.query) return
    await connection.query(
        'DELETE FROM contact_patients WHERE domain = $1 AND contact_id = $2 AND patient_id = $3',
        [domain, contactId, patientId]
    )
}

/** Drop every patient link a contact has — used when the contact itself goes. */
export async function deleteContactPatientLinks(connection, { domain, contactId }) {
    if (!connection?.query) return
    await connection.query(
        'DELETE FROM contact_patients WHERE domain = $1 AND contact_id = $2',
        [domain, contactId]
    )
}

/**
 * Make a contact's patient links exactly `patientIds`. The additions and
 * removals run as separate statements so a concurrent read never sees the
 * contact momentarily linked to nobody.
 */
export async function replaceContactPatients(connection, { domain, contactId, patientIds }) {
    if (!connection?.query) return

    const ids = Array.isArray(patientIds) ? patientIds : []

    await connection.query(
        `DELETE FROM contact_patients
          WHERE domain = $1 AND contact_id = $2 AND patient_id <> ALL($3::int[])`,
        [domain, contactId, ids]
    )

    if (ids.length === 0) return

    await connection.query(
        `INSERT INTO contact_patients (domain, contact_id, patient_id)
         SELECT $1, $2, pid FROM unnest($3::int[]) AS pid
         ON CONFLICT (contact_id, patient_id) DO NOTHING`,
        [domain, contactId, ids]
    )
}

/** How many patients a contact is linked to. */
export async function countContactPatientLinks(connection, contactId) {
    if (!connection?.query) return 0
    const result = await connection.query(
        'SELECT COUNT(*)::int AS total FROM contact_patients WHERE contact_id = $1',
        [contactId]
    )
    return result.rows?.[0]?.total || 0
}
