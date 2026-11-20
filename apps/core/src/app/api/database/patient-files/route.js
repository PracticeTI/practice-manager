import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { isSuperAdmin, verifyAdminToken } from '@/lib/auth'
import { ensurePatientFilesTable } from '@/lib/patientFilesTable'
import { withPostgresRlsContext } from '@/lib/postgresRlsContext'
import { loadActivityPatientName, recordActivity, resolveActivityActor } from '@/lib/activities'
import { FileStorageError, resolvePracticeFileStorage, saveStoredFile } from '@/lib/fileStore'

export const runtime = 'nodejs'

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024
// Multipart framing (boundary + per-part headers) rides along with the file, so the
// whole request body is a little larger than the file itself.
const MAX_REQUEST_BODY_BYTES = MAX_FILE_SIZE_BYTES + 1024 * 1024

// The Files page asks for a page at a time; a patient's own Files tab reads the
// whole list (the table has no paging) and stays inside this ceiling.
const DEFAULT_LIST_LIMIT = 200
const MAX_LIST_LIMIT = 500

// Which files the practice-wide listing returns: everything, only files attached to
// a patient, or only practice-level files that belong to no patient.
const FILE_LIST_SCOPES = ['all', 'patient', 'practice']

function parseInteger(value) {
    const parsed = Number.parseInt(String(value || ''), 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function normalizeDomain(value) {
    return String(value || '').trim().toLowerCase()
}

function normalizeListScope(value, hasPatient) {
    if (hasPatient) return 'patient'
    const normalized = String(value || '').trim().toLowerCase()
    return FILE_LIST_SCOPES.includes(normalized) ? normalized : 'all'
}

function parseListLimit(value) {
    const parsed = parseInteger(value)
    if (!parsed) return DEFAULT_LIST_LIMIT
    return Math.min(parsed, MAX_LIST_LIMIT)
}

async function resolveRequestContext(request, requestedDomain) {
    const authHeader = request.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) {
        return { error: 'Missing Authorization header', status: 401 }
    }

    const user = await verifyAdminToken(authHeader.slice('Bearer '.length).trim())
    if (!user) return { error: 'Invalid auth token', status: 401 }

    const superadmin = isSuperAdmin(user)
    const userDomain = normalizeDomain(user?.domain)
    if (!superadmin && userDomain) {
        if (requestedDomain && requestedDomain !== userDomain) {
            return { error: 'Forbidden: domain scope mismatch', status: 403 }
        }
        return { domain: userDomain, role: 'admin' }
    }

    if (!superadmin) return { error: 'Forbidden: admin domain is required', status: 403 }
    if (!requestedDomain) return { error: 'domain is required', status: 400 }
    return { domain: requestedDomain, role: 'superadmin' }
}

async function patientExists(connection, patientId, domain) {
    const result = await connection.query('SELECT id FROM patients WHERE id = $1 AND domain = $2 LIMIT 1', [patientId, domain])
    return Boolean(result.rows?.[0])
}

/**
 * List stored files.
 *
 * With `patient_id` the answer is that patient's Files tab: every file, newest
 * first. Without it the answer is the practice's Files page, which spans patients
 * and the practice-level files that belong to no patient.
 */
export async function GET(request) {
    const { searchParams } = new URL(request.url)
    const requestedPatientId = String(searchParams.get('patient_id') || '').trim()
    const patientId = requestedPatientId ? parseInteger(requestedPatientId) : null
    const context = await resolveRequestContext(request, normalizeDomain(searchParams.get('domain')))
    if (context.error) return NextResponse.json({ success: false, error: context.error }, { status: context.status })
    if (requestedPatientId && !patientId) {
        return NextResponse.json({ success: false, error: 'Invalid patient_id' }, { status: 400 })
    }

    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    const scope = normalizeListScope(searchParams.get('scope'), Boolean(patientId))
    const search = String(searchParams.get('q') || '').trim()
    const limit = parseListLimit(searchParams.get('limit'))

    let connection = null
    try {
        await ensurePatientFilesTable()
        connection = await getDatabaseConnection()
        const { descriptor } = await resolvePracticeFileStorage(context.domain)

        const rows = await withPostgresRlsContext(connection, context, async (scopedConnection) => {
            const params = [context.domain]
            const conditions = ['f.domain = $1']

            if (patientId) {
                params.push(patientId)
                conditions.push(`f.patient_id = $${params.length}`)
            } else if (scope === 'patient') {
                conditions.push('f.patient_id IS NOT NULL')
            } else if (scope === 'practice') {
                conditions.push('f.patient_id IS NULL')
            }

            if (search) {
                params.push(`%${search}%`)
                conditions.push(`f.file_name ILIKE $${params.length}`)
            }

            params.push(limit)

            // A practice-level file has no patient to name, so the join is what tells
            // the Files page which row belongs to whom without a second round trip.
            const joinPatients = scope !== 'practice'
            const result = await scopedConnection.query(
                `SELECT f.id, f.patient_id,
                        ${joinPatients ? 'p.patient_name' : 'NULL::varchar AS patient_name'},
                        f.file_name, f.mime_type, f.file_size, f.storage_backend,
                        f.analysis_evidence, f.created_at
                 FROM patient_files f
                 ${joinPatients ? 'LEFT JOIN patients p ON p.id = f.patient_id AND p.domain = f.domain' : ''}
                 WHERE ${conditions.join(' AND ')}
                 ORDER BY f.created_at DESC, f.id DESC
                 LIMIT $${params.length}`,
                params
            )
            return result.rows || []
        })

        return NextResponse.json({ success: true, data: rows, storage: descriptor, scope })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load patient files' }, { status: 500 })
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
    }
}

/**
 * Upload one file. `patient_id` is optional: a file uploaded without one belongs to
 * the practice, which is how the Files page stores reference material that arrives
 * before a patient is known (or never belongs to one).
 *
 * The bytes go to the practice's configured backend - see `fileStore`.
 */
export async function POST(request) {
    const contentLength = Number.parseInt(request.headers.get('content-length') || '', 10)
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
        return NextResponse.json({ success: false, error: 'Files must be 25 MB or smaller' }, { status: 413 })
    }

    let formData = null
    try {
        formData = await request.formData()
    } catch {
        // A multipart body that arrives truncated (or malformed) cannot be parsed, so
        // no fields — including the domain — are readable. Report the real cause
        // instead of a misleading "domain is required".
        return NextResponse.json(
            { success: false, error: 'Upload could not be read. Please retry, or upload a smaller file.' },
            { status: 413 }
        )
    }

    const requestedPatientId = String(formData.get('patient_id') || '').trim()
    const patientId = requestedPatientId ? parseInteger(requestedPatientId) : null
    const context = await resolveRequestContext(request, normalizeDomain(formData.get('domain')))
    if (context.error) return NextResponse.json({ success: false, error: context.error }, { status: context.status })
    if (requestedPatientId && !patientId) {
        return NextResponse.json({ success: false, error: 'Invalid patient_id' }, { status: 400 })
    }

    const file = formData.get('file')
    if (!file || typeof file.arrayBuffer !== 'function') {
        return NextResponse.json({ success: false, error: 'file is required' }, { status: 400 })
    }
    if (!file.size) return NextResponse.json({ success: false, error: 'File must not be empty' }, { status: 400 })
    if (file.size > MAX_FILE_SIZE_BYTES) {
        return NextResponse.json({ success: false, error: 'Files must be 25 MB or smaller' }, { status: 400 })
    }

    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    let connection = null
    try {
        const fileName = String(file.name || 'unnamed-file').trim().slice(0, 500) || 'unnamed-file'
        const mimeType = String(file.type || 'application/octet-stream').trim().slice(0, 255) || 'application/octet-stream'
        const buffer = Buffer.from(await file.arrayBuffer())
        await ensurePatientFilesTable()
        connection = await getDatabaseConnection()

        if (patientId) {
            const exists = await withPostgresRlsContext(connection, context, (scopedConnection) =>
                patientExists(scopedConnection, patientId, context.domain)
            )
            if (!exists) return NextResponse.json({ success: false, error: 'Patient not found' }, { status: 404 })
        }

        const { record, storage } = await saveStoredFile({
            connection,
            context,
            patientId,
            fileName,
            mimeType,
            buffer,
        })

        await recordActivity({
            domain: context.domain,
            action: 'create',
            entityType: 'patient_file',
            entityId: record.id,
            entityLabel: record.file_name,
            patientId: patientId || null,
            patientName: patientId ? await loadActivityPatientName(connection, patientId, context.domain) : '',
            metadata: {
                mime_type: record.mime_type,
                file_size: Number(record.file_size),
                storage_backend: storage.backend,
            },
            actor: await resolveActivityActor(request),
        }, { connection })

        return NextResponse.json({ success: true, file: record, storage })
    } catch (error) {
        const status = error instanceof FileStorageError ? error.status : 500
        return NextResponse.json({ success: false, error: error?.message || 'Failed to upload patient file' }, { status })
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
    }
}