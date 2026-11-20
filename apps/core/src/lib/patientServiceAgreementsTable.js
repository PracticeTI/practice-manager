import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { runOptionalDdl, whenTablesMissing } from './pgOptionalDdl.js'

// Ensures the domain-scoped tables that back the patient "Service Agreements"
// feature.
//
// A service agreement is the signed contract that governs *ongoing delivery*
// (scope, pricing arrangement, plan-management type, cancellation/notice terms,
// consent and signatures), where a quote is a priced proposal for specific
// supports. It is stored as a header (patient_service_agreements) plus a
// "Schedule of Supports" of priced lines (service_agreement_items), mirroring
// patient_quotes / quote_items so the two features share their conventions:
// domain + patient_id + metadata JSON, no foreign keys, and an import-provenance
// unique index.
//
// `service_agreement_items.price_limit` is snapshotted for the same reason as
// quote_items: the NDIS republishes its catalogue each financial year, and a
// signed agreement has to keep the prices and limits that were agreed at
// signing. `source_quote_id` records the quote an agreement was derived from
// without a foreign key, so a deleted quote never orphans the agreement.
export async function ensurePatientServiceAgreementsTables() {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        throw new Error('Patient service agreements require a configured PostgreSQL database')
    }

    let connection = null
    try {
        connection = await getDatabaseConnection()

        await whenTablesMissing(connection, ['patient_service_agreements'], async () => {
            await connection.query(`
                CREATE TABLE IF NOT EXISTS patient_service_agreements (
                    id SERIAL PRIMARY KEY,
                    domain VARCHAR(100) NOT NULL,
                    patient_id INTEGER NOT NULL,
                    agreement_number VARCHAR(120) NOT NULL DEFAULT '',
                    status VARCHAR(24) NOT NULL DEFAULT 'draft',
                    funding_type VARCHAR(24) NOT NULL DEFAULT 'ndis',
                    plan_management_type VARCHAR(24) NOT NULL DEFAULT 'unknown',
                    plan_manager VARCHAR(255),
                    ndis_number VARCHAR(64),
                    plan_start DATE,
                    plan_end DATE,
                    start_date DATE,
                    end_date DATE,
                    review_date DATE,
                    prepared_by VARCHAR(255),
                    cancellation_notice_days INTEGER NOT NULL DEFAULT 2,
                    cancellation_policy TEXT,
                    telehealth_authorised BOOLEAN NOT NULL DEFAULT FALSE,
                    non_face_to_face_authorised BOOLEAN NOT NULL DEFAULT FALSE,
                    travel_claimable BOOLEAN NOT NULL DEFAULT FALSE,
                    terms TEXT,
                    source_quote_id INTEGER,
                    version INTEGER NOT NULL DEFAULT 1,
                    supersedes_agreement_id INTEGER,
                    participant_signatory_name VARCHAR(255),
                    participant_signed_at TIMESTAMPTZ,
                    representative_name VARCHAR(255),
                    representative_relationship VARCHAR(120),
                    representative_signed_at TIMESTAMPTZ,
                    provider_signatory_name VARCHAR(255),
                    provider_signed_at TIMESTAMPTZ,
                    terminated_at TIMESTAMPTZ,
                    termination_reason TEXT,
                    notes TEXT,
                    metadata JSONB,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )
            `)
            await connection.query('CREATE INDEX IF NOT EXISTS patient_service_agreements_domain_idx ON patient_service_agreements(domain)')
            await connection.query('CREATE INDEX IF NOT EXISTS patient_service_agreements_domain_patient_idx ON patient_service_agreements(domain, patient_id)')
            await connection.query('CREATE INDEX IF NOT EXISTS patient_service_agreements_status_idx ON patient_service_agreements(status)')
            await connection.query('CREATE INDEX IF NOT EXISTS patient_service_agreements_source_quote_idx ON patient_service_agreements(domain, source_quote_id)')

            // Import provenance, matching patient_quotes / patient_cases: a NULL
            // external id is distinct in the unique index, so manually created
            // agreements never collide.
            await runOptionalDdl(connection, 'ALTER TABLE patient_service_agreements ADD COLUMN IF NOT EXISTS external_id VARCHAR(120)')
            await runOptionalDdl(connection, 'ALTER TABLE patient_service_agreements ADD COLUMN IF NOT EXISTS external_source VARCHAR(64)')
            await runOptionalDdl(connection, 'ALTER TABLE patient_service_agreements ADD COLUMN IF NOT EXISTS external_patient_id VARCHAR(120)')
            await connection.query(`
                CREATE UNIQUE INDEX IF NOT EXISTS patient_service_agreements_domain_source_external_idx
                    ON patient_service_agreements(domain, external_source, external_id)
            `)
        })

        await whenTablesMissing(connection, ['service_agreement_items'], async () => {
            await connection.query(`
                CREATE TABLE IF NOT EXISTS service_agreement_items (
                    id SERIAL PRIMARY KEY,
                    domain VARCHAR(100) NOT NULL,
                    agreement_id INTEGER NOT NULL,
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
        await runOptionalDdl(connection, 'CREATE INDEX IF NOT EXISTS service_agreement_items_domain_agreement_idx ON service_agreement_items(domain, agreement_id)')
        await runOptionalDdl(connection, 'CREATE INDEX IF NOT EXISTS service_agreement_items_agreement_id_idx ON service_agreement_items(agreement_id)')
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
