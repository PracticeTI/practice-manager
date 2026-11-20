import { NextResponse } from 'next/server'
import { getPatientFormalReport, savePatientFormalReport } from '@/lib/serviceClient'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'

const DEFAULT_FORMAL_REPORTS_TABLE = 'patient_reports'
const DEFAULT_REPORT_DRAFTS_TABLE = 'patient_report_drafts'

function isSafeSqlIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ''))
}

function resolveFormalReportsTable() {
    const table = String(process.env.PATIENT_REPORTS_TABLE || DEFAULT_FORMAL_REPORTS_TABLE).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error('PATIENT_REPORTS_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
    }
    return table
}

function resolveReportDraftsTable() {
    const table = String(process.env.PATIENT_REPORT_DRAFTS_TABLE || DEFAULT_REPORT_DRAFTS_TABLE).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error('PATIENT_REPORT_DRAFTS_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
    }
    return table
}

function parseJsonObject(value) {
    if (!value) return null
    if (typeof value === 'object' && !Array.isArray(value)) return value
    try {
        const parsed = JSON.parse(value)
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
    } catch {
        return null
    }
}

function normalizeText(value, maxLength = 200000) {
    const text = String(value || '')
    return text.slice(0, maxLength)
}

function normalizeSourceMetadata(value) {
    const parsed = parseJsonObject(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed
    }
    return {}
}

function buildReportTypeMetadata(payload) {
    const reportTypeId = normalizeText(payload?.report_type_id || payload?.reportTypeId || '', 240).trim()
    const reportType = normalizeText(payload?.report_type || payload?.reportType || '', 240).trim()

    return {
        reportTypeId: reportTypeId || null,
        reportType: reportType || null,
    }
}

function buildSourceMetadataForSave(payload) {
    const base = normalizeSourceMetadata(payload?.source_metadata || payload?.sourceMetadata)
    const metadata = {
        ...base,
    }
    const typeMetadata = buildReportTypeMetadata(payload)

    if (typeMetadata.reportTypeId && !String(metadata.reportTypeId || '').trim()) {
        metadata.reportTypeId = typeMetadata.reportTypeId
    }
    if (typeMetadata.reportType && !String(metadata.reportType || '').trim()) {
        metadata.reportType = typeMetadata.reportType
    }

    return metadata
}

function normalizeReportRow(row) {
    if (!row || typeof row !== 'object') return null
    return {
        id: row.id,
        domain: row.domain,
        patientId: row.patient_id,
        patientName: row.patient_name,
        status: String(row.status || 'ready').trim().toLowerCase() || 'ready',
        transcriptCount: Number(row.transcript_count || 0),
        reportMarkdown: String(row.report_markdown || '').trim(),
        sourceNotes: String(row.source_notes || '').trim(),
        sourceMetadata: parseJsonObject(row.source_metadata_json || null),
        lastJobId: row.last_job_id || null,
        createdAt: row.created_at_tz || row.created_at || null,
        updatedAt: row.updated_at_tz || row.updated_at || null
    }
}

function isMissingTableError(error) {
    const message = String(error?.message || '').toLowerCase()
    return message.includes('does not exist')
        || (message.includes('relation') && message.includes('does not exist'))
}

async function fetchLocalReportPostgres(connection, table, domain, patientId) {
    const result = await connection.query(
        `
            SELECT *,
                         (created_at AT TIME ZONE current_setting('TIMEZONE')) AS created_at_tz,
                         (updated_at AT TIME ZONE current_setting('TIMEZONE')) AS updated_at_tz
      FROM ${table}
      WHERE domain = $1 AND patient_id = $2
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `,
        [domain, patientId]
    )
    return result.rows?.[0] || null
}

function getReportTableSchemaStatements(table, dbType) {
    if (dbType === 'postgresql') {
        return {
            create: `
            CREATE TABLE IF NOT EXISTS ${table} (
                id BIGSERIAL PRIMARY KEY,
                domain VARCHAR(100) NOT NULL,
                patient_id BIGINT NOT NULL,
                patient_name TEXT,
                report_markdown TEXT NOT NULL,
                source_notes TEXT,
                transcript_count INTEGER NOT NULL DEFAULT 0,
                source_metadata_json TEXT NOT NULL DEFAULT '{}',
                last_job_id BIGINT,
                status VARCHAR(32) NOT NULL DEFAULT 'ready',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT ${table}_domain_patient_unique UNIQUE (domain, patient_id)
            )
        `,
            indexes: [
                `CREATE INDEX IF NOT EXISTS ${table}_domain_patient_idx ON ${table} (domain, patient_id)`,
                `CREATE INDEX IF NOT EXISTS ${table}_updated_idx ON ${table} (updated_at)`
            ]
        }
    }

    throw new Error(`Unsupported database type for patient reports: ${dbType}`)
}

