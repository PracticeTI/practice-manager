import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { runOptionalDdl, whenTablesMissing } from './pgOptionalDdl.js'

// Ensures the domain-scoped tables that back the patient "Quotes" feature.
//
// patient_quotes holds the quote header (the document given to a participant or
// plan manager) while quote_items holds its priced lines. Both follow the same
// conventions as the other feature tables in this platform (domain + patient_id
// + metadata JSON, no foreign keys), so a row can never be orphaned by a deleted
// patient and the domain audit can treat them uniformly.
//
// NDIS price limits are snapshotted onto quote_items.price_limit rather than
// looked up at read time: the NDIS republishes its catalogue each financial year,
// so a stored quote has to keep the limit that applied when it was prepared.
export async function ensurePatientQuotesTables() {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        throw new Error('Patient quotes require a configured PostgreSQL database')
    }

    let connection = null
    try {
        connection = await getDatabaseConnection()

        await whenTablesMissing(connection, ['patient_quotes'], async () => {
            await connection.query(`
                CREATE TABLE IF NOT EXISTS patient_quotes (
                    id SERIAL PRIMARY KEY,
                    domain VARCHAR(100) NOT NULL,
                    patient_id INTEGER NOT NULL,
                    quote_number VARCHAR(120) NOT NULL DEFAULT '',
                    status VARCHAR(24) NOT NULL DEFAULT 'draft',
                    funding_type VARCHAR(24) NOT NULL DEFAULT 'ndis',
                    pricing_region VARCHAR(24) NOT NULL DEFAULT 'national',
                    plan_manager VARCHAR(255),
                    ndis_number VARCHAR(64),
                    quote_date DATE,
                    valid_until DATE,
                    prepared_by VARCHAR(255),
                    gst_applicable BOOLEAN NOT NULL DEFAULT FALSE,
                    notes TEXT,
                    metadata JSONB,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )
            `)
            await connection.query('CREATE INDEX IF NOT EXISTS patient_quotes_domain_idx ON patient_quotes(domain)')
            await connection.query('CREATE INDEX IF NOT EXISTS patient_quotes_domain_patient_idx ON patient_quotes(domain, patient_id)')
            await connection.query('CREATE INDEX IF NOT EXISTS patient_quotes_status_idx ON patient_quotes(status)')

            // Import provenance, matching patient_cases: a NULL external id is
            // distinct in the unique index, so manually created quotes never collide.
            await runOptionalDdl(connection, 'ALTER TABLE patient_quotes ADD COLUMN IF NOT EXISTS external_id VARCHAR(120)')
            await runOptionalDdl(connection, 'ALTER TABLE patient_quotes ADD COLUMN IF NOT EXISTS external_source VARCHAR(64)')
            await runOptionalDdl(connection, 'ALTER TABLE patient_quotes ADD COLUMN IF NOT EXISTS external_patient_id VARCHAR(120)')
            await connection.query(`
                CREATE UNIQUE INDEX IF NOT EXISTS patient_quotes_domain_source_external_idx
                    ON patient_quotes(domain, external_source, external_id)
            `)
        })

        await whenTablesMissing(connection, ['quote_items'], async () => {
            await connection.query(`
                CREATE TABLE IF NOT EXISTS quote_items (
                    id SERIAL PRIMARY KEY,
                    domain VARCHAR(100) NOT NULL,
                    quote_id INTEGER NOT NULL,
                    patient_id INTEGER NOT NULL,
                    position INTEGER NOT NULL DEFAULT 0,
                    ndis_support_item_number VARCHAR(48),
                    ndis_support_item_name VARCHAR(255),
                    registration_group_number VARCHAR(16),
                    registration_group_name VARCHAR(160),
                    support_category_number VARCHAR(16),
                    support_category_name VARCHAR(160),
                    unit VARCHAR(16),
                    quantity NUMERIC(12,2) NOT NULL DEFAULT 1,
                    unit_price NUMERIC(14,2) NOT NULL DEFAULT 0,
                    price_limit NUMERIC(14,2),
                    quote_required BOOLEAN NOT NULL DEFAULT FALSE,
                    description TEXT,
                    metadata JSONB,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )
            `)
        })
        // Optional upgrades: `CREATE INDEX` still needs table ownership even when the
        // index is already there, and the runtime role is deliberately not the owner.
        await runOptionalDdl(connection, 'CREATE INDEX IF NOT EXISTS quote_items_domain_quote_idx ON quote_items(domain, quote_id)')
        await runOptionalDdl(connection, 'CREATE INDEX IF NOT EXISTS quote_items_quote_id_idx ON quote_items(quote_id)')
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
