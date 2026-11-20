import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { whenTablesMissing } from './pgOptionalDdl.js'

// Ensures the domain-scoped table that backs the Forms entity.
//
// A form row is one submitted intake questionnaire imported from an external
// practice-management system (for example a Splose "form" CSV export). The
// external system's primary key is kept in `external_id` so repeat imports can
// update existing rows instead of creating duplicates.
//
// `content` holds the whole answered submission, `answers` / `labelled_answers`
// hold the subset that maps onto the app's intake schema (and is what populates
// a patient's Intake Data), and `metadata` carries source-specific extras.
// There are no foreign keys, so a missing/renamed patient never blocks an
// import.
export async function ensureFormsTable() {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        throw new Error('Forms require a configured PostgreSQL database')
    }

    let connection = null
    try {
        connection = await getDatabaseConnection()

        await whenTablesMissing(connection, ['forms'], async () => {
            await connection.query(`
                CREATE TABLE IF NOT EXISTS forms (
                    id SERIAL PRIMARY KEY,
                    domain VARCHAR(100) NOT NULL,
                    external_id VARCHAR(120),
                    external_source VARCHAR(64) NOT NULL DEFAULT 'manual',
                    title VARCHAR(255),
                    submitted_message TEXT,
                    submitted_at TIMESTAMPTZ,
                    patient_id INTEGER,
                    patient_name VARCHAR(255),
                    external_patient_id VARCHAR(120),
                    archived BOOLEAN NOT NULL DEFAULT FALSE,
                    content JSONB,
                    answers JSONB,
                    labelled_answers JSONB,
                    metadata JSONB,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )
            `)
            await connection.query('CREATE INDEX IF NOT EXISTS forms_domain_idx ON forms(domain)')
            await connection.query('CREATE INDEX IF NOT EXISTS forms_domain_patient_idx ON forms(domain, patient_id)')
            await connection.query('CREATE INDEX IF NOT EXISTS forms_domain_submitted_idx ON forms(domain, submitted_at)')
            // NULLs are distinct in a PostgreSQL unique index, so manual forms
            // without an external id never collide.
            await connection.query(`
                CREATE UNIQUE INDEX IF NOT EXISTS forms_domain_source_external_idx
                ON forms(domain, external_source, external_id)
            `)
        })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
