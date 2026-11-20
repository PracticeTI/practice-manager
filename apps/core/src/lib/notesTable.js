import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { whenTablesMissing } from './pgOptionalDdl.js'

// Ensures the domain-scoped table that backs the Notes entity.
//
// A note row is one clinical note (progress note / session note / follow-up)
// imported from an external practice-management system - a Splose "notes" CSV
// export is the reference format. The external system's primary key is kept in
// `external_id` so repeat imports update existing rows instead of creating
// duplicates.
//
// `content` holds the note body exactly as the export serialised it (a
// ProseMirror/TipTap document), `content_text` holds the flattened plain text
// so lists and previews can search and render a note without parsing the
// document, and `metadata` carries source-specific provenance. There are no
// foreign keys, so a missing/renamed patient never blocks an import.
export async function ensureNotesTable() {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        throw new Error('Notes require a configured PostgreSQL database')
    }

    let connection = null
    try {
        connection = await getDatabaseConnection()

        await whenTablesMissing(connection, ['notes'], async () => {
            await connection.query(`
                CREATE TABLE IF NOT EXISTS notes (
                    id SERIAL PRIMARY KEY,
                    domain VARCHAR(100) NOT NULL,
                    external_id VARCHAR(120),
                    external_source VARCHAR(64) NOT NULL DEFAULT 'manual',
                    title VARCHAR(255),
                    draft BOOLEAN NOT NULL DEFAULT FALSE,
                    content JSONB,
                    content_text TEXT,
                    patient_id INTEGER,
                    patient_name VARCHAR(255),
                    external_patient_id VARCHAR(120),
                    external_appointment_id VARCHAR(120),
                    practitioner_name VARCHAR(255),
                    external_practitioner_id VARCHAR(120),
                    metadata JSONB,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )
            `)
            await connection.query('CREATE INDEX IF NOT EXISTS notes_domain_idx ON notes(domain)')
            await connection.query('CREATE INDEX IF NOT EXISTS notes_domain_patient_idx ON notes(domain, patient_id)')
            await connection.query('CREATE INDEX IF NOT EXISTS notes_domain_updated_idx ON notes(domain, updated_at)')
            // NULLs are distinct in a PostgreSQL unique index, so manual notes
            // without an external id never collide.
            await connection.query(`
                CREATE UNIQUE INDEX IF NOT EXISTS notes_domain_source_external_idx
                ON notes(domain, external_source, external_id)
            `)
        })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
