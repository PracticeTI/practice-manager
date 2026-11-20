import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { runOptionalDdl, whenTablesMissing } from './pgOptionalDdl.js'

export async function ensurePatientFilesTable() {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        throw new Error('Patient file support requires a configured PostgreSQL database')
    }

    let connection = null
    try {
        connection = await getDatabaseConnection()

        await whenTablesMissing(connection, ['patient_files'], async () => {
            await connection.query(`
                CREATE TABLE IF NOT EXISTS patient_files (
                    id SERIAL PRIMARY KEY,
                    domain VARCHAR(100) NOT NULL,
                    patient_id INTEGER,
                    file_name VARCHAR(500) NOT NULL,
                    mime_type VARCHAR(255) NOT NULL DEFAULT 'application/octet-stream',
                    file_size BIGINT NOT NULL,
                    file_data BYTEA,
                    storage_backend VARCHAR(20) NOT NULL DEFAULT 'database',
                    storage_key TEXT,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )
            `)
        })
        // Every statement below is owner-only DDL, which the runtime role cannot run
        // even when the change is already in effect (`ALTER TABLE … ENABLE ROW LEVEL
        // SECURITY` on an RLS-enabled table still fails with SQLSTATE 42501). The
        // schema and its FORCEd policy belong to the owner pass; see
        // docs/postgres-rls-rollout.md.
        //
        // Rows written before file storage was configurable always carry bytes, and
        // every row written since names the backend that holds them. Both columns are
        // added here so a practice created before either change keeps working.
        await runOptionalDdl(connection, 'ALTER TABLE patient_files ADD COLUMN IF NOT EXISTS storage_backend VARCHAR(20) NOT NULL DEFAULT \'database\'')
        await runOptionalDdl(connection, 'ALTER TABLE patient_files ADD COLUMN IF NOT EXISTS storage_key TEXT')
        // A practice-level file has no patient, and a file kept in an external backend
        // has no bytes in the row, so both columns must accept NULL.
        await runOptionalDdl(connection, 'ALTER TABLE patient_files ALTER COLUMN patient_id DROP NOT NULL')
        await runOptionalDdl(connection, 'ALTER TABLE patient_files ALTER COLUMN file_data DROP NOT NULL')
        // Reference documents the FCA Analyst reads as evidence (see the analyst's "Reference
        // documents" step). The flag lives on the file row rather than in patient metadata so a
        // deleted file cannot leave a stale selection behind, and any consumer can query scope.
        await runOptionalDdl(connection, 'ALTER TABLE patient_files ADD COLUMN IF NOT EXISTS analysis_evidence BOOLEAN NOT NULL DEFAULT FALSE')
        await runOptionalDdl(connection, 'CREATE INDEX IF NOT EXISTS patient_files_domain_patient_idx ON patient_files(domain, patient_id)')
        // The Files page lists a practice's newest files across every patient, so it
        // reads by domain and time rather than by patient.
        await runOptionalDdl(connection, 'CREATE INDEX IF NOT EXISTS patient_files_domain_created_idx ON patient_files(domain, created_at DESC)')
        await runOptionalDdl(connection, 'ALTER TABLE patient_files ENABLE ROW LEVEL SECURITY')
        await runOptionalDdl(connection, 'ALTER TABLE patient_files FORCE ROW LEVEL SECURITY')
        await runOptionalDdl(connection, 'DROP POLICY IF EXISTS dev_allow_all_patient_files ON patient_files')
        // No `TO` clause, so this applies to PUBLIC — deliberately. The table is FORCEd,
        // so the owner connection is subject to the policy too, and the predicate below
        // already confines every role: without a bound domain `current_setting` returns
        // NULL and the comparison yields no rows. Scoping it to the runtime role would
        // lock out the owner connection those routes still use.
        await runOptionalDdl(connection, `
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_policies
                    WHERE schemaname = 'public'
                      AND tablename = 'patient_files'
                      AND policyname = 'patient_files_domain_policy'
                ) THEN
                    CREATE POLICY patient_files_domain_policy
                        ON patient_files
                        FOR ALL
                        USING (
                            current_setting('app.current_role', true) = 'superadmin'
                            OR domain = current_setting('app.current_domain', true)
                        )
                        WITH CHECK (
                            current_setting('app.current_role', true) = 'superadmin'
                            OR domain = current_setting('app.current_domain', true)
                        );
                END IF;
            END
            $$
        `)
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}