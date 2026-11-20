import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { runOptionalDdl, whenTablesMissing } from './pgOptionalDdl.js'

// Ensures the domain-scoped tables that back the patient "Cases" feature.
// patient_cases holds a funding/allocation container (budget, hours or sessions)
// for one patient, while case_usage holds the dated line items that draw the
// allocation down. Both follow the same conventions as other feature tables in
// this platform (domain + patient_id + metadata JSON, no foreign keys).
export async function ensurePatientCasesTables() {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        throw new Error('Patient cases require a configured PostgreSQL database')
    }

    let connection = null
    try {
        connection = await getDatabaseConnection()

        await whenTablesMissing(connection, ['patient_cases'], async () => {
            await connection.query(`
                CREATE TABLE IF NOT EXISTS patient_cases (
                    id SERIAL PRIMARY KEY,
                    domain VARCHAR(100) NOT NULL,
                    patient_id INTEGER NOT NULL,
                    case_number VARCHAR(120) NOT NULL DEFAULT '',
                    status VARCHAR(24) NOT NULL DEFAULT 'open',
                    case_type VARCHAR(24) NOT NULL DEFAULT 'budget',
                    total_allocation NUMERIC(14,2) NOT NULL DEFAULT 0,
                    practitioner VARCHAR(255),
                    issue_date DATE,
                    expiry_date DATE,
                    disable_exceeding BOOLEAN NOT NULL DEFAULT FALSE,
                    referral_contact VARCHAR(255),
                    referral_issue_date DATE,
                    referral_period VARCHAR(120),
                    notes TEXT,
                    metadata JSONB,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )
            `)
            await connection.query('CREATE INDEX IF NOT EXISTS patient_cases_domain_idx ON patient_cases(domain)')
            await connection.query('CREATE INDEX IF NOT EXISTS patient_cases_domain_patient_idx ON patient_cases(domain, patient_id)')
            await connection.query('CREATE INDEX IF NOT EXISTS patient_cases_status_idx ON patient_cases(status)')

            // Import provenance. Cases brought in from an external practice
            // management system keep that system's case id, so a repeat import
            // updates the existing row instead of duplicating it. Manual rows leave
            // these NULL, and PostgreSQL treats NULLs as distinct in a unique index,
            // so they never collide.
            await runOptionalDdl(connection, 'ALTER TABLE patient_cases ADD COLUMN IF NOT EXISTS external_id VARCHAR(120)')
            await runOptionalDdl(connection, 'ALTER TABLE patient_cases ADD COLUMN IF NOT EXISTS external_source VARCHAR(64)')
            await runOptionalDdl(connection, 'ALTER TABLE patient_cases ADD COLUMN IF NOT EXISTS external_patient_id VARCHAR(120)')
            await connection.query(`
                CREATE UNIQUE INDEX IF NOT EXISTS patient_cases_domain_source_external_idx
                    ON patient_cases(domain, external_source, external_id)
            `)
        })

        await whenTablesMissing(connection, ['case_usage'], async () => {
            await connection.query(`
                CREATE TABLE IF NOT EXISTS case_usage (
                    id SERIAL PRIMARY KEY,
                    domain VARCHAR(100) NOT NULL,
                    case_id INTEGER NOT NULL,
                    patient_id INTEGER NOT NULL,
                    entry_date DATE NOT NULL,
                    description VARCHAR(255),
                    quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
                    metadata JSONB,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )
            `)
        })
        // Optional upgrades: `CREATE INDEX` still needs table ownership even when the
        // index is already there, and the runtime role is deliberately not the owner.
        await runOptionalDdl(connection, 'CREATE INDEX IF NOT EXISTS case_usage_domain_case_idx ON case_usage(domain, case_id)')
        await runOptionalDdl(connection, 'CREATE INDEX IF NOT EXISTS case_usage_case_id_idx ON case_usage(case_id)')
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
