import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { verifyAdminToken } from '@/lib/auth'
import { ensurePatientTranscriptionsTable } from '@/lib/patientTranscriptionsTable'
import { enqueuePatientScribeJob, isScribeAgentEnabled } from '@/lib/patientScribeQueue'
import { activityActorFromAdminUser, loadActivityPatientName, recordActivity } from '@/lib/activities'

const PENDING_DELETE_STATUS = 'pending delete'

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

async function resolveRouteParams(params) {
    if (params && typeof params.then === 'function') {
        return await params
    }
    return params || {}
}

function getRequestedDomain(request, payload = null) {
    if (payload && typeof payload === 'object') {
        const fromBody = normalizeDomain(payload.domain)
        if (fromBody) return fromBody
    }

    const { searchParams } = new URL(request.url)
    return normalizeDomain(searchParams.get('domain'))
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

async function fetchPatientContext(connection, domain, patientId) {
    const result = await connection.query(
        `SELECT id, patient_name, metadata FROM patients WHERE id = $1 AND domain = $2 LIMIT 1`,
        [patientId, domain]
    )
    return result.rows?.[0] || null
}

export async function GET(request, { params }) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    const routeParams = await resolveRouteParams(params)
    const id = parseInteger(routeParams?.id)
    if (!id) {
        return NextResponse.json({ success: false, error: 'Invalid transcription id' }, { status: 400 })
    }

    let connection = null
    try {
        const context = await resolveRequestContext(request)
        if (context?.error) {
            return NextResponse.json({ success: false, error: context.error }, { status: context.status || 401 })
        }

        await ensurePatientTranscriptionsTable()
        connection = await getDomainBoundConnection(context.domain)

        const result = await connection.query(
            `SELECT id, domain, patient_id, status, source, title, meeting_external_id, audio_mime_type, audio_seconds, transcript_text, metadata, created_at, updated_at
             FROM patient_transcriptions
             WHERE id = $1 AND domain = $2
             LIMIT 1`,
            [id, context.domain]
        )
        const record = normalizeRow(result.rows?.[0] || null)
        if (!record) {
            return NextResponse.json({ success: false, error: 'Patient transcription not found' }, { status: 404 })
        }
        const normalizedStatus = String(record?.status || '').trim().toLowerCase()
        const normalizedTranscriptText = String(record?.transcript_text || '').trim()
        if (normalizedStatus === 'completed' && normalizedTranscriptText) {
            const patientId = parseInteger(record?.patient_id)
            if (patientId) {
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
                        source: 'one:patient-transcriptions-patch',
                        transcriptionId: Number(record?.id || 0) || null,
                        delaySeconds: 300,
                        scribeConfig: scribeConfig && typeof scribeConfig === 'object' ? scribeConfig : null,
                    })
                }
            }
        }

        return NextResponse.json({ success: true, record })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load patient transcription' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}