function getReportDraftTableSchemaStatements(table, dbType) {
    if (dbType === 'postgresql') {
        return {
            create: `
            CREATE TABLE IF NOT EXISTS ${table} (
                id BIGSERIAL PRIMARY KEY,
                domain VARCHAR(100) NOT NULL,
                patient_id BIGINT,
                patient_name TEXT,
                report_markdown TEXT NOT NULL,
                source_notes TEXT,
                transcript_count INTEGER NOT NULL DEFAULT 0,
                source_metadata_json TEXT NOT NULL DEFAULT '{}',
                last_job_id BIGINT,
                status VARCHAR(32) NOT NULL DEFAULT 'ready',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `,
            indexes: [
                `CREATE INDEX IF NOT EXISTS ${table}_domain_patient_idx ON ${table} (domain, patient_id)`,
                `CREATE INDEX IF NOT EXISTS ${table}_updated_idx ON ${table} (updated_at)`,
                // A patient keeps a single working draft: the in-progress save that is not tied to
                // a report job. Generated reports (last_job_id set) keep their own history.
                `CREATE UNIQUE INDEX IF NOT EXISTS ${table}_working_draft_unique ON ${table} (domain, patient_id) WHERE last_job_id IS NULL`,
            ]
        }
    }

    throw new Error(`Unsupported database type for patient report drafts: ${dbType}`)
}

// Working drafts used to be appended on every builder save, so a patient could end up with
// dozens of near-identical rows. Collapse each patient to its newest working draft before the
// unique index is built; generated reports (last_job_id set) are left untouched.
async function pruneDuplicateWorkingDrafts(connection, dbType, table) {
    if (dbType !== 'postgresql') return

    await connection.query(
        `
            DELETE FROM ${table} AS drafts
            WHERE drafts.last_job_id IS NULL
              AND drafts.id <> (
                  SELECT keep.id
                  FROM ${table} AS keep
                  WHERE keep.last_job_id IS NULL
                    AND keep.domain = drafts.domain
                    AND keep.patient_id IS NOT DISTINCT FROM drafts.patient_id
                  ORDER BY keep.updated_at DESC, keep.id DESC
                  LIMIT 1
              )
        `
    )
}

async function ensureFormalReportsTable(connection, dbType, table) {
    const schema = getReportTableSchemaStatements(table, dbType)
    await connection.query(schema.create)

    for (const indexStatement of schema.indexes) {
        try {
            await connection.query(indexStatement)
        } catch (error) {
            const message = String(error?.message || '')
            if (!message.includes('already exists') && !message.includes('Duplicate')) {
                throw error
            }
        }
    }
}

async function ensureReportDraftsTable(connection, dbType, table) {
    const schema = getReportDraftTableSchemaStatements(table, dbType)
    await connection.query(schema.create)

    await pruneDuplicateWorkingDrafts(connection, dbType, table)

    for (const indexStatement of schema.indexes) {
        try {
            await connection.query(indexStatement)
        } catch (error) {
            const message = String(error?.message || '')
            if (!message.includes('already exists') && !message.includes('Duplicate')) {
                throw error
            }
        }
    }

    // Try to make patient_id nullable if it's not already
    try {
        if (dbType === 'postgresql') {
            await connection.query(`ALTER TABLE ${table} ALTER COLUMN patient_id DROP NOT NULL`)
        }
    } catch (error) {
        // Ignore errors - column may already be nullable
        const message = String(error?.message || '')
        if (!message.includes('does not exist') && !message.includes('Syntax error')) {
            // Log but don't rethrow
            console.warn('Could not make patient_id nullable:', message)
        }
    }
}

async function upsertLocalReportPostgres(connection, table, report) {
    const result = await connection.query(
        `
            INSERT INTO ${table} (
                domain,
                patient_id,
                patient_name,
                report_markdown,
                source_notes,
                transcript_count,
                source_metadata_json,
                last_job_id,
                status,
                created_at,
                updated_at
            ) VALUES (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7,
                $8,
                'ready',
                NOW(),
                NOW()
            )
            ON CONFLICT (domain, patient_id)
            DO UPDATE SET
                patient_name = EXCLUDED.patient_name,
                report_markdown = EXCLUDED.report_markdown,
                source_notes = EXCLUDED.source_notes,
                transcript_count = EXCLUDED.transcript_count,
                source_metadata_json = EXCLUDED.source_metadata_json,
                last_job_id = EXCLUDED.last_job_id,
                status = 'ready',
                updated_at = NOW()
            RETURNING *,
                      (created_at AT TIME ZONE current_setting('TIMEZONE')) AS created_at_tz,
                      (updated_at AT TIME ZONE current_setting('TIMEZONE')) AS updated_at_tz
        `,
        [
            report.domain,
            report.patientId,
            report.patientName || null,
            report.reportMarkdown,
            report.sourceNotes || null,
            Number.parseInt(String(report.transcriptCount || 0), 10) || 0,
            JSON.stringify(report.sourceMetadata || {}),
            Number.isFinite(Number(report.lastJobId)) ? Number(report.lastJobId) : null,
        ]
    )
    return result.rows?.[0] || null
}

async function upsertWorkingReportDraftPostgres(connection, table, report) {
    const result = await connection.query(
        `
            INSERT INTO ${table} (
                domain,
                patient_id,
                patient_name,
                report_markdown,
                source_notes,
                transcript_count,
                source_metadata_json,
                last_job_id,
                status,
                created_at,
                updated_at
            ) VALUES (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7,
                NULL,
                'ready',
                NOW(),
                NOW()
            )
            ON CONFLICT (domain, patient_id) WHERE last_job_id IS NULL
            DO UPDATE SET
                patient_name = EXCLUDED.patient_name,
                report_markdown = EXCLUDED.report_markdown,
                source_notes = EXCLUDED.source_notes,
                transcript_count = EXCLUDED.transcript_count,
                source_metadata_json = EXCLUDED.source_metadata_json,
                status = 'ready',
                updated_at = NOW()
            RETURNING *,
                      (created_at AT TIME ZONE current_setting('TIMEZONE')) AS created_at_tz,
                      (updated_at AT TIME ZONE current_setting('TIMEZONE')) AS updated_at_tz
        `,
        [
            report.domain,
            report.patientId,
            report.patientName || null,
            report.reportMarkdown,
            report.sourceNotes || null,
            Number.parseInt(String(report.transcriptCount || 0), 10) || 0,
            JSON.stringify(report.sourceMetadata || {}),
        ]
    )

    return result.rows?.[0] || null
}

async function getPatientFormalReportFromLocalDatabase(domain, patientId) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return {
            success: false,
            error: 'Relational database required for local fallback',
            skipped: true
        }
    }

    let connection = null
    try {
        const table = resolveFormalReportsTable()
        connection = await getDatabaseConnection()

        let row = null
        try {
            row = await fetchLocalReportPostgres(connection, table, domain, patientId)
        } catch (error) {
            if (!isMissingTableError(error)) {
                throw error
            }
        }

        return {
            success: true,
            source: 'local-db-fallback',
            domain,
            patientId,
            report: normalizeReportRow(row)
        }
    } catch (error) {
        return {
            success: false,
            error: error?.message || 'Failed local database fallback query'
        }
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        } else if (connection?.close) {
            await connection.close().catch(() => { })
        }
    }
}

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url)
        const scope = await resolveAdminDomainScope(request, searchParams.get('domain'))
        if (scope.error) {
            return NextResponse.json({ success: false, error: scope.error }, { status: scope.status })
        }
        const domain = scope.domain
        const patientId = Number.parseInt(String(searchParams.get('patient_id') || ''), 10)

        if (!Number.isFinite(patientId) || patientId <= 0) {
            return NextResponse.json({ success: false, error: 'patient_id is required' }, { status: 400 })
        }

        const result = await getPatientFormalReport({ domain, patientId })
        if (result?.success) {
            return NextResponse.json({ success: true, ...(result || {}) })
        }

        const fallbackResult = await getPatientFormalReportFromLocalDatabase(domain, patientId)
        if (fallbackResult?.success) {
            return NextResponse.json({
                success: true,
                ...(fallbackResult || {}),
                upstreamUnavailable: true,
                upstreamError: result?.error || null
            })
        }

        return NextResponse.json(
            {
                success: false,
                error: result?.error || 'Failed to load patient report',
                upstream: result?.upstream || null,
                fallbackError: fallbackResult?.error || null
            },
            { status: Number.isFinite(Number(result?.status)) ? Number(result.status) : 502 }
        )
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load patient report' }, { status: 500 })
    }
}

