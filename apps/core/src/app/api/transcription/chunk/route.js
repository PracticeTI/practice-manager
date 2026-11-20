import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { verifyAdminToken } from '@/lib/auth'
import { ensurePatientTranscriptionsTable } from '@/lib/patientTranscriptionsTable'
import { enqueuePatientScribeJob, isScribeAgentEnabled } from '@/lib/patientScribeQueue'
import { transcribeAudio } from '@/lib/ai/transcribe'
import { AI_SERVICE_TRANSCRIPTION } from '@/lib/ai/services'
import { readAiServiceSelection } from '@/lib/ai/serviceSettings'

const DEFAULT_TRANSCRIPTION_MODEL = process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe'

function parseInteger(rawValue) {
    const parsed = Number.parseInt(String(rawValue || ''), 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function parseMetadataValue(value) {
    if (value === null || value === undefined || value === '') return {}
    if (typeof value === 'object') return value
    if (typeof value !== 'string') return {}

    try {
        const parsed = JSON.parse(value)
        return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
        return {}
    }
}

function normalizeDomain(value) {
    return String(value || '').trim().toLowerCase()
}

function getBoolean(value) {
    const text = String(value || '').trim().toLowerCase()
    return text === '1' || text === 'true' || text === 'yes'
}

function normalizeTranscriptMode(value) {
    const text = String(value || '').trim().toLowerCase()
    return text === 'replace' ? 'replace' : 'append'
}

function getChunkMetadata(existingMetadata, chunkEntry) {
    const metadata = existingMetadata && typeof existingMetadata === 'object' ? { ...existingMetadata } : {}
    const existingChunks = Array.isArray(metadata.chunks) ? metadata.chunks : []
    metadata.chunks = [...existingChunks, chunkEntry]
    metadata.lastChunkAt = new Date().toISOString()
    metadata.chunkCount = metadata.chunks.length
    return metadata
}

async function resolveRequestContext(request, submittedDomain) {
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

    const normalizedDomain = normalizeDomain(submittedDomain)
    const scopedDomain = normalizeDomain(adminUser?.domain)

    if (adminUser?.role !== 'superadmin' && scopedDomain) {
        if (normalizedDomain && normalizedDomain !== scopedDomain) {
            return { error: 'Forbidden: domain scope mismatch', status: 403 }
        }
        return { user: adminUser, domain: scopedDomain }
    }

    if (!normalizedDomain) {
        return { error: 'domain is required', status: 400 }
    }

    return { user: adminUser, domain: normalizedDomain }
}

async function createTranscriptionRecord(connection, dbType, {
    domain,
    patientId,
    source,
    title,
    audioMimeType,
}) {
    const metadata = {
        chunks: [],
        startedAt: new Date().toISOString(),
    }

    const result = await connection.query(
        `INSERT INTO patient_transcriptions (domain, patient_id, status, source, title, audio_mime_type, transcript_text, metadata)
         VALUES ($1, $2, 'recording', $3, $4, $5, '', $6::jsonb)
         RETURNING id`,
        [domain, patientId, source, title, audioMimeType, JSON.stringify(metadata)]
    )
    return parseInteger(result.rows?.[0]?.id)
}

async function getTranscriptionRecord(connection, dbType, transcriptionId, domain) {
    const result = await connection.query(
        `SELECT id, domain, patient_id, status, transcript_text, metadata
         FROM patient_transcriptions
         WHERE id = $1 AND domain = $2
         LIMIT 1`,
        [transcriptionId, domain]
    )
    return result.rows?.[0] || null
}

async function updateTranscriptionRecord(connection, dbType, {
    transcriptionId,
    domain,
    status,
    transcriptText,
    metadata,
}) {
    await connection.query(
        `UPDATE patient_transcriptions
         SET status = $1,
             transcript_text = $2,
             metadata = $3::jsonb,
             updated_at = NOW()
         WHERE id = $4 AND domain = $5`,
        [status, transcriptText, JSON.stringify(metadata), transcriptionId, domain]
    )
}

async function fetchPatientContext(connection, dbType, domain, patientId) {
    const result = await connection.query(
        `SELECT id, patient_name, metadata FROM patients WHERE id = $1 AND domain = $2 LIMIT 1`,
        [patientId, domain]
    )
    return result.rows?.[0] || null
}


function isRecoverableAudioDecodeError(error) {
    const message = String(error?.message || '').trim().toLowerCase()
    if (!message) return false
    return (
        message.includes('audio file might be corrupted or unsupported') ||
        message.includes('corrupted or unsupported') ||
        message.includes('unsupported') ||
        message.includes('could not decode') ||
        message.includes('invalid file format')
    )
}

async function requestChunkTranscription(file, mimeType, language = '', selection = null) {
    const result = await transcribeAudio({
        audio: file,
        mimeType,
        language,
        provider: selection?.provider,
        model: selection?.model,
    })

    if (!result.ok) {
        throw new Error(result.error || 'Transcription request failed')
    }

    return {
        text: result.text,
        provider: result.provider,
        model: result.model,
        mimeType,
    }
}

export async function POST(request) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    let connection = null

    try {
        const form = await request.formData()
        const submittedDomain = form.get('domain')
        const context = await resolveRequestContext(request, submittedDomain)
        if (context?.error) {
            return NextResponse.json({ success: false, error: context.error }, { status: context.status || 401 })
        }

        const patientId = parseInteger(form.get('patient_id'))
        const providedTranscriptionId = parseInteger(form.get('transcription_id'))
        const chunkIndex = parseInteger(form.get('chunk_index')) || 1
        const isFinal = getBoolean(form.get('is_final'))
        const startedAtMs = parseInteger(form.get('started_at_ms'))
        const endedAtMs = parseInteger(form.get('ended_at_ms'))
        const source = String(form.get('source') || 'browser-live').trim().toLowerCase() || 'browser-live'
        const title = String(form.get('title') || '').trim() || null
        const language = String(form.get('language') || '').trim().toLowerCase() || ''
        const transcriptMode = normalizeTranscriptMode(form.get('transcript_mode'))

        if (!patientId) {
            return NextResponse.json({ success: false, error: 'patient_id is required' }, { status: 400 })
        }

        const chunk = form.get('chunk')
        if (!(chunk instanceof File)) {
            return NextResponse.json({ success: false, error: 'chunk file is required' }, { status: 400 })
        }

        const audioMimeType = String(chunk.type || 'audio/webm').trim() || 'audio/webm'

        await ensurePatientTranscriptionsTable()
        connection = await getDomainBoundConnection(context.domain)

        let transcriptionId = providedTranscriptionId
        if (!transcriptionId) {
            transcriptionId = await createTranscriptionRecord(connection, dbType, {
                domain: context.domain,
                patientId,
                source,
                title,
                audioMimeType,
            })
        }

        if (!transcriptionId) {
            throw new Error('Failed to create transcription record')
        }

        const currentRecord = await getTranscriptionRecord(connection, dbType, transcriptionId, context.domain)
        if (!currentRecord) {
            return NextResponse.json({ success: false, error: 'Patient transcription not found' }, { status: 404 })
        }

        let deltaText = ''
        let chunkTranscriptionError = ''
        let transcriptionProvider = ''
        let transcriptionModel = ''
        try {
            const transcriptionSelection = await readAiServiceSelection(AI_SERVICE_TRANSCRIPTION).catch(() => null)
            const transcription = await requestChunkTranscription(chunk, audioMimeType, language, transcriptionSelection)
            deltaText = String(transcription?.text || '').trim()
            transcriptionProvider = transcription?.provider || ''
            transcriptionModel = transcription?.model || ''
        } catch (error) {
            if (!isRecoverableAudioDecodeError(error)) {
                throw error
            }
            chunkTranscriptionError = String(error?.message || '').trim() || 'Audio chunk could not be decoded'
        }

        const existingText = String(currentRecord?.transcript_text || '').trim()
        const nextTranscriptText = transcriptMode === 'replace'
            ? (deltaText || existingText)
            : (deltaText
                ? [existingText, deltaText].filter(Boolean).join(existingText ? '\n' : '')
                : existingText)

        const existingMetadata = parseMetadataValue(currentRecord?.metadata)
        const chunkEntry = {
            chunkIndex,
            startedAtMs: startedAtMs || null,
            endedAtMs: endedAtMs || null,
            text: deltaText,
            mimeType: audioMimeType,
            receivedAt: new Date().toISOString(),
        }
        if (chunkTranscriptionError) {
            chunkEntry.error = chunkTranscriptionError
        }
        const nextMetadata = getChunkMetadata(existingMetadata, chunkEntry)

        if (!nextMetadata.transcriptionProvider) {
            nextMetadata.transcriptionProvider = transcriptionProvider || 'openai'
            nextMetadata.transcriptionModel = transcriptionModel || DEFAULT_TRANSCRIPTION_MODEL
        }

        let nextStatus = 'recording'
        if (isFinal) {
            if (!nextTranscriptText && chunkTranscriptionError) {
                nextStatus = 'failed'
                nextMetadata.failedAt = new Date().toISOString()
                nextMetadata.lastError = chunkTranscriptionError
            } else {
                nextStatus = 'completed'
                nextMetadata.completedAt = new Date().toISOString()
            }
        }

        await updateTranscriptionRecord(connection, dbType, {
            transcriptionId,
            domain: context.domain,
            status: nextStatus,
            transcriptText: nextTranscriptText,
            metadata: nextMetadata,
        })

        if (nextStatus === 'completed' && nextTranscriptText) {
            const patientContext = await fetchPatientContext(connection, dbType, context.domain, patientId)
            const patientMetadata = parseMetadataValue(patientContext?.metadata)
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
                    source: 'one:transcription-chunk',
                    transcriptionId,
                    delaySeconds: 300,
                    scribeConfig: scribeConfig && typeof scribeConfig === 'object' ? scribeConfig : null,
                })
            }
        }

        return NextResponse.json({
            success: true,
            transcription_id: transcriptionId,
            status: nextStatus,
            transcript_delta: deltaText,
            transcript_text: nextTranscriptText,
            chunk_count: nextMetadata.chunkCount || 0,
            chunk_error: chunkTranscriptionError || null,
            transcript_mode: transcriptMode,
        })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to transcribe chunk' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