export async function PATCH(request, { params }) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    const routeParams = await resolveRouteParams(params)
    const id = parseInteger(routeParams?.id)
    if (!id) {
        return NextResponse.json({ success: false, error: 'Invalid transcription id' }, { status: 400 })
    }

    let connection = null
    try {
        const payload = await request.json().catch(() => ({}))
        const context = await resolveRequestContext(request, payload)
        if (context?.error) {
            return NextResponse.json({ success: false, error: context.error }, { status: context.status || 401 })
        }

        const status = payload?.status === undefined ? null : String(payload.status || '').trim().toLowerCase()
        const title = payload?.title === undefined ? null : (String(payload.title || '').trim() || null)
        const transcriptText = payload?.transcript_text === undefined ? null : (String(payload.transcript_text || '').trim() || null)
        const metadata = payload?.metadata

        const metadataError = validateMetadata(metadata)
        if (metadataError) {
            return NextResponse.json({ success: false, error: metadataError }, { status: 400 })
        }

        const setClauses = []
        const values = []

        if (status !== null) {
            setClauses.push('status')
            values.push(status || 'recording')
        }

        if (title !== null) {
            setClauses.push('title')
            values.push(title)
        }

        if (transcriptText !== null) {
            setClauses.push('transcript_text')
            values.push(transcriptText)
        }

        if (metadata !== undefined) {
            setClauses.push('metadata')
            values.push(JSON.stringify(metadata || {}))
        }

        if (setClauses.length === 0) {
            return NextResponse.json({ success: false, error: 'No fields provided for update' }, { status: 400 })
        }

        await ensurePatientTranscriptionsTable()
        connection = await getDomainBoundConnection(context.domain)

        const sqlSets = setClauses.map((name, index) => {
            const valuePosition = `$${index + 1}`
            if (name === 'metadata') return `${name} = ${valuePosition}::jsonb`
            return `${name} = ${valuePosition}`
        })
        sqlSets.push(`updated_at = NOW()`)

        const whereId = `$${values.length + 1}`
        const whereDomain = `$${values.length + 2}`

        const result = await connection.query(
            `UPDATE patient_transcriptions
             SET ${sqlSets.join(', ')}
             WHERE id = ${whereId} AND domain = ${whereDomain}
             RETURNING id, domain, patient_id, status, source, title, meeting_external_id, audio_mime_type, audio_seconds, transcript_text, metadata, created_at, updated_at`,
            [...values, id, context.domain]
        )
        const record = normalizeRow(result.rows?.[0] || null)
        if (!record) {
            return NextResponse.json({ success: false, error: 'Patient transcription not found' }, { status: 404 })
        }

        await recordActivity({
            domain: context.domain,
            action: 'update',
            entityType: 'transcription',
            entityId: record.id,
            entityLabel: record.title || `Transcript ${record.id}`,
            patientId: record.patient_id,
            patientName: await loadActivityPatientName(connection, record.patient_id, context.domain),
            actor: activityActorFromAdminUser(context.user),
        }, { connection })

        return NextResponse.json({ success: true, record })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to update patient transcription' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}

export async function DELETE(request, { params }) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    const routeParams = await resolveRouteParams(params)
    const id = parseInteger(routeParams?.id)
    if (!id) {
        return NextResponse.json({ success: false, error: 'Invalid transcription id' }, { status: 400 })
    }

    let connection = null
    try {
        const context = await resolveRequestContext(request)
        if (context?.error) {
            return NextResponse.json({ success: false, error: context.error }, { status: context.status || 401 })
        }

        await ensurePatientTranscriptionsTable()
        connection = await getDomainBoundConnection(context.domain)

        const existingResult = await connection.query(
            `SELECT id, patient_id, title, status, metadata
             FROM patient_transcriptions
             WHERE id = $1 AND domain = $2
             LIMIT 1`,
            [id, context.domain]
        )
        const existing = existingResult.rows?.[0] || null
        if (!existing) {
            return NextResponse.json({ success: false, error: 'Patient transcription not found' }, { status: 404 })
        }

        const existingMetadata = parseMetadataValue(existing.metadata) || {}
        const existingStatus = String(existing.status || '').trim().toLowerCase() || 'completed'
        const nextMetadata = {
            ...existingMetadata,
            recycling: {
                ...(existingMetadata.recycling || {}),
                previousStatus: existingStatus === PENDING_DELETE_STATUS
                    ? String(existingMetadata?.recycling?.previousStatus || 'completed').trim().toLowerCase() || 'completed'
                    : existingStatus,
                deletedAt: new Date().toISOString(),
            },
        }

        const result = await connection.query(
            `UPDATE patient_transcriptions
             SET status = $1, metadata = $2::jsonb, updated_at = NOW()
             WHERE id = $3 AND domain = $4
             RETURNING id, status, metadata`,
            [PENDING_DELETE_STATUS, JSON.stringify(nextMetadata), id, context.domain]
        )

        await recordActivity({
            domain: context.domain,
            action: 'delete',
            entityType: 'transcription',
            entityId: id,
            entityLabel: existing.title || `Transcript ${id}`,
            patientId: existing.patient_id,
            patientName: await loadActivityPatientName(connection, existing.patient_id, context.domain),
            actor: activityActorFromAdminUser(context.user),
        }, { connection })

        return NextResponse.json({ success: true, record: normalizeRow(result.rows?.[0] || null) })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to delete patient transcription' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
