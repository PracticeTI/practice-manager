import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { whenTablesMissing, runOptionalDdl } from './pgOptionalDdl.js'

export async function ensurePatientTranscriptionsTable() {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        throw new Error('Patient transcription support requires a configured PostgreSQL database')
    }

    let connection = null
    try {
        connection = await getDatabaseConnection()

        await whenTablesMissing(connection, ['patient_transcriptions'], async () => {
            await connection.query(`
                CREATE TABLE IF NOT EXISTS patient_transcriptions (
                    id SERIAL PRIMARY KEY,
                    domain VARCHAR(100) NOT NULL,
                    patient_id INTEGER NOT NULL,
                    status VARCHAR(50) NOT NULL DEFAULT 'recording',
                    source VARCHAR(100) NOT NULL DEFAULT 'browser-live',
                    title VARCHAR(255),
                    meeting_external_id VARCHAR(255),
                    audio_mime_type VARCHAR(100),
                    audio_seconds NUMERIC,
                    transcript_text TEXT,
                    metadata JSONB,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )
            `)
        })
        // Optional upgrades: `CREATE INDEX` still needs table ownership even when the
        // index is already there, and the runtime role is deliberately not the owner.
        await runOptionalDdl(connection, 'CREATE INDEX IF NOT EXISTS patient_transcriptions_domain_idx ON patient_transcriptions(domain)')
        await runOptionalDdl(connection, 'CREATE INDEX IF NOT EXISTS patient_transcriptions_patient_idx ON patient_transcriptions(patient_id)')
        await runOptionalDdl(connection, 'CREATE INDEX IF NOT EXISTS patient_transcriptions_domain_patient_idx ON patient_transcriptions(domain, patient_id)')
        await runOptionalDdl(connection, 'CREATE INDEX IF NOT EXISTS patient_transcriptions_created_idx ON patient_transcriptions(created_at DESC)')
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
