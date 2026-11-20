import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { verifyAdminToken } from '@/lib/auth'
import { ensurePatientTranscriptionsTable } from '@/lib/patientTranscriptionsTable'
import { enqueuePatientScribeJob, isScribeAgentEnabled } from '@/lib/patientScribeQueue'
import { activityActorFromAdminUser, loadActivityPatientName, recordActivity } from '@/lib/activities'

const PENDING_DELETE_STATUS = 'pending delete'

// A compact row omits `transcript_text`, which runs to tens of thousands of characters per
// transcript. Callers that only need to list or identify transcripts (the FCA builder's
// transcript step) ask for compact rows.
const TRANSCRIPTION_COLUMNS = [
    'id',
    'domain',
    'patient_id',
    'status',
    'source',
    'title',
    'meeting_external_id',
    'audio_mime_type',
    'audio_seconds',
    'metadata',
    'created_at',
    'updated_at',
]

function isTruthyParam(rawValue) {
    return ['1', 'true', 'yes'].includes(String(rawValue || '').trim().toLowerCase())
}

function parseLimit(rawValue, defaultValue = 100, maxValue = 500) {
    const parsed = Number.parseInt(String(rawValue || ''), 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue
    return Math.min(parsed, maxValue)
}

function parseInteger(rawValue) {
    const parsed = Number.parseInt(String(rawValue || ''), 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function parseMetadataValue(value) {
    if (value === null || value === undefined || value === '') return null
    if (typeof value === 'object') return value
    if (typeof value !== 'string') return null

    try {
        const parsed = JSON.parse(value)
        return parsed && typeof parsed === 'object' ? parsed : null
    } catch {
        return null
    }
}

function normalizeDomain(value) {
    return String(value || '').trim().toLowerCase()
}

function normalizeRow(row) {
    if (!row || typeof row !== 'object') return row
    return {
        ...row,
        patient_id: parseInteger(row.patient_id),
        metadata: parseMetadataValue(row.metadata),
    }
}

function validateMetadata(metadata) {
    if (metadata === null || metadata === undefined) return null
    if (typeof metadata !== 'object' || Array.isArray(metadata)) {
        return 'metadata must be an object or null'
    }
    return null
}

function getRequestedDomain(request, payload = null) {
    if (payload && typeof payload === 'object') {
        const fromBody = normalizeDomain(payload.domain)
        if (fromBody) return fromBody
    }

    const { searchParams } = new URL(request.url)
    return normalizeDomain(searchParams.get('domain'))
}

async function fetchPatientContext(connection, domain, patientId) {
    const result = await connection.query(
        `SELECT id, patient_name, metadata FROM patients WHERE id = $1 AND domain = $2 LIMIT 1`,
        [patientId, domain]
    )
    return result.rows?.[0] || null
}

async function resolveRequestContext(request, payload = null) {
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

    const requestedDomain = getRequestedDomain(request, payload)
    const scopedDomain = normalizeDomain(adminUser?.domain)
    if (adminUser?.role !== 'superadmin' && scopedDomain) {
        if (requestedDomain && requestedDomain !== scopedDomain) {
            return { error: 'Forbidden: domain scope mismatch', status: 403 }
        }
        return { user: adminUser, domain: scopedDomain }
    }

    if (!requestedDomain) {
        return { error: 'domain is required', status: 400 }
    }

    return { user: adminUser, domain: requestedDomain }
}

export async function GET(request) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    let connection = null
    try {
        const context = await resolveRequestContext(request)
        if (context?.error) {
            return NextResponse.json({ success: false, error: context.error }, { status: context.status || 401 })
        }

        const { searchParams } = new URL(request.url)
        const patientId = parseInteger(searchParams.get('patient_id'))
        const focusedPendingDeleteId = parseInteger(searchParams.get('include_pending_delete_id'))
        const limit = parseLimit(searchParams.get('limit'))
        const compact = isTruthyParam(searchParams.get('compact'))

        await ensurePatientTranscriptionsTable()
        connection = await getDomainBoundConnection(context.domain)

        const columns = compact
            ? TRANSCRIPTION_COLUMNS.join(', ')
            : [...TRANSCRIPTION_COLUMNS, 'transcript_text'].join(', ')
        const selectSql = `SELECT ${columns}
                 FROM patient_transcriptions`

        if (patientId) {
            const result = await connection.query(
                `${selectSql}
                     WHERE domain = $1 AND patient_id = $2
                                             AND (status <> $3 OR id = $4)
                     ORDER BY id DESC
                                         LIMIT $5`,
                [context.domain, patientId, PENDING_DELETE_STATUS, focusedPendingDeleteId || 0, limit]
            )
            return NextResponse.json({ success: true, data: (result.rows || []).map(normalizeRow) })
        }

        const result = await connection.query(
            `${selectSql}
                 WHERE domain = $1
                   AND status <> $2
                 ORDER BY id DESC
                 LIMIT $3`,
            [context.domain, PENDING_DELETE_STATUS, limit]
        )
        return NextResponse.json({ success: true, data: (result.rows || []).map(normalizeRow) })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load patient transcriptions' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}

export async function POST(request) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    let connection = null
    try {
        const payload = await request.json().catch(() => ({}))
        const context = await resolveRequestContext(request, payload)
        if (context?.error) {
            return NextResponse.json({ success: false, error: context.error }, { status: context.status || 401 })
        }

        const patientId = parseInteger(payload?.patient_id)
        const status = String(payload?.status || 'recording').trim().toLowerCase() || 'recording'
        const source = String(payload?.source || 'browser-live').trim().toLowerCase() || 'browser-live'
        const title = String(payload?.title || '').trim() || null
        const meetingExternalId = String(payload?.meeting_external_id || '').trim() || null
        const audioMimeType = String(payload?.audio_mime_type || '').trim() || null
        const transcriptText = String(payload?.transcript_text || '').trim() || null
        const metadata = payload?.metadata === undefined ? {} : payload?.metadata

        if (!patientId) {
            return NextResponse.json({ success: false, error: 'patient_id is required' }, { status: 400 })
        }

        const metadataError = validateMetadata(metadata)
        if (metadataError) {
            return NextResponse.json({ success: false, error: metadataError }, { status: 400 })
        }

        await ensurePatientTranscriptionsTable()
        connection = await getDomainBoundConnection(context.domain)

        const serializedMetadata = JSON.stringify(metadata || {})
        let createdRecord = null

        const result = await connection.query(
            `INSERT INTO patient_transcriptions (domain, patient_id, status, source, title, meeting_external_id, audio_mime_type, transcript_text, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
             RETURNING id, domain, patient_id, status, source, title, meeting_external_id, audio_mime_type, audio_seconds, transcript_text, metadata, created_at, updated_at`,
            [context.domain, patientId, status, source, title, meetingExternalId, audioMimeType, transcriptText, serializedMetadata]
        )
        createdRecord = normalizeRow(result.rows?.[0] || null)

        await recordActivity({
            domain: context.domain,
            action: 'create',
            entityType: 'transcription',
            entityId: createdRecord?.id,
            entityLabel: createdRecord?.title || `Transcript ${createdRecord?.id || ''}`.trim(),
            patientId,
            patientName: await loadActivityPatientName(connection, patientId, context.domain),
            actor: activityActorFromAdminUser(context.user),
        }, { connection })

        const normalizedStatus = String(createdRecord?.status || '').trim().toLowerCase()
        const normalizedTranscriptText = String(createdRecord?.transcript_text || '').trim()
        if (normalizedStatus === 'completed' && normalizedTranscriptText) {
            const patientContext = await fetchPatientContext(connection, context.domain, patientId)
            const patientMetadata = parseMetadataValue(patientContext?.metadata) || {}
            if (isScribeAgentEnabled(patientMetadata)) {
                const scribeConfig = patientMetadata?.patientAgents?.scribeConfig
                await enqueuePatientScribeJob({
                    connection,
                    dbType,
                    patientId,
                    patientName: String(patientContext?.patient_name || '').trim(),
                    domain: context.domain,
                    metadata: patientMetadata,
                    eventType: 'transcript_completed',
                    requestedAction: 'summarize_transcript',
                    source: 'one:patient-transcriptions-post',
                    transcriptionId: Number(createdRecord?.id || 0) || null,
                    delaySeconds: 300,
                    scribeConfig: scribeConfig && typeof scribeConfig === 'object' ? scribeConfig : null,
                })
            }
        }

        return NextResponse.json({ success: true, record: createdRecord })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to create patient transcription' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
