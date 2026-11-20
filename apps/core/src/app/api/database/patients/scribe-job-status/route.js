import { NextResponse } from 'next/server'
import { getPatientScribeTaskStatus } from '@/lib/serviceClient'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'

const DEFAULT_SCRIBE_QUEUE_TABLE = 'patient_transcript_scribe_jobs'
const DEFAULT_SCRIBE_SUMMARIES_TABLE = 'patient_transcript_summaries'

function isSafeSqlIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ''))
}

function resolveScribeQueueTable() {
    const table = String(process.env.SCRIBE_QUEUE_TABLE || DEFAULT_SCRIBE_QUEUE_TABLE).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error('SCRIBE_QUEUE_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
    }
    return table
}

function resolveScribeSummariesTable() {
    const table = String(process.env.PATIENT_TRANSCRIPT_SUMMARIES_TABLE || DEFAULT_SCRIBE_SUMMARIES_TABLE).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error('PATIENT_TRANSCRIPT_SUMMARIES_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
    }
    return table
}

function normalizeDomain(value) {
    return String(value || '').trim().toLowerCase()
}

function normalizePatientId(value) {
    const parsed = Number.parseInt(String(value || ''), 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return null
    return parsed
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

function mapStatusLabel(status) {
    const normalized = String(status || '').trim().toLowerCase()
    if (normalized === 'processing') return 'Working'
    if (normalized === 'completed') return 'Ready'
    if (normalized === 'failed') return 'Failed'
    return 'Waiting'
}

function normalizeJobRow(row) {
    if (!row || typeof row !== 'object') return null

    const status = String(row.status || 'queued').trim().toLowerCase() || 'queued'
    return {
        id: row.id,
        domain: row.domain,
        patientId: row.patient_id,
        patientName: row.patient_name,
        transcriptionId: row.transcription_id || null,
        eventType: row.event_type,
        requestedAction: row.requested_action,
        status,
        statusLabel: mapStatusLabel(status),
        attempts: Number(row.attempts || 0),
        maxAttempts: row.max_attempts === null || row.max_attempts === undefined
            ? null
            : Number(row.max_attempts),
        nextAttemptAt: row.next_attempt_at || null,
        claimedAt: row.claimed_at || null,
        completedAt: row.completed_at || null,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
        errorMessage: row.error_message || null,
        payload: parseJsonObject(row.payload_json || null)
    }
}

function isMissingTableError(error) {
    const message = String(error?.message || '').toLowerCase()
    return message.includes('does not exist')
        || message.includes('relation') && message.includes('does not exist')
}

async function fetchLocalStatusFromPostgres(connection, table, domain, patientId) {
    const latestResult = await connection.query(
        `
      SELECT *
      FROM ${table}
      WHERE domain = $1 AND patient_id = $2
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `,
        [domain, patientId]
    )

    const countsResult = await connection.query(
        `
      SELECT status, COUNT(*)::int AS count
      FROM ${table}
      WHERE domain = $1 AND patient_id = $2
      GROUP BY status
    `,
        [domain, patientId]
    )

    return {
        latest: latestResult.rows?.[0] || null,
        counts: countsResult.rows || []
    }
}

async function fetchLocalSummaryFromPostgres(connection, table, domain, patientId) {
    const result = await connection.query(
        `
      SELECT id, transcription_id, updated_at, created_at
      FROM ${table}
      WHERE domain = $1 AND patient_id = $2
      ORDER BY updated_at DESC, created_at DESC, id DESC
      LIMIT 1
    `,
        [domain, patientId]
    )

    return result.rows?.[0] || null
}

async function getPatientScribeStatusFromLocalDatabase(domain, patientId) {
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
        const queueTable = resolveScribeQueueTable()
        const summariesTable = resolveScribeSummariesTable()
        connection = await getDatabaseConnection()

        let summary = null
        try {
            summary = await fetchLocalSummaryFromPostgres(connection, summariesTable, domain, patientId)
        } catch (error) {
            if (!isMissingTableError(error)) {
                throw error
            }
        }

        if (summary) {
            return {
                success: true,
                source: 'local-db-fallback',
                domain,
                patientId,
                latest: null,
                counts: {},
                status: 'completed',
                statusLabel: 'Ready',
                summaryExists: true,
                transcriptionId: summary.transcription_id || null,
                summaryUpdatedAt: summary.updated_at || summary.created_at || null
            }
        }

        const result = await fetchLocalStatusFromPostgres(connection, queueTable, domain, patientId)

        const latest = normalizeJobRow(result.latest)
        const counts = (result.counts || []).reduce((acc, row) => {
            const key = String(row.status || '').trim().toLowerCase() || 'unknown'
            acc[key] = Number(row.count || 0)
            return acc
        }, {})

        return {
            success: true,
            source: 'local-db-fallback',
            domain,
            patientId,
            latest,
            counts,
            status: latest?.status || 'none',
            statusLabel: latest?.statusLabel || 'Waiting'
        }
    } catch (error) {
        if (isMissingTableError(error)) {
            return {
                success: true,
                source: 'local-db-fallback',
                domain,
                patientId,
                latest: null,
                counts: {},
                status: 'none',
                statusLabel: 'Waiting'
            }
        }

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
            return NextResponse.json({ error: scope.error }, { status: scope.status })
        }
        const domain = scope.domain
        const patientId = normalizePatientId(searchParams.get('patient_id'))
        if (!patientId) {
            return NextResponse.json({ error: 'patient_id is required' }, { status: 400 })
        }

        const status = await getPatientScribeTaskStatus({ domain, patientId })
        if (status?.success) {
            return NextResponse.json({
                success: true,
                domain,
                patientId,
                ...status
            })
        }

        const fallbackStatus = await getPatientScribeStatusFromLocalDatabase(domain, patientId)
        if (fallbackStatus?.success) {
            return NextResponse.json({
                success: true,
                ...(fallbackStatus || {}),
                upstreamUnavailable: true,
                upstreamError: status?.error || null
            })
        }

        return NextResponse.json({ success: false, error: status?.error || 'Failed to load scribe job status' }, { status: 500 })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load scribe job status' }, { status: 500 })
    }
}
