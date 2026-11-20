import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { verifyAdminToken } from '@/lib/auth'
import { enqueuePatientAnalysisJob } from '@/lib/patientAnalysisJobs'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'

const DEFAULT_PATIENT_ANALYSIS_TABLE = 'patient_analysis'
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

function getPostgresAnalysisSelect(table) {
    return `
            SELECT
                id,
                domain,
                patient_id,
                patient_name,
                status,
                summary_text,
                analysis_payload_json,
                last_job_id,
                source_notes_length,
                transcript_count,
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

function resolvePatientAnalysisTable() {
    const table = String(process.env.PATIENT_ANALYSIS_TABLE || DEFAULT_PATIENT_ANALYSIS_TABLE).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error('PATIENT_ANALYSIS_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
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

function normalizeAnalysisRow(row) {
    if (!row || typeof row !== 'object') return null
    return {
        id: row.id,
        domain: row.domain,
        patientId: row.patient_id,
        patientName: row.patient_name,
        status: row.status,
        summaryText: row.summary_text || '',
        analysisPayload: parseJsonObject(row.analysis_payload_json),
        lastJobId: row.last_job_id || null,
        sourceNotesLength: Number(row.source_notes_length || 0),
        transcriptCount: Number(row.transcript_count || 0),
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

async function fetchAnalysisPostgres(connection, table, domain, patientId) {
    const result = await connection.query(
        `
            ${getPostgresAnalysisSelect(table)}
      WHERE domain = $1 AND patient_id = $2
      LIMIT 1
    `,
        [domain, patientId]
    )
    return result.rows?.[0] || null
}

async function fetchAnalysesPostgres(connection, table, domain, limit) {
    const result = await connection.query(
        `
            ${getPostgresAnalysisSelect(table)}
      WHERE domain = $1
      ORDER BY updated_at DESC, created_at DESC, id DESC
      LIMIT $2
    `,
        [domain, limit]
    )
    return result.rows || []
}

async function deleteAnalysisPostgres(connection, table, domain, patientId) {
    const result = await connection.query(
        `
            DELETE FROM ${table}
            WHERE domain = $1 AND patient_id = $2
            RETURNING id
        `,
        [domain, patientId]
    )
    return Number(result.rowCount || 0)
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
            return NextResponse.json({ error: 'Patient analysis requires postgresql' }, { status: 503 })
        }

        const table = resolvePatientAnalysisTable()
        connection = await getDomainBoundConnection(domain)

        if (!patientId) {
            const rows = await fetchAnalysesPostgres(connection, table, domain, limit)

            return NextResponse.json({
                success: true,
                domain,
                data: rows.map(normalizeAnalysisRow),
            })
        }

        const row = await fetchAnalysisPostgres(connection, table, domain, patientId)

        return NextResponse.json({
            success: true,
            domain,
            patientId,
            analysis: normalizeAnalysisRow(row),
        })
    } catch (error) {
        if (isMissingTableError(error)) {
            return NextResponse.json({ success: true, analysis: null, data: [] })
        }

        return NextResponse.json({ error: error?.message || 'Failed to load patient analysis' }, { status: 500 })
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
            return NextResponse.json({ error: 'Patient analysis requires postgresql' }, { status: 503 })
        }

        const table = resolvePatientAnalysisTable()
        connection = await getDomainBoundConnection(domain)

        const deletedCount = await deleteAnalysisPostgres(connection, table, domain, patientId)

        if (deletedCount < 1) {
            return NextResponse.json({ error: 'Patient analysis not found' }, { status: 404 })
        }

        return NextResponse.json({
            success: true,
            domain,
            patientId,
            deletedCount,
        })
    } catch (error) {
        if (isMissingTableError(error)) {
            return NextResponse.json({ error: 'Patient analysis not found' }, { status: 404 })
        }

        return NextResponse.json({ error: error?.message || 'Failed to delete patient analysis' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        } else if (connection?.close) {
            await connection.close().catch(() => { })
        }
    }
}

/**
 * Re-run the analyst for one patient.
 *
 * This is the Analysis tab's "Re-run analysis" action. Before it existed the only way to regenerate
 * an analysis was to delete it and wait for the backfill to notice the gap - and the worker's own
 * backfill could not supply the domain's AI selection, so the run silently used a default model
 * rather than the provider and tier the operator had chosen.
 */
export async function POST(request) {
    let connection = null
    try {
        const context = await resolveRequestContext(request)
        if (context?.error) {
            return NextResponse.json({ error: context.error }, { status: context.status || 401 })
        }

        const payload = await request.json().catch(() => ({}))
        const { searchParams } = new URL(request.url)
        const requestedDomain = normalizeDomain(payload?.domain || searchParams.get('domain'))
        const patientId = normalizePatientId(payload?.patient_id ?? searchParams.get('patient_id'))
        const domain = context?.user?.role === 'superadmin' ? requestedDomain : context.domain

        if (!domain) {
            return NextResponse.json({ error: 'domain is required' }, { status: 400 })
        }
        if (!patientId) {
            return NextResponse.json({ error: 'patient_id is required' }, { status: 400 })
        }
        if (context?.user?.role !== 'superadmin' && requestedDomain && requestedDomain !== domain) {
            return NextResponse.json({ error: 'Forbidden: domain scope mismatch' }, { status: 403 })
        }

        if (detectDatabaseType() !== 'postgresql') {
            return NextResponse.json({ error: 'Patient analysis requires postgresql' }, { status: 503 })
        }

        connection = await getDomainBoundConnection(domain)

        const patientResult = await connection.query(
            'SELECT id, patient_name, metadata FROM patients WHERE id = $1 AND domain = $2 LIMIT 1',
            [patientId, domain]
        )
        const patient = patientResult.rows?.[0]
        if (!patient) {
            return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
        }

        const queue = await enqueuePatientAnalysisJob({
            connection,
            patientId: patient.id,
            patientName: patient.patient_name,
            domain,
            metadata: patient.metadata,
            eventType: 'analyst_rerun',
            source: 'one:analysis-rerun'
        })

        return NextResponse.json({ success: true, domain, patientId, queue })
    } catch (error) {
        return NextResponse.json({ error: error?.message || 'Failed to queue patient analysis' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        } else if (connection?.close) {
            await connection.close().catch(() => { })
        }
    }
}