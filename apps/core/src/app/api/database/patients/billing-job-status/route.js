import { NextResponse } from 'next/server'
import { getPatientBillingTaskStatus } from '@/lib/serviceClient'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'

const DEFAULT_BILLING_QUEUE_TABLE = 'patient_billing_jobs'

function isSafeSqlIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ''))
}

function resolveBillingQueueTable() {
    const table = String(process.env.BILLING_QUEUE_TABLE || DEFAULT_BILLING_QUEUE_TABLE).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error('BILLING_QUEUE_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
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

async function getPatientBillingStatusFromLocalDatabase(domain, patientId) {
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
        const table = resolveBillingQueueTable()
        connection = await getDatabaseConnection()

        const result = await fetchLocalStatusFromPostgres(connection, table, domain, patientId)

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
        const context = await resolveAdminDomainScope(request, searchParams.get('domain'))
        if (context?.error) {
            return NextResponse.json({ success: false, error: context.error }, { status: context.status })
        }
        const domain = context.domain
        const patientId = Number.parseInt(String(searchParams.get('patient_id') || ''), 10)

        if (!Number.isFinite(patientId) || patientId <= 0) {
            return NextResponse.json({ success: false, error: 'patient_id is required' }, { status: 400 })
        }

        const result = await getPatientBillingTaskStatus({ domain, patientId })
        if (result?.success) {
            return NextResponse.json({ success: true, ...(result || {}) })
        }

        const fallbackResult = await getPatientBillingStatusFromLocalDatabase(domain, patientId)
        if (fallbackResult?.success) {
            return NextResponse.json({
                success: true,
                ...(fallbackResult || {}),
                upstreamUnavailable: true,
                upstreamError: result?.error || null
            })
        }

        return NextResponse.json({ success: false, error: result?.error || 'Failed to load billing job status' }, { status: 500 })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load billing job status' }, { status: 500 })
    }
}