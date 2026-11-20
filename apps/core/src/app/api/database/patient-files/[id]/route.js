import { NextResponse } from 'next/server'
import { getDatabaseConnection } from '@/lib/database'
import { isSuperAdmin, verifyAdminToken } from '@/lib/auth'
import { ensurePatientFilesTable } from '@/lib/patientFilesTable'
import { withPostgresRlsContext } from '@/lib/postgresRlsContext'
import { loadActivityPatientName, recordActivity, resolveActivityActor } from '@/lib/activities'
import { enqueuePatientAnalysisJob, isAnalystAgentEnabled } from '@/lib/patientAnalysisJobs'
import { loadAnalysisEvidenceDocuments } from '@/lib/analysisEvidenceDocuments'
import { FileStorageError, readStoredFile, removeStoredFile } from '@/lib/fileStore'

function parseInteger(value) {
    const parsed = Number.parseInt(String(value || ''), 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function normalizeDomain(value) {
    return String(value || '').trim().toLowerCase()
}

async function resolveRouteParams(params) {
    return params && typeof params.then === 'function' ? await params : (params || {})
}

async function resolveRequestContext(request, requestedDomain) {
    const authHeader = request.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) return { error: 'Missing Authorization header', status: 401 }
    const user = await verifyAdminToken(authHeader.slice('Bearer '.length).trim())
    if (!user) return { error: 'Invalid auth token', status: 401 }
    const superadmin = isSuperAdmin(user)
    const userDomain = normalizeDomain(user?.domain)
    if (!superadmin && userDomain) {
        if (requestedDomain && requestedDomain !== userDomain) return { error: 'Forbidden: domain scope mismatch', status: 403 }
        return { domain: userDomain, role: 'admin' }
    }
    if (!superadmin) return { error: 'Forbidden: admin domain is required', status: 403 }
    if (!requestedDomain) return { error: 'domain is required', status: 400 }
    return { domain: requestedDomain, role: 'superadmin' }
}

/**
 * Download one file.
 *
 * The bytes come from wherever the practice stored them when the file was uploaded,
 * so a practice that moved its files to local storage or a bucket keeps serving the
 * ones written to the database before the move.
 */
export async function GET(request, { params }) {
    const routeParams = await resolveRouteParams(params)
    const id = parseInteger(routeParams.id)
    const { searchParams } = new URL(request.url)
    const context = await resolveRequestContext(request, normalizeDomain(searchParams.get('domain')))
    if (context.error) return NextResponse.json({ success: false, error: context.error }, { status: context.status })
    if (!id) return NextResponse.json({ success: false, error: 'Invalid file id' }, { status: 400 })

    let connection = null
    try {
        await ensurePatientFilesTable()
        connection = await getDatabaseConnection()
        const stored = await readStoredFile({ connection, context, fileId: id })
        if (!stored) return NextResponse.json({ success: false, error: 'File not found' }, { status: 404 })

        const safeFileName = String(stored.row.file_name || 'download').replace(/[\r\n"]/g, '_')
        return new NextResponse(stored.buffer, {
            headers: {
                'Content-Type': String(stored.row.mime_type || 'application/octet-stream'),
                'Content-Disposition': `attachment; filename="${safeFileName}"`,
            },
        })
    } catch (error) {
        const status = error instanceof FileStorageError ? error.status : 500
        return NextResponse.json({ success: false, error: error?.message || 'Failed to download patient file' }, { status })
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
    }
}

/**
 * Move a stored file in or out of the FCA Analyst's evidence scope.
 *
 * Scope is a flag on the file row (see `analysisEvidenceDocuments`). Toggling it changes what the
 * analyst reads, so the change is only real once the analysis is regenerated: this handler queues
 * that run itself rather than leaving a silently stale analysis behind. Queueing is best-effort -
 * the flag is already written, and a queue failure must not report the toggle as failed.
 */
export async function PATCH(request, { params }) {
    const routeParams = await resolveRouteParams(params)
    const id = parseInteger(routeParams.id)
    if (!id) return NextResponse.json({ success: false, error: 'Invalid file id' }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    const { searchParams } = new URL(request.url)
    const context = await resolveRequestContext(request, normalizeDomain(body?.domain || searchParams.get('domain')))
    if (context.error) return NextResponse.json({ success: false, error: context.error }, { status: context.status })
    if (typeof body?.analysis_evidence !== 'boolean') {
        return NextResponse.json({ success: false, error: 'analysis_evidence must be true or false' }, { status: 400 })
    }

    let connection = null
    try {
        await ensurePatientFilesTable()
        connection = await getDatabaseConnection()
        const updated = await withPostgresRlsContext(connection, context, async (scopedConnection) => {
            const result = await scopedConnection.query(
                `UPDATE patient_files
                 SET analysis_evidence = $3
                 WHERE id = $1 AND domain = $2
                 RETURNING id, file_name, patient_id, analysis_evidence`,
                [id, context.domain, body.analysis_evidence]
            )
            return result.rows?.[0] || null
        })
        if (!updated) return NextResponse.json({ success: false, error: 'File not found' }, { status: 404 })

        await recordActivity({
            domain: context.domain,
            action: 'update',
            entityType: 'patient_file',
            entityId: updated.id,
            entityLabel: updated.file_name,
            patientId: updated.patient_id,
            patientName: await loadActivityPatientName(connection, updated.patient_id, context.domain),
            metadata: { analysis_evidence: updated.analysis_evidence === true },
            actor: await resolveActivityActor(request),
        }, { connection })

        let analysisQueued = false
        let queueError = null
        if (body.queue_analysis !== false) {
            try {
                const patientResult = await connection.query(
                    'SELECT id, patient_name, metadata FROM patients WHERE id = $1 AND domain = $2 LIMIT 1',
                    [updated.patient_id, context.domain]
                )
                const patient = patientResult.rows?.[0]
                if (patient && isAnalystAgentEnabled(patient.metadata)) {
                    const queue = await enqueuePatientAnalysisJob({
                        connection,
                        patientId: patient.id,
                        patientName: patient.patient_name,
                        domain: context.domain,
                        metadata: patient.metadata,
                        documents: await loadAnalysisEvidenceDocuments({ domain: context.domain, patientId: patient.id }),
                        eventType: 'analyst_evidence_documents',
                        source: 'one:analysis-evidence-toggle',
                    })
                    analysisQueued = queue?.queued === true || queue?.success === true
                    queueError = analysisQueued ? null : (queue?.error || 'Failed to queue analyst run')
                }
            } catch (error) {
                queueError = error?.message || 'Failed to queue analyst run'
            }
        }

        return NextResponse.json({
            success: true,
            data: {
                id: updated.id,
                fileName: updated.file_name,
                analysisEvidence: updated.analysis_evidence === true,
            },
            analysisQueued,
            queueError,
        })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to update patient file' }, { status: 500 })
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
    }
}

export async function DELETE(request, { params }) {
    const routeParams = await resolveRouteParams(params)
    const id = parseInteger(routeParams.id)
    const { searchParams } = new URL(request.url)
    const context = await resolveRequestContext(request, normalizeDomain(searchParams.get('domain')))
    if (context.error) return NextResponse.json({ success: false, error: context.error }, { status: context.status })
    if (!id) return NextResponse.json({ success: false, error: 'Invalid file id' }, { status: 400 })

    let connection = null
    try {
        await ensurePatientFilesTable()
        connection = await getDatabaseConnection()
        const deletedFile = await removeStoredFile({ connection, context, fileId: id })
        if (!deletedFile) return NextResponse.json({ success: false, error: 'File not found' }, { status: 404 })

        await recordActivity({
            domain: context.domain,
            action: 'delete',
            entityType: 'patient_file',
            entityId: deletedFile.id,
            entityLabel: deletedFile.file_name,
            patientId: deletedFile.patient_id || null,
            patientName: deletedFile.patient_id
                ? await loadActivityPatientName(connection, deletedFile.patient_id, context.domain)
                : '',
            actor: await resolveActivityActor(request),
        }, { connection })

        return NextResponse.json({
            success: true,
            // The row is gone; the stored copy could not be removed. Reported rather
            // than swallowed so an operator can clean the bucket up.
            storageWarning: deletedFile.storageWarning || '',
        })
    } catch (error) {
        const status = error instanceof FileStorageError ? error.status : 500
        return NextResponse.json({ success: false, error: error?.message || 'Failed to delete patient file' }, { status })
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
    }
}