import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { verifyAdminToken } from '@/lib/auth'
import { enqueuePatientScribeJob, isScribeAgentEnabled, resolveScribeQueueTableName } from '@/lib/patientScribeQueue'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'

const DEFAULT_PATIENT_TRANSCRIPT_SUMMARIES_TABLE = 'patient_transcript_summaries'
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100
// Must match FCA_SCRIBE_SUMMARY_STYLE in two/src/lib/jobs/scribeWorker.js.
const FCA_SUMMARY_STYLE = 'fca-functional-capacity'
const DEFAULT_SUMMARY_STYLE = 'topic-bullets-third-person'

// `payload_json` is a TEXT column, and a few historical queue rows hold payloads
// that are not valid JSON (an unescaped backslash carried over from imported
// patient text). Casting with `::jsonb` raises "invalid input syntax for type
// json" for the whole statement, which failed every scribe-summary read for the
// patient, so read the job's own style out of the payload text instead. The
// job-level `scribeConfig` is written after `metadata` (which carries the
// patient's own copy), so the last match is the style that governs the job; a
// job that never declared one falls back to the patient's configured style,
// which is what the worker actually summarises with.
const SCRIBE_JOB_SUMMARY_STYLE_SQL = `COALESCE((
                    SELECT style_match[1]
                    FROM regexp_matches(j.payload_json, '"scribeConfig"\\s*:\\s*\\{[^{}]*?"summaryStyle"\\s*:\\s*"([^"]*)"', 'g')
                        WITH ORDINALITY AS style_matches(style_match, style_order)
                    ORDER BY style_order DESC
                    LIMIT 1
                ), '${DEFAULT_SUMMARY_STYLE}')`

function getPostgresSummarySelect(table) {
    return `
            SELECT
                id,
                domain,
                patient_id,
                transcription_id,
                summary_style,
                status,
                summary_text,
                summary_payload_json,
                last_job_id,
                source_text_length,
                created_at AT TIME ZONE current_setting('TimeZone') AS created_at,
                updated_at AT TIME ZONE current_setting('TimeZone') AS updated_at
            FROM ${table}
        `
}

function normalizeDomain(value) {
    return String(value || '').trim().toLowerCase()
}

function normalizePatientId(value) {
    if (value === null || value === undefined || value === '') return null
    const parsed = Number.parseInt(String(value || ''), 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return null
    return parsed
}

function parseLimit(value) {
    const parsed = Number.parseInt(String(value || ''), 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT
    return Math.min(parsed, MAX_LIMIT)
}

function isSafeSqlIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ''))
}

function resolveSummaryTable() {
    const table = String(process.env.PATIENT_TRANSCRIPT_SUMMARIES_TABLE || DEFAULT_PATIENT_TRANSCRIPT_SUMMARIES_TABLE).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error('PATIENT_TRANSCRIPT_SUMMARIES_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
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

function isMissingTableError(error) {
    const message = String(error?.message || '').toLowerCase()
    return message.includes('does not exist')
        || (message.includes('relation') && message.includes('does not exist'))
}

function normalizeSummaryRow(row) {
    if (!row || typeof row !== 'object') return null
    return {
        id: row.id,
        domain: row.domain,
        patientId: row.patient_id,
        // Only the domain-wide list joins patients, so this is null on the per-patient fetch.
        patientName: row.patient_name || null,
        transcriptionId: row.transcription_id,
        summaryStyle: row.summary_style || parseJsonObject(row.summary_payload_json)?.summaryStyle || 'topic-bullets-third-person',
        status: row.status,
        summaryText: row.summary_text || '',
        summaryPayload: parseJsonObject(row.summary_payload_json),
        lastJobId: row.last_job_id || null,
        sourceTextLength: Number(row.source_text_length || 0),
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
    }
}

async function resolveRequestContext(request) {
    const authHeader = request.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) {
        return { error: 'Missing Authorization header', status: 401 }
    }

    const token = authHeader.replace('Bearer ', '').trim()
    if (!token) {
        return { error: 'Missing auth token', status: 401 }
    }

    const adminUser = await verifyAdminToken(token)
    if (!adminUser) {
        return { error: 'Invalid auth token', status: 401 }
    }

    return {
        user: adminUser,
        domain: normalizeDomain(adminUser?.domain),
    }
}

async function fetchSummariesForPatientPostgres(connection, table, domain, patientId) {
    const result = await connection.query(
        `
            ${getPostgresSummarySelect(table)}
    WHERE domain = $1 AND patient_id = $2
      ORDER BY updated_at DESC, created_at DESC, id DESC
    LIMIT 20
    `,
        [domain, patientId]
    )
    return result.rows || []
}

async function fetchSummariesPostgres(connection, table, domain, limit) {
    // The domain-wide list is the patient-documents index, which has no patient context of
    // its own, so the name is joined here rather than resolved by the caller.
    const result = await connection.query(
        `
            SELECT base.*, pt.patient_name
            FROM (
                ${getPostgresSummarySelect(table)}
                WHERE domain = $1
                ORDER BY updated_at DESC, created_at DESC, id DESC
                LIMIT $2
            ) base
            LEFT JOIN patients pt ON pt.id = base.patient_id AND pt.domain = base.domain
        `,
        [domain, limit]
    )
    return result.rows || []
}

async function deleteSummaryPostgres(connection, table, domain, patientId, summaryStyle) {
    const styleClause = summaryStyle ? ' AND summary_style = $3' : ''
    const params = summaryStyle ? [domain, patientId, summaryStyle] : [domain, patientId]
    const result = await connection.query(
        `
            DELETE FROM ${table}
            WHERE domain = $1 AND patient_id = $2${styleClause}
            RETURNING id
        `,
        params
    )
    return Number(result.rowCount || 0)
}

async function enqueueDeletedSummaryBackfillPostgres(connection, domain, patientId) {
    const result = await connection.query(
        `
            SELECT p.patient_name, p.metadata, t.id AS transcription_id
            FROM patients p
            JOIN patient_transcriptions t
              ON t.domain = p.domain
             AND t.patient_id = p.id
            WHERE p.domain = $1
              AND p.id = $2
              AND LOWER(COALESCE(t.status, '')) = 'completed'
              AND COALESCE(t.transcript_text, '') <> ''
            ORDER BY COALESCE(t.updated_at, t.created_at) DESC
            LIMIT 20
        `,
        [domain, patientId]
    )

    return result.rows || []
}

async function enqueueDeletedSummaryBackfill({ connection, dbType, domain, patientId, summaryStyle }) {
    if (!summaryStyle) return 0

    const rows = await enqueueDeletedSummaryBackfillPostgres(connection, domain, patientId)

    let queuedCount = 0
    for (const row of rows) {
        const result = await enqueuePatientScribeJob({
            connection,
            dbType,
            domain,
            patientId,
            patientName: row?.patient_name || null,
            metadata: row?.metadata || null,
            transcriptionId: row?.transcription_id,
            eventType: 'summary_deleted_backfill',
            source: 'one:summary-delete-backfill',
            scribeConfig: { summaryStyle },
        })
        if (result?.success || result?.queued === true) queuedCount += 1
    }

    return queuedCount
}

async function fetchPatientScribeContextPostgres(connection, domain, patientId) {
    const result = await connection.query(
        'SELECT patient_name, metadata FROM patients WHERE domain = $1 AND id = $2 LIMIT 1',
        [domain, patientId]
    )
    const row = result.rows?.[0] || null
    return {
        patientName: String(row?.patient_name || '').trim(),
        metadata: parseJsonObject(row?.metadata) || {},
    }
}

// Transcripts that still need an FCA-style summary. A transcript with an in-flight job for the
// same style is skipped so repeated "prepare summaries" clicks cannot queue duplicate work.
async function fetchTranscriptsMissingFcaSummaryPostgres(connection, domain, patientId) {
    const queueTable = resolveScribeQueueTableName()
    const result = await connection.query(
        `
            SELECT p.patient_name, p.metadata, t.id AS transcription_id
            FROM patients p
            JOIN patient_transcriptions t
              ON t.domain = p.domain
             AND t.patient_id = p.id
            LEFT JOIN ${resolveSummaryTable()} s
              ON s.domain = p.domain
             AND s.transcription_id = t.id
             AND s.summary_style = $3
            WHERE p.domain = $1
              AND p.id = $2
              AND LOWER(COALESCE(t.status, '')) = 'completed'
              AND COALESCE(t.transcript_text, '') <> ''
              AND s.id IS NULL
              AND NOT EXISTS (
                    SELECT 1
                    FROM ${queueTable} j
                    WHERE j.domain = p.domain
                      AND j.transcription_id = t.id
                      AND j.status IN ('queued', 'processing')
                      AND ${SCRIBE_JOB_SUMMARY_STYLE_SQL} = $3
              )
            ORDER BY COALESCE(t.updated_at, t.created_at) DESC
            LIMIT 20
        `,
        [domain, patientId, FCA_SUMMARY_STYLE]
    )
    return result.rows || []
}

async function enqueueFcaSummaryJobs({ connection, dbType, domain, patientId, patientName }) {
    const rows = await fetchTranscriptsMissingFcaSummaryPostgres(connection, domain, patientId)

    let queuedCount = 0
    for (const row of rows) {
        const result = await enqueuePatientScribeJob({
            connection,
            dbType,
            domain,
            patientId,
            patientName: patientName || row?.patient_name || null,
            metadata: row?.metadata || null,
            transcriptionId: row?.transcription_id,
            eventType: 'fca_summary_prereq',
            source: 'one:fca-summary-prepare',
            scribeConfig: { summaryStyle: FCA_SUMMARY_STYLE },
        })
        if (result?.success || result?.queued === true) queuedCount += 1
    }

    return queuedCount
}

// One row per transcript that can contribute to an FCA report, with its FCA summary state and the
// state of the most recent summary job. The builder renders this and polls it while preparing
// summaries, so the clinician sees real progress instead of a silently deferred report.
async function fetchFcaSummaryReadinessPostgres(connection, table, domain, patientId) {
    const queueTable = resolveScribeQueueTableName()
    const result = await connection.query(
        `
            SELECT
                t.id AS transcription_id,
                t.title AS transcription_title,
                t.audio_seconds,
                COALESCE(t.updated_at, t.created_at) AS transcript_updated_at,
                (s.id IS NOT NULL) AS has_summary,
                q.status AS queue_status,
                q.error_message AS queue_error,
                q.attempts AS queue_attempts
            FROM patient_transcriptions t
            LEFT JOIN ${table} s
              ON s.domain = t.domain
             AND s.transcription_id = t.id
             AND s.summary_style = $3
            LEFT JOIN LATERAL (
                SELECT status, error_message, attempts
                FROM ${queueTable} j
                WHERE j.domain = t.domain
                  AND j.transcription_id = t.id
                  AND ${SCRIBE_JOB_SUMMARY_STYLE_SQL} = $3
                ORDER BY j.id DESC
                LIMIT 1
            ) q ON true
            WHERE t.domain = $1
              AND t.patient_id = $2
              AND LOWER(COALESCE(t.status, '')) = 'completed'
              AND COALESCE(t.transcript_text, '') <> ''
            ORDER BY COALESCE(t.updated_at, t.created_at) DESC
            LIMIT 20
        `,
        [domain, patientId, FCA_SUMMARY_STYLE]
    )

    const transcripts = (result.rows || []).map((row) => ({
        transcriptionId: Number(row.transcription_id),
        title: row.transcription_title || null,
        audioSeconds: Number(row.audio_seconds || 0) || 0,
        transcriptUpdatedAt: row.transcript_updated_at || null,
        hasSummary: row.has_summary === true,
        queueStatus: row.queue_status || null,
        queueError: row.queue_error || null,
        queueAttempts: Number(row.queue_attempts || 0) || 0,
    }))

    return {
        style: FCA_SUMMARY_STYLE,
        transcripts,
        readyCount: transcripts.filter((item) => item.hasSummary).length,
        pendingCount: transcripts.filter((item) => !item.hasSummary).length,
    }
}

export async function GET(request) {
    let connection = null
    try {
        const { searchParams } = new URL(request.url)
        const scope = await resolveAdminDomainScope(request, searchParams.get('domain'))
        if (scope.error) {
            return NextResponse.json({ error: scope.error }, { status: scope.status })
        }
        const domain = scope.domain
        const patientId = normalizePatientId(searchParams.get('patient_id'))
        const limit = parseLimit(searchParams.get('limit'))

        const dbType = detectDatabaseType()
        if (dbType !== 'postgresql') {
            return NextResponse.json({ error: 'Patient transcript summaries require postgresql' }, { status: 503 })
        }

        const table = resolveSummaryTable()
        connection = await getDomainBoundConnection(domain)

        if (!patientId) {
            const rows = await fetchSummariesPostgres(connection, table, domain, limit)

            return NextResponse.json({
                success: true,
                domain,
                data: rows.map(normalizeSummaryRow),
            })
        }

        const rows = await fetchSummariesForPatientPostgres(connection, table, domain, patientId)
        const summaries = rows.map(normalizeSummaryRow).filter(Boolean)
        const summary = summaries.find((item) => item.summaryStyle === 'topic-bullets-third-person') || summaries[0] || null

        // A missing transcriptions table means this domain has no transcripts yet, which is a
        // valid empty state rather than an error.
        const fca = await fetchFcaSummaryReadinessPostgres(connection, table, domain, patientId)
            .catch((error) => {
                if (isMissingTableError(error)) return null
                throw error
            })

        return NextResponse.json({
            success: true,
            domain,
            patientId,
            summary,
            summaries,
            fca,
        })
    } catch (error) {
        if (isMissingTableError(error)) {
            return NextResponse.json({ success: true, summary: null, data: [] })
        }

        return NextResponse.json({ error: error?.message || 'Failed to load patient transcript summary' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        } else if (connection?.close) {
            await connection.close().catch(() => { })
        }
    }
}

// Queue FCA-style summaries for every eligible transcript that lacks one. The FCA builder calls
// this when its transcript step opens so the clinician watches the summaries being prepared,
// rather than queueing a report that the worker then defers.
export async function POST(request) {
    let connection = null
    try {
        const payload = await request.json().catch(() => ({}))
        const context = await resolveRequestContext(request)
        if (context?.error) {
            return NextResponse.json({ error: context.error }, { status: context.status || 401 })
        }

        const requestedDomain = normalizeDomain(payload?.domain)
        const patientId = normalizePatientId(payload?.patient_id)
        const domain = context?.user?.role === 'superadmin'
            ? requestedDomain
            : context.domain

        if (!domain) {
            return NextResponse.json({ error: 'domain is required' }, { status: 400 })
        }

        if (!patientId) {
            return NextResponse.json({ error: 'patient_id is required' }, { status: 400 })
        }

        if (context?.user?.role !== 'superadmin' && requestedDomain && requestedDomain !== domain) {
            return NextResponse.json({ error: 'Forbidden: domain scope mismatch' }, { status: 403 })
        }

        const dbType = detectDatabaseType()
        if (dbType !== 'postgresql') {
            return NextResponse.json({ error: 'Patient transcript summaries require postgresql' }, { status: 503 })
        }

        const table = resolveSummaryTable()
        connection = await getDomainBoundConnection(domain)

        const patientContext = await fetchPatientScribeContextPostgres(connection, domain, patientId)
        const scribeEnabled = isScribeAgentEnabled(patientContext.metadata)

        // With the scribe agent off the worker skips every job, so report that instead of queueing
        // work that will never run.
        const queuedCount = scribeEnabled
            ? await enqueueFcaSummaryJobs({
                connection,
                dbType,
                domain,
                patientId,
                patientName: patientContext.patientName,
            })
            : 0

        const fca = await fetchFcaSummaryReadinessPostgres(connection, table, domain, patientId)

        return NextResponse.json({
            success: true,
            domain,
            patientId,
            scribeEnabled,
            queuedCount,
            fca,
        })
    } catch (error) {
        return NextResponse.json({ error: error?.message || 'Failed to prepare FCA transcript summaries' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        } else if (connection?.close) {
            await connection.close().catch(() => { })
        }
    }
}

export async function DELETE(request) {
    let connection = null
    try {
        const context = await resolveRequestContext(request)
        if (context?.error) {
            return NextResponse.json({ error: context.error }, { status: context.status || 401 })
        }

        const { searchParams } = new URL(request.url)
        const requestedDomain = normalizeDomain(searchParams.get('domain'))
        const patientId = normalizePatientId(searchParams.get('patient_id'))
        const summaryStyle = String(searchParams.get('summary_style') || '').trim()
        const domain = context?.user?.role === 'superadmin'
            ? requestedDomain
            : context.domain

        if (!domain) {
            return NextResponse.json({ error: 'domain is required' }, { status: 400 })
        }

        if (!patientId) {
            return NextResponse.json({ error: 'patient_id is required' }, { status: 400 })
        }

        if (context?.user?.role !== 'superadmin' && requestedDomain && requestedDomain !== domain) {
            return NextResponse.json({ error: 'Forbidden: domain scope mismatch' }, { status: 403 })
        }

        const dbType = detectDatabaseType()
        if (dbType !== 'postgresql') {
            return NextResponse.json({ error: 'Patient transcript summaries require postgresql' }, { status: 503 })
        }

        const table = resolveSummaryTable()
        connection = await getDomainBoundConnection(domain)

        const deletedCount = await deleteSummaryPostgres(connection, table, domain, patientId, summaryStyle)

        if (deletedCount < 1) {
            return NextResponse.json({ error: 'Patient transcript summary not found' }, { status: 404 })
        }

        const queuedCount = await enqueueDeletedSummaryBackfill({
            connection,
            dbType,
            domain,
            patientId,
            summaryStyle,
        })

        return NextResponse.json({
            success: true,
            domain,
            patientId,
            deletedCount,
            queuedCount,
        })
    } catch (error) {
        if (isMissingTableError(error)) {
            return NextResponse.json({ error: 'Patient transcript summary not found' }, { status: 404 })
        }

        return NextResponse.json({ error: error?.message || 'Failed to delete patient transcript summary' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        } else if (connection?.close) {
            await connection.close().catch(() => { })
        }
    }
}