export async function PATCH(request) {
    try {
        const payload = await request.json().catch(() => ({}))
        const scope = await resolveAdminDomainScope(request, payload?.domain)
        if (scope.error) {
            return NextResponse.json({ success: false, error: scope.error }, { status: scope.status })
        }
        const domain = scope.domain
        const patientId = Number.parseInt(String(payload?.patient_id || payload?.patientId || ''), 10)
        const patientName = normalizeText(payload?.patient_name || payload?.patientName, 240).trim() || null
        const reportMarkdown = normalizeText(payload?.report_markdown || payload?.reportMarkdown, 200000)
        const sourceNotes = normalizeText(payload?.source_notes || payload?.sourceNotes, 200000).trim() || null
        const sourceMetadata = buildSourceMetadataForSave(payload)


        if (!Number.isFinite(patientId) || patientId <= 0) {
            return NextResponse.json({ success: false, error: 'patient_id is required' }, { status: 400 })
        }

        const result = await savePatientFormalReport({
            domain,
            patientId,
            patientName,
            reportMarkdown
        })

        if (result?.success) {
            return NextResponse.json({ success: true, ...(result || {}) })
        }

        const dbType = detectDatabaseType()
        if (dbType !== 'postgresql') {
            return NextResponse.json(
                { success: false, error: result?.error || 'Failed to save patient report' },
                { status: Number.isFinite(Number(result?.status)) ? Number(result.status) : 502 }
            )
        }

        let connection = null
        try {
            const table = resolveFormalReportsTable()
            connection = await getDatabaseConnection()
            await ensureFormalReportsTable(connection, dbType, table)

            // Saving the current report only writes patient_reports. It must not spawn a draft:
            // the patient's single working draft belongs to the builder, not the report editor.
            const row = await upsertLocalReportPostgres(connection, table, {
                domain,
                patientId,
                patientName,
                reportMarkdown,
                sourceNotes,
                sourceMetadata,
            })

            return NextResponse.json({
                success: true,
                source: 'local-db-fallback',
                upstreamUnavailable: true,
                upstreamError: result?.error || null,
                domain,
                patientId,
                report: normalizeReportRow(row)
            })
        } finally {
            if (connection?.end) {
                await connection.end().catch(() => { })
            } else if (connection?.close) {
                await connection.close().catch(() => { })
            }
        }
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to save patient report' }, { status: 500 })
    }
}

export async function POST(request) {
    try {
        const payload = await request.json().catch(() => ({}))
        const scope = await resolveAdminDomainScope(request, payload?.domain)
        if (scope.error) {
            return NextResponse.json({ success: false, error: scope.error }, { status: scope.status })
        }
        const domain = scope.domain
        const patientId = Number.parseInt(String(payload?.patient_id || payload?.patientId || ''), 10)
        const patientName = normalizeText(payload?.patient_name || payload?.patientName, 240).trim() || null
        const reportMarkdown = normalizeText(payload?.report_markdown || payload?.reportMarkdown, 200000)
        const sourceNotes = normalizeText(payload?.source_notes || payload?.sourceNotes, 200000).trim() || null
        const sourceMetadata = buildSourceMetadataForSave(payload)


        if (!patientName) {
            return NextResponse.json({ success: false, error: 'patient_name is required' }, { status: 400 })
        }

        // For POST, patientId is optional (can be null/0)
        // This allows creating report drafts without a patient ID initially

        const dbType = detectDatabaseType()
        if (dbType !== 'postgresql') {
            return NextResponse.json(
                { success: false, error: 'Relational database required for report creation' },
                { status: 502 }
            )
        }

        let connection = null
        try {
            const table = resolveFormalReportsTable()
            const draftsTable = resolveReportDraftsTable()
            connection = await getDatabaseConnection()
            await ensureFormalReportsTable(connection, dbType, table)
            await ensureReportDraftsTable(connection, dbType, draftsTable)

            const draftPayload = {
                domain,
                patientId: Number.isFinite(patientId) && patientId > 0 ? patientId : null,
                patientName,
                reportMarkdown,
                sourceNotes,
                sourceMetadata,
            }

            // The builder auto-saves on every step change, so a patient keeps exactly one working
            // draft. Generated reports (last_job_id set) are separate rows and are never touched.
            const draftRow = await upsertWorkingReportDraftPostgres(connection, draftsTable, draftPayload)

            return NextResponse.json({
                success: true,
                source: 'local-db-fallback',
                domain,
                patientId: Number.isFinite(patientId) && patientId > 0 ? patientId : null,
                report: normalizeReportRow(draftRow)
            })
        } finally {
            if (connection?.end) {
                await connection.end().catch(() => { })
            } else if (connection?.close) {
                await connection.close().catch(() => { })
            }
        }
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to create patient report' }, { status: 500 })
    }
}
