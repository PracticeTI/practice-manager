import { NextResponse } from 'next/server'
import { verifyAdminAuth } from '@/lib/auth'
import { getPatientReportTaskStatus } from '@/lib/serviceClient'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import {
    ensureReportReviewColumns,
    loadLatestReportJob,
    markReportJobReviewed,
} from '@/lib/patientReportReview'
import { isUnreviewedReportJob } from '@/lib/workerProvenance'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'

const DEFAULT_REPORT_QUEUE_TABLE = 'patient_report_jobs'

function isSafeSqlIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ''))
}

function resolveReportQueueTable() {
    const table = String(process.env.REPORT_QUEUE_TABLE || DEFAULT_REPORT_QUEUE_TABLE).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error('REPORT_QUEUE_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
    }
    return table
}

function resolveFormalReportsTable() {
    const table = String(process.env.PATIENT_REPORTS_TABLE || 'patient_reports').trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error('PATIENT_REPORTS_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
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

function mapStatusLabel(status, row) {
    const normalized = String(status || '').trim().toLowerCase()
    const eventType = String(row?.event_type || row?.eventType || '').trim().toLowerCase()
    const isUpdateAction = eventType === 'reporting_config_changed'

    if (normalized === 'queued') {
        return isUpdateAction ? 'Update Pending' : 'Creating'
    }
    if (normalized === 'processing') {
        return isUpdateAction ? 'Updating' : 'Creating'
    }
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
        eventType: row.event_type,
        requestedAction: row.requested_action,
        status,
        statusLabel: mapStatusLabel(status, row),
        attempts: Number(row.attempts || 0),
        maxAttempts: row.max_attempts === null || row.max_attempts === undefined
            ? null
            : Number(row.max_attempts),
        nextAttemptAt: row.next_attempt_at || null,
        claimedAt: row.claimed_at || null,
        completedAt: row.completed_at || null,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
        reviewedAt: row.reviewed_at || null,
        reviewedBy: row.reviewed_by || null,
        errorMessage: row.error_message || null,
        payload: parseJsonObject(row.payload_json || null)
    }
}

function isMissingTableError(error) {
    const message = String(error?.message || '').toLowerCase()
    return message.includes('does not exist')
        || message.includes('relation') && message.includes('does not exist')
}

async function fetchLocalFormalReportFromPostgres(connection, table, domain, patientId) {
    const result = await connection.query(
        `
      SELECT id, domain, patient_id, patient_name, report_markdown, source_notes, status, created_at, updated_at
      FROM ${table}
      WHERE domain = $1 AND patient_id = $2
      ORDER BY updated_at DESC, created_at DESC, id DESC
      LIMIT 1
    `,
        [domain, patientId]
    )

    return result.rows?.[0] || null
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

async function getPatientReportStatusFromLocalDatabase(domain, patientId) {
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
        const queueTable = resolveReportQueueTable()
        const formalReportsTable = resolveFormalReportsTable()
        connection = await getDatabaseConnection()

        const result = await fetchLocalStatusFromPostgres(connection, queueTable, domain, patientId)

        const latest = normalizeJobRow(result.latest)
        const counts = (result.counts || []).reduce((acc, row) => {
            const key = String(row.status || '').trim().toLowerCase() || 'unknown'
            acc[key] = Number(row.count || 0)
            return acc
        }, {})

        // The queue's own latest job status is the source of truth. Only fall back to
        // "does any formal report exist" when there is no job history at all (e.g. a
        // report created out-of-band), otherwise a stale prior report would mask a
        // currently queued/deferred/failed job for this patient.
        if (!latest) {
            let formalReport = null
            try {
                formalReport = await fetchLocalFormalReportFromPostgres(connection, formalReportsTable, domain, patientId)
            } catch (error) {
                if (!isMissingTableError(error)) {
                    throw error
                }
            }

            if (formalReport && String(formalReport.report_markdown || '').trim()) {
                return {
                    success: true,
                    source: 'local-db-fallback',
                    domain,
                    patientId,
                    latest: null,
                    counts: {},
                    status: 'completed',
                    statusLabel: 'Ready',
                    reportExists: true,
                    reportUpdatedAt: formalReport.updated_at || formalReport.created_at || null
                }
            }
        }

        return {
            success: true,
            source: 'local-db-fallback',
            domain,
            patientId,
            latest,
            counts,
            status: latest?.status || 'none',
            statusLabel: latest?.statusLabel || 'Creating'
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
                statusLabel: 'Creating'
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

/**
 * The published report nobody has opened, or null.
 *
 * This is only ever asked for the patient on screen, so it is read alongside the job
 * status rather than in a request of its own. Nothing here may fail the status read:
 * a missing table or column simply means no report is waiting.
 */
async function readUnreviewedReportJob(domain, patientId) {
    if (detectDatabaseType() !== 'postgresql') return null

    let connection = null
    try {
        const table = resolveReportQueueTable()
        connection = await getDatabaseConnection()

        // A queue table created before the review columns existed still answers the
        // read: the absent column reads as "nobody has opened this report yet".
        await ensureReportReviewColumns(connection, table).catch(() => { })

        const latest = await loadLatestReportJob(connection, { domain, patientId, table })
        return isUnreviewedReportJob(latest) ? latest : null
    } catch {
        return null
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

        const result = await getPatientReportTaskStatus({ domain, patientId })
        if (result?.success) {
            return NextResponse.json({
                success: true,
                ...(result || {}),
                unreviewedReportJob: await readUnreviewedReportJob(domain, patientId),
            })
        }

        const fallbackResult = await getPatientReportStatusFromLocalDatabase(domain, patientId)
        if (fallbackResult?.success) {
            return NextResponse.json({
                success: true,
                ...(fallbackResult || {}),
                unreviewedReportJob: await readUnreviewedReportJob(domain, patientId),
                upstreamUnavailable: true,
                upstreamError: result?.error || null
            })
        }

        return NextResponse.json(
            {
                success: false,
                error: result?.error || 'Failed to load report status',
                upstream: result?.upstream || null,
                fallbackError: fallbackResult?.error || null
            },
            { status: Number.isFinite(Number(result?.status)) ? Number(result.status) : 502 }
        )
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load report status' }, { status: 500 })
    }
}

/**
 * Record that a person has opened the patient's report, which is what takes the job
 * off the review queue (see `patientReportReview.js`). The body may name the job, or
 * leave `job_id` out to let the patient's newest completed job stand in.
 */
export async function POST(request) {
    const adminUser = await verifyAdminAuth(request)
    if (!adminUser) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const body = await request.json().catch(() => ({}))
        const scope = await resolveAdminDomainScope(request, body?.domain)
        if (scope.error) {
            return NextResponse.json({ success: false, error: scope.error }, { status: scope.status })
        }
        const domain = scope.domain
        const patientId = Number.parseInt(String(body?.patient_id ?? ''), 10)
        const jobId = Number.parseInt(String(body?.job_id ?? ''), 10)

        if (!Number.isFinite(patientId) || patientId <= 0) {
            return NextResponse.json({ success: false, error: 'patient_id is required' }, { status: 400 })
        }

        if (detectDatabaseType() !== 'postgresql') {
            return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 503 })
        }

        let connection = null
        try {
            const table = resolveReportQueueTable()
            connection = await getDatabaseConnection()

            // The marker only exists once this has run, so a review written before
            // any read has to create it first.
            await ensureReportReviewColumns(connection, table)

            const reviewed = await markReportJobReviewed(connection, {
                domain,
                patientId,
                jobId: Number.isFinite(jobId) && jobId > 0 ? jobId : null,
                reviewedBy: String(adminUser?.username || adminUser?.email || '').trim() || null,
                table,
            })

            return NextResponse.json({ success: true, reviewed: Boolean(reviewed), job: reviewed })
        } finally {
            if (connection?.end) {
                await connection.end().catch(() => { })
            } else if (connection?.close) {
                await connection.close().catch(() => { })
            }
        }
    } catch (error) {
        return NextResponse.json(
            { success: false, error: error?.message || 'Failed to mark the report reviewed' },
            { status: 500 }
        )
    }
}
