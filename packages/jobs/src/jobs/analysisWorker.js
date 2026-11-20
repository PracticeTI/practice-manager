import { detectDatabaseType, getDatabaseConnection } from '../database.js'
import { ensureAnalysisQueueTable, resolveAnalysisQueueTableName } from './analysisQueue.js'
import { ensureScribeQueueTable, resolveScribeQueueTableName } from './scribeQueue.js'
import { ensurePermissiveRowLevelSecurity } from './postgresRls.js'
import { FCA_ANALYSIS_NOTES_CHARS, generateAnalysisEvidenceWithOpenAi, normalizeEvidenceDocuments } from './fcaAnalysisEvidence.js'
import { buildIdentityBlockFromPatient, resolveSubjectNoun } from '../privacy/index.js'
import { resolveChatProviderLabel } from './chatModelRequest.js'

const DEFAULT_BATCH_SIZE = 10
const DEFAULT_POLL_SECONDS = 200
const DEFAULT_MAX_ATTEMPTS = 5
const DEFAULT_RETRY_BASE_SECONDS = 30
const DEFAULT_RETRY_MAX_SECONDS = 1800
const DEFAULT_STALE_PROCESSING_MINUTES = 15
const DEFAULT_PATIENT_ANALYSIS_TABLE = 'patient_analysis'
const DEFAULT_SCRIBE_SUMMARIES_TABLE = 'patient_transcript_summaries'
const PENDING_DELETE_STATUS = 'pending delete'
const DEFAULT_ANALYSIS_WORKER_PROMPT = 'Review the patient notes and transcripts for FCA-relevant evidence. Focus on functional capacity, safety and risk, supports and recommendations, and goals and outcomes. Highlight evidence that would help build a strong, clinically grounded FCA report. When identifying supports or interventions, prefer specific, actionable suggestions such as occupational therapy, assistive technology, home modifications, personal care support, or community access supports. Classify each identified support as either already addressed (currently in place) or recommended (a new or increased support). Return addressed supports only through an addressedInterventions array and new/increased supports only through a recommendedInterventions array, where each item includes intervention and justification. Do not emit any other recommendation list content outside those arrays.'
const DEFAULT_MIN_RECOMMENDED_INTERVENTIONS = 0
// High enough to never truncate the heuristic catalog (currently 9 entries) - any intervention
// identified from real evidence should surface, not just the first handful.
const DEFAULT_MAX_RECOMMENDED_INTERVENTIONS = 50
const DEFAULT_MIN_ADDRESSED_INTERVENTIONS = 0
const DEFAULT_MAX_ADDRESSED_INTERVENTIONS = 50

// Must match FCA_SCRIBE_SUMMARY_STYLE in ./scribeWorker.js. Repeated rather than imported so this
// worker does not pull the whole summariser in for one string.
const FCA_SCRIBE_SUMMARY_STYLE = 'fca-functional-capacity'
const LEGACY_ANALYSIS_WORKER_PROMPTS = new Set([
    'Review the patient notes and transcripts for FCA-relevant evidence. Focus on functional capacity, safety and risk, supports and recommendations, and goals and outcomes. Highlight evidence that would help build a strong, clinically grounded FCA report. When identifying supports or interventions, prefer specific, actionable suggestions such as occupational therapy, assistive technology, home modifications, personal care support, or community access supports, and note any important gaps or follow-up questions.',
    // Pre-2026-09-16: recommendations only, no addressed/recommended split.
    'Review the patient notes and transcripts for FCA-relevant evidence. Focus on functional capacity, safety and risk, supports and recommendations, and goals and outcomes. Highlight evidence that would help build a strong, clinically grounded FCA report. When identifying supports or interventions, prefer specific, actionable suggestions such as occupational therapy, assistive technology, home modifications, personal care support, or community access supports. Return recommendations only through a recommendedInterventions array where each item includes intervention and justification. Do not emit any other recommendation list content outside that array.',
])

class DeferredRetryAnalysisError extends Error {
    constructor(message) {
        super(message)
        this.name = 'DeferredRetryAnalysisError'
        this.retrySeconds = 120
    }
}

function isTrue(value) {
    return String(value).toLowerCase() === 'true'
}

function parsePositiveInt(value, fallback) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(1, Math.floor(parsed))
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max)
}

function getConfig() {
    return {
        enabled: isTrue(process.env.ANALYSIS_WORKER_ENABLED || 'false'),
        table: resolveAnalysisQueueTableName(),
        batchSize: parsePositiveInt(process.env.ANALYSIS_BATCH_SIZE, DEFAULT_BATCH_SIZE),
        pollSeconds: parsePositiveInt(process.env.ANALYSIS_POLL_SECONDS, DEFAULT_POLL_SECONDS),
        defaultMaxAttempts: parsePositiveInt(process.env.ANALYSIS_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS),
        retryBaseSeconds: parsePositiveInt(process.env.ANALYSIS_RETRY_BASE_SECONDS, DEFAULT_RETRY_BASE_SECONDS),
        retryMaxSeconds: parsePositiveInt(process.env.ANALYSIS_RETRY_MAX_SECONDS, DEFAULT_RETRY_MAX_SECONDS),
        staleProcessingMinutes: parsePositiveInt(
            process.env.ANALYSIS_STALE_PROCESSING_MINUTES,
            DEFAULT_STALE_PROCESSING_MINUTES
        )
    }
}

function truncateText(value, maxLength = 2000) {
    if (!value) return ''
    const text = String(value)
    if (text.length <= maxLength) return text
    return `${text.slice(0, maxLength)}\n\n[truncated ${text.length - maxLength} chars]`
}

function isSafeSqlIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ''))
}

export function resolvePatientAnalysisTableName() {
    const table = String(process.env.PATIENT_ANALYSIS_TABLE || DEFAULT_PATIENT_ANALYSIS_TABLE).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error('PATIENT_ANALYSIS_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
    }
    return table
}

export function resolveScribeSummariesTableName() {
    const table = String(process.env.PATIENT_TRANSCRIPT_SUMMARIES_TABLE || DEFAULT_SCRIBE_SUMMARIES_TABLE).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error('PATIENT_TRANSCRIPT_SUMMARIES_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
    }
    return table
}

function isMissingTableError(error) {
    const message = String(error?.message || '').toLowerCase()
    return message.includes('does not exist')
        || message.includes('unknown table')
        || (message.includes('relation') && message.includes('does not exist'))
}

function parsePayload(row) {
    const raw = row?.payload_json || row?.payload || null
    if (!raw) return {}
    if (typeof raw === 'object') return raw
    try {
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
        return {}
    }
}

function parseJsonObject(value) {
    if (!value) return {}
    if (typeof value === 'object' && !Array.isArray(value)) return value
    try {
        const parsed = JSON.parse(value)
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
        return {}
    }
}

function normalizeText(value, maxLength = 250000) {
    return String(value || '').replace(/\r\n/g, '\n').slice(0, maxLength)
}

function sentenceSplit(source) {
    return String(source || '')
        .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9])/g)
        .map((line) => line.trim())
        .filter((line) => line.length > 20)
}

function wordCount(value) {
    return String(value || '').trim().split(/\s+/).filter(Boolean).length
}

function isDeferredRetryError(error) {
    return error instanceof DeferredRetryAnalysisError
}

function hasAnyTranscriptText(transcripts) {
    return (Array.isArray(transcripts) ? transcripts : []).some((item) => String(item?.transcript_text || '').trim())
}

function resolveMissingSummaryTranscriptionIds(transcripts) {
    const ids = []
    const seen = new Set()

    for (const item of Array.isArray(transcripts) ? transcripts : []) {
        const transcriptText = String(item?.transcript_text || '').trim()
        if (!transcriptText) continue
        const hasSummary = Boolean(String(item?.transcript_summary_text || '').trim())
        if (hasSummary) continue

        const transcriptionId = Number.parseInt(String(item?.id || ''), 10)
        if (!Number.isFinite(transcriptionId) || transcriptionId <= 0) continue
        if (seen.has(transcriptionId)) continue
        seen.add(transcriptionId)
        ids.push(transcriptionId)
    }

    return ids
}

function enrichTranscriptsWithSummaries(transcripts, summaryRows) {
    const items = Array.isArray(transcripts) ? transcripts : []
    const summaries = Array.isArray(summaryRows) ? summaryRows : []
    const summaryByTranscriptionId = new Map()

    // Summaries arrive in every style. The FCA style is the analyst's primary evidence (it is a
    // list of domain-tagged functional findings); the generic style is a weaker paraphrase kept
    // only as a fallback. Without the style branch the last row wins and the analyst would usually
    // read the generic summary instead of the FCA one.
    for (const row of summaries) {
        const transcriptionId = Number.parseInt(String(row?.transcription_id || ''), 10)
        if (!Number.isFinite(transcriptionId) || transcriptionId <= 0) continue

        const summaryStyle = String(row?.summary_style || '').trim() || 'topic-bullets-third-person'
        const current = summaryByTranscriptionId.get(transcriptionId) || {}
        summaryByTranscriptionId.set(transcriptionId, {
            ...current,
            summaryText: summaryStyle === 'topic-bullets-third-person' ? String(row?.summary_text || '').trim() : current.summaryText || '',
            summaryPayload: summaryStyle === 'topic-bullets-third-person' ? parseJsonObject(row?.summary_payload_json) : current.summaryPayload || {},
            fcaSummaryText: summaryStyle === FCA_SCRIBE_SUMMARY_STYLE ? String(row?.summary_text || '').trim() : current.fcaSummaryText || '',
            fcaSummaryPayload: summaryStyle === FCA_SCRIBE_SUMMARY_STYLE ? parseJsonObject(row?.summary_payload_json) : current.fcaSummaryPayload || {},
            updatedAt: row?.updated_at || current.updatedAt || null,
        })
    }

    return items.map((item) => {
        const transcriptionId = Number.parseInt(String(item?.id || ''), 10)
        const summary = Number.isFinite(transcriptionId) ? summaryByTranscriptionId.get(transcriptionId) : null
        return {
            ...item,
            transcript_summary_text: String(summary?.summaryText || '').trim(),
            transcript_summary_payload: summary?.summaryPayload || {},
            transcript_fca_summary_text: String(summary?.fcaSummaryText || '').trim(),
            transcript_fca_summary_payload: summary?.fcaSummaryPayload || {},
            transcript_summary_updated_at: summary?.updatedAt || null,
        }
    })
}

async function enqueueTranscriptSummaryJobsPostgres(connection, queueTable, summariesTable, params) {
    const result = await connection.query(
        `
        INSERT INTO ${queueTable} (
            status,
            domain,
            patient_id,
            patient_name,
            transcription_id,
            event_type,
            requested_action,
            payload_json,
            attempts,
            created_at,
            updated_at
        )
        SELECT
            'queued',
            $1::text,
            $2::bigint,
            $3::text,
            candidate.transcription_id,
            'analysis_summary_prereq',
            'summarize_transcript',
            json_build_object(
                'domain', $1::text,
                'patientId', $2::bigint,
                'patientName', $3::text,
                'transcriptionId', candidate.transcription_id,
                'source', 'two:analysis-worker-summary-prereq'
            )::text,
            0,
            NOW(),
            NOW()
        FROM (
            SELECT UNNEST($4::bigint[]) AS transcription_id
        ) candidate
        JOIN patient_transcriptions t
          ON t.id = candidate.transcription_id
         AND t.domain = $1::text
         AND t.patient_id = $2::bigint
         AND LOWER(COALESCE(t.status, '')) = 'completed'
         AND COALESCE(t.transcript_text, '') <> ''
        LEFT JOIN ${summariesTable} s
          ON s.domain = $1::text
         AND s.transcription_id = candidate.transcription_id
        WHERE s.id IS NULL
          AND NOT EXISTS (
                SELECT 1
                FROM ${queueTable} q
                WHERE q.domain = $1::text
                  AND q.patient_id = $2::bigint
                  AND q.transcription_id = candidate.transcription_id
                  AND q.status IN ('queued', 'processing')
          )
        RETURNING id
    `,
        [params.domain, params.patientId, params.patientName || null, params.transcriptionIds]
    )

    return result?.rowCount || 0
}

async function enqueueTranscriptSummaryJobsMySql(connection, queueTable, summariesTable, params) {
    const placeholders = params.transcriptionIds.map(() => '?').join(', ')

    const [result] = await connection.execute(
        `
        INSERT INTO ${queueTable} (
            status,
            domain,
            patient_id,
            patient_name,
            transcription_id,
            event_type,
            requested_action,
            payload_json,
            attempts,
            created_at,
            updated_at
        )
        SELECT
            'queued',
            ?,
            ?,
            ?,
            t.id,
            'analysis_summary_prereq',
            'summarize_transcript',
            JSON_OBJECT(
                'domain', ?,
                'patientId', ?,
                'patientName', ?,
                'transcriptionId', t.id,
                'source', 'two:analysis-worker-summary-prereq'
            ),
            0,
            UTC_TIMESTAMP(),
            UTC_TIMESTAMP()
        FROM patient_transcriptions t
        LEFT JOIN ${summariesTable} s
          ON s.domain = ?
         AND s.transcription_id = t.id
        WHERE t.domain = ?
          AND t.patient_id = ?
          AND t.id IN (${placeholders})
          AND LOWER(COALESCE(t.status, '')) = 'completed'
          AND COALESCE(t.transcript_text, '') <> ''
          AND s.id IS NULL
          AND NOT EXISTS (
                SELECT 1
                FROM ${queueTable} q
                WHERE q.domain = ?
                  AND q.patient_id = ?
                  AND q.transcription_id = t.id
                  AND q.status IN ('queued', 'processing')
          )
    `,
        [
            params.domain,
            params.patientId,
            params.patientName || null,
            params.domain,
            params.patientId,
            params.patientName || null,
            params.domain,
            params.domain,
            params.patientId,
            ...params.transcriptionIds,
            params.domain,
            params.patientId,
        ]
    )

    return result?.affectedRows || 0
}

async function enqueueMissingTranscriptSummaryJobs({ connection, dbType, domain, patientId, patientName, transcripts }) {
    const transcriptionIds = resolveMissingSummaryTranscriptionIds(transcripts)
    if (transcriptionIds.length === 0) {
        return { eligibleCount: 0, queuedCount: 0 }
    }

    const queueTable = resolveScribeQueueTableName()
    const summariesTable = resolveScribeSummariesTableName()
    await ensureScribeQueueTable(connection, dbType, queueTable)

    const queuedCount = dbType === 'postgresql'
        ? await enqueueTranscriptSummaryJobsPostgres(connection, queueTable, summariesTable, {
            domain,
            patientId,
            patientName,
            transcriptionIds,
        })
        : await enqueueTranscriptSummaryJobsMySql(connection, queueTable, summariesTable, {
            domain,
            patientId,
            patientName,
            transcriptionIds,
        })

    return {
        eligibleCount: transcriptionIds.length,
        queuedCount,
    }
}

function getAnalysisSchemaStatements(table, dbType) {
    if (dbType === 'postgresql') {
        return {
            create: `
      CREATE TABLE IF NOT EXISTS ${table} (
        id BIGSERIAL PRIMARY KEY,
        domain VARCHAR(100) NOT NULL,
        patient_id BIGINT NOT NULL,
        patient_name TEXT,
        status VARCHAR(32) NOT NULL DEFAULT 'ready',
        summary_text TEXT,
        analysis_payload_json TEXT NOT NULL DEFAULT '{}',
        last_job_id BIGINT,
        source_notes_length INTEGER NOT NULL DEFAULT 0,
        transcript_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT ${table}_domain_patient_unique UNIQUE (domain, patient_id)
      )
    `,
            indexes: [
                `CREATE INDEX IF NOT EXISTS ${table}_domain_patient_idx ON ${table} (domain, patient_id)`,
                `CREATE INDEX IF NOT EXISTS ${table}_updated_idx ON ${table} (updated_at)`
            ]
        }
    }

    if (dbType === 'mysql') {
        return {
            create: `
      CREATE TABLE IF NOT EXISTS ${table} (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        domain VARCHAR(100) NOT NULL,
        patient_id BIGINT NOT NULL,
        patient_name TEXT,
        status VARCHAR(32) NOT NULL DEFAULT 'ready',
        summary_text TEXT,
        analysis_payload_json LONGTEXT NOT NULL,
        last_job_id BIGINT,
        source_notes_length INT NOT NULL DEFAULT 0,
        transcript_count INT NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY ${table}_domain_patient_unique (domain, patient_id),
        KEY ${table}_domain_patient_idx (domain, patient_id),
        KEY ${table}_updated_idx (updated_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `,
            indexes: []
        }
    }

    throw new Error(`Unsupported database type for patient analysis: ${dbType}`)
}

async function ensurePatientAnalysisTable(connection, dbType, table) {
    const schema = getAnalysisSchemaStatements(table, dbType)
    await connection.query(schema.create)

    for (const indexStatement of schema.indexes) {
        try {
            await connection.query(indexStatement)
        } catch (error) {
            const message = String(error?.message || '')
            if (!message.includes('already exists') && !message.includes('Duplicate')) {
                throw error
            }
        }
    }

    if (dbType === 'postgresql') {
        await ensurePermissiveRowLevelSecurity(connection, table, `${table}_rls_policy`)
    }
}

/**
 * The patient's note bodies, read from the Notes entity.
 *
 * Notes used to be denormalised into `patients.metadata.patientNotes`; they now
 * live in their own domain-scoped table, so the worker reads them directly.
 */
async function fetchPatientNotesText(connection, dbType, domain, patientId) {
    try {
        const rows = dbType === 'postgresql'
            ? (await connection.query(
                `
      SELECT content_text
      FROM notes
      WHERE domain = $1 AND patient_id = $2
      ORDER BY updated_at DESC NULLS LAST, id DESC
      LIMIT 200
    `,
                [domain, patientId]
            )).rows
            : (await connection.execute(
                `
      SELECT content_text
      FROM notes
      WHERE domain = ? AND patient_id = ?
      ORDER BY updated_at DESC, id DESC
      LIMIT 200
    `,
                [domain, patientId]
            ))[0]

        return (Array.isArray(rows) ? rows : [])
            .map((row) => String(row?.content_text || '').trim())
            .filter(Boolean)
            .join('\n\n')
    } catch (error) {
        // A domain that has never had a note stored has no `notes` table yet.
        if (isMissingTableError(error)) return ''
        throw error
    }
}

async function fetchPatientContextPostgres(connection, domain, patientId) {
    const summariesTable = resolveScribeSummariesTableName()
    const notesText = await fetchPatientNotesText(connection, 'postgresql', domain, patientId)
    const patientResult = await connection.query(
        `
      SELECT id, patient_name, domain, metadata
      FROM patients
      WHERE id = $1 AND domain = $2
      LIMIT 1
    `,
        [patientId, domain]
    )

    let transcripts = []
    try {
        const transcriptResult = await connection.query(
            `
      SELECT id, status, title, transcript_text, created_at, updated_at
      FROM patient_transcriptions
      WHERE patient_id = $1
        AND domain = $2
        AND status <> $3
        AND COALESCE(transcript_text, '') <> ''
      ORDER BY COALESCE(updated_at, created_at) DESC
      LIMIT 20
    `,
            [patientId, domain, PENDING_DELETE_STATUS]
        )
        transcripts = transcriptResult.rows || []
    } catch {
        transcripts = []
    }

    let summaryRows = []
    try {
        const transcriptionIds = transcripts
            .map((item) => Number.parseInt(String(item?.id || ''), 10))
            .filter((id) => Number.isFinite(id) && id > 0)

        if (transcriptionIds.length > 0) {
            const summaryResult = await connection.query(
                `
                    SELECT transcription_id, summary_style, summary_text, summary_payload_json, updated_at
                    FROM ${summariesTable}
                    WHERE domain = $1
                      AND transcription_id = ANY($2::bigint[])
                `,
                [domain, transcriptionIds]
            )
            summaryRows = summaryResult?.rows || []
        }
    } catch (error) {
        if (!isMissingTableError(error)) {
            throw error
        }
    }

    const transcriptsWithSummaries = enrichTranscriptsWithSummaries(transcripts, summaryRows)
    const transcriptSummaryCount = transcriptsWithSummaries.filter((item) => String(item?.transcript_summary_text || '').trim()).length

    return {
        patient: patientResult.rows?.[0] || null,
        transcripts: transcriptsWithSummaries,
        transcriptSummaryCount,
        notesText,
    }
}

async function fetchPatientContextMySql(connection, domain, patientId) {
    const summariesTable = resolveScribeSummariesTableName()
    const notesText = await fetchPatientNotesText(connection, 'mysql', domain, patientId)
    const [patientRows] = await connection.execute(
        `
      SELECT id, patient_name, domain, metadata
      FROM patients
      WHERE id = ? AND domain = ?
      LIMIT 1
    `,
        [patientId, domain]
    )

    let transcriptRows = []
    try {
        const [rows] = await connection.execute(
            `
      SELECT id, status, title, transcript_text, created_at, updated_at
      FROM patient_transcriptions
      WHERE patient_id = ?
        AND domain = ?
        AND status <> ?
        AND COALESCE(transcript_text, '') <> ''
      ORDER BY COALESCE(updated_at, created_at) DESC
      LIMIT 20
    `,
            [patientId, domain, PENDING_DELETE_STATUS]
        )
        transcriptRows = rows || []
    } catch {
        transcriptRows = []
    }

    let summaryRows = []
    try {
        const transcriptionIds = transcriptRows
            .map((item) => Number.parseInt(String(item?.id || ''), 10))
            .filter((id) => Number.isFinite(id) && id > 0)

        if (transcriptionIds.length > 0) {
            const placeholders = transcriptionIds.map(() => '?').join(', ')
            const [rows] = await connection.execute(
                `
                    SELECT transcription_id, summary_style, summary_text, summary_payload_json, updated_at
                    FROM ${summariesTable}
                    WHERE domain = ?
                      AND transcription_id IN (${placeholders})
                `,
                [domain, ...transcriptionIds]
            )
            summaryRows = rows || []
        }
    } catch (error) {
        if (!isMissingTableError(error)) {
            throw error
        }
    }

    const transcriptsWithSummaries = enrichTranscriptsWithSummaries(transcriptRows, summaryRows)
    const transcriptSummaryCount = transcriptsWithSummaries.filter((item) => String(item?.transcript_summary_text || '').trim()).length

    return {
        patient: patientRows?.[0] || null,
        transcripts: transcriptsWithSummaries,
        transcriptSummaryCount,
        notesText,
    }
}

export function resolveAnalysisWorkerPrompt({ metadata, payload }) {
    const source = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}
    const patientAgents = source.patientAgents && typeof source.patientAgents === 'object' && !Array.isArray(source.patientAgents)
        ? source.patientAgents
        : {}
    const analysisConfig = patientAgents.analysisConfig && typeof patientAgents.analysisConfig === 'object' && !Array.isArray(patientAgents.analysisConfig)
        ? patientAgents.analysisConfig
        : patientAgents.analystConfig && typeof patientAgents.analystConfig === 'object' && !Array.isArray(patientAgents.analystConfig)
            ? patientAgents.analystConfig
            : {}

    const explicitPrompt = String(analysisConfig.workerPrompt || '').trim()
    if (explicitPrompt) {
        return LEGACY_ANALYSIS_WORKER_PROMPTS.has(explicitPrompt)
            ? DEFAULT_ANALYSIS_WORKER_PROMPT
            : explicitPrompt
    }

    const fallback = String(payload?.analysisConfig?.workerPrompt || '').trim()
    if (fallback) {
        return LEGACY_ANALYSIS_WORKER_PROMPTS.has(fallback)
            ? DEFAULT_ANALYSIS_WORKER_PROMPT
            : fallback
    }

    return DEFAULT_ANALYSIS_WORKER_PROMPT
}

function resolveAnalysisConfig({ metadata, payload }) {
    const source = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}
    const patientAgents = source.patientAgents && typeof source.patientAgents === 'object' && !Array.isArray(source.patientAgents)
        ? source.patientAgents
        : {}
    const analysisConfig = patientAgents.analysisConfig && typeof patientAgents.analysisConfig === 'object' && !Array.isArray(patientAgents.analysisConfig)
        ? patientAgents.analysisConfig
        : patientAgents.analystConfig && typeof patientAgents.analystConfig === 'object' && !Array.isArray(patientAgents.analystConfig)
            ? patientAgents.analystConfig
            : payload?.analysisConfig && typeof payload.analysisConfig === 'object' && !Array.isArray(payload.analysisConfig)
                ? payload.analysisConfig
                : {}

    return analysisConfig
}

export function resolveAnalysisRecommendationBounds({ metadata, payload }) {
    const analysisConfig = resolveAnalysisConfig({ metadata, payload })
    const rawMin = Number.parseInt(analysisConfig.minRecommendedInterventions, 10)
    const rawMax = Number.parseInt(analysisConfig.maxRecommendedInterventions, 10)
    const min = Number.isFinite(rawMin)
        ? clamp(rawMin, 0, DEFAULT_MAX_RECOMMENDED_INTERVENTIONS)
        : DEFAULT_MIN_RECOMMENDED_INTERVENTIONS
    const maxCandidate = Number.isFinite(rawMax)
        ? clamp(rawMax, min, DEFAULT_MAX_RECOMMENDED_INTERVENTIONS)
        : DEFAULT_MAX_RECOMMENDED_INTERVENTIONS

    return {
        minRecommendedInterventions: Math.min(min, maxCandidate),
        maxRecommendedInterventions: Math.max(min, maxCandidate),
    }
}

export function resolveAnalysisAddressedBounds({ metadata, payload }) {
    const analysisConfig = resolveAnalysisConfig({ metadata, payload })
    const rawMin = Number.parseInt(analysisConfig.minAddressedInterventions, 10)
    const rawMax = Number.parseInt(analysisConfig.maxAddressedInterventions, 10)
    const min = Number.isFinite(rawMin)
        ? clamp(rawMin, 0, DEFAULT_MAX_ADDRESSED_INTERVENTIONS)
        : DEFAULT_MIN_ADDRESSED_INTERVENTIONS
    const maxCandidate = Number.isFinite(rawMax)
        ? clamp(rawMax, min, DEFAULT_MAX_ADDRESSED_INTERVENTIONS)
        : DEFAULT_MAX_ADDRESSED_INTERVENTIONS

    return {
        minAddressedInterventions: Math.min(min, maxCandidate),
        maxAddressedInterventions: Math.max(min, maxCandidate),
    }
}

/**
 * The consultation evidence the analyst is given: the FCA-style summary where one exists, plus any
 * structured facts already extracted from that transcript.
 *
 * The generic `topic-bullets` summary is a weaker fallback - a paraphrase of a conversation rather
 * than a list of functional findings - so it is only used when no FCA summary exists.
 */
export function buildTranscriptEvidenceBlock(transcripts) {
    const items = Array.isArray(transcripts) ? transcripts : []
    const blocks = []

    for (const item of items) {
        const label = String(item?.title || '').trim() || `Transcript #${String(item?.id ?? '').trim() || '?'}`
        const summary = String(item?.transcript_fca_summary_text || '').trim()
            || String(item?.transcript_summary_text || '').trim()

        const payload = item?.transcript_fca_summary_payload && typeof item.transcript_fca_summary_payload === 'object'
            ? item.transcript_fca_summary_payload
            : item?.transcript_summary_payload && typeof item.transcript_summary_payload === 'object'
                ? item.transcript_summary_payload
                : {}
        const facts = Array.isArray(payload?.structuredEvidenceFacts) ? payload.structuredEvidenceFacts : []

        const parts = [summary]
        for (const fact of facts) {
            if (!fact || typeof fact !== 'object') continue
            const detail = [fact.observedIssue, fact.functionalImpact, fact.supportImplication]
                .map((value) => String(value || '').trim())
                .filter(Boolean)
                .join(' ')
            if (!detail) continue
            parts.push(`[${String(fact.domain || 'general').trim()}] ${detail}`)
        }

        const body = parts.filter(Boolean).join('\n')
        if (body) blocks.push(`${label}\n${body}`)
    }

    return blocks.join('\n\n')
}

/**
 * Assemble the stored analyst payload from an extraction result.
 *
 * Pure, so it can be tested without a model call: `evidence` is exactly what
 * `normalizeAnalysisEvidencePayload` returns.
 */
export function buildPatientAnalysisFromEvidence({
    patient,
    domain,
    job,
    payload,
    evidence,
    model = '',
    sourceStats = {},
    workerPrompt = '',
    recommendationBounds = null,
    addressedBounds = null,
}) {
    const facts = Array.isArray(evidence?.facts) ? evidence.facts : []
    const sectionsCovered = Array.isArray(evidence?.sectionsCovered) ? evidence.sectionsCovered : []

    const summaryText = String(evidence?.summaryText || '').trim()
        || (facts.length > 0
            ? `FCA Analyst extracted ${facts.length} functional finding(s) across ${sectionsCovered.length} report section(s) from the patient notes and transcripts.`
            : 'FCA Analyst found no functional evidence in the current notes or transcripts. Add clinical notes or transcripts and run analysis again.')

    return {
        generatedAt: new Date().toISOString(),
        generator: 'two-analysis-worker-v2',
        adapter: resolveChatProviderLabel({ provider: payload?.aiUsage?.provider, model }),
        model: String(model || '').trim() || null,
        domain,
        patientId: patient?.id || null,
        patientName: patient?.patient_name || '',
        eventType: job?.event_type || 'analyst_enabled',
        requestedAction: job?.requested_action || 'prepare_fca_suggestions',
        source: String(payload?.source || '').trim() || 'one:patient-agent-toggle',
        summaryText,
        // The analyst's configured focus, or the built-in default. The Analysis tab's "View prompt"
        // action reads this field, so it has to travel with the analysis. The bounds are recorded
        // alongside it because the model's instructions are built from both.
        workerPrompt: String(workerPrompt || '').trim(),
        recommendationBounds: recommendationBounds && typeof recommendationBounds === 'object' ? recommendationBounds : null,
        addressedBounds: addressedBounds && typeof addressedBounds === 'object' ? addressedBounds : null,
        // Report-grade evidence, labelled with FCA report section ids (FCA_REPORT_BLUEPRINT).
        structuredEvidenceFacts: facts,
        sectionEvidence: evidence?.sectionEvidence && typeof evidence.sectionEvidence === 'object' ? evidence.sectionEvidence : {},
        evidenceDomains: sectionsCovered,
        // Kept for the builder's Step 4/5 prefill, now produced by the model rather than a keyword catalog.
        recommendedInterventions: Array.isArray(evidence?.recommendedInterventions) ? evidence.recommendedInterventions : [],
        addressedInterventions: Array.isArray(evidence?.addressedInterventions) ? evidence.addressedInterventions : [],
        sourceStats: {
            notesLength: Number(sourceStats.notesLength || 0),
            transcriptCount: Number(sourceStats.transcriptCount || 0),
            transcriptSummaryCount: Number(sourceStats.transcriptSummaryCount || 0),
            notesIncludedLength: Number(sourceStats.notesIncludedLength || 0),
            transcriptEvidenceLength: Number(sourceStats.transcriptEvidenceLength || 0),
            documentIds: Array.isArray(sourceStats.documentIds) ? sourceStats.documentIds : [],
            documentNames: Array.isArray(sourceStats.documentNames) ? sourceStats.documentNames : [],
            documentLength: Number(sourceStats.documentLength || 0),
            sourceSentenceCount: Number(sourceStats.sourceSentenceCount || 0),
            sourceWordCount: Number(sourceStats.sourceWordCount || 0),
        },
        upstreamPayload: payload,
    }
}

/**
 * Run the analyst.
 *
 * Model-only by design: without a usable AI key this throws rather than degrading to the old
 * keyword catalog, because a keyword catalog cannot produce report-grade evidence. The job's
 * normal retry/backoff applies, and the failure is visible in the Analysis tab.
 */
export async function buildPatientAnalysis({
    patient,
    domain,
    job,
    payload,
    transcripts,
    notesText,
    aiUsage,
    fetchImpl,
}) {
    const patientMetadata = parseJsonObject(patient?.metadata)
    const analysisConfig = resolveAnalysisConfig({ metadata: patientMetadata, payload })
    const recommendationBounds = resolveAnalysisRecommendationBounds({ metadata: patientMetadata, payload })
    const addressedBounds = resolveAnalysisAddressedBounds({ metadata: patientMetadata, payload })
    const workerPrompt = resolveAnalysisWorkerPrompt({ metadata: patientMetadata, payload })

    // The notes come from the Notes entity (`notesText`), never from patient metadata - there is
    // only one Notes entity.
    const notes = normalizeText(notesText, 120000)
    const transcriptEvidence = buildTranscriptEvidenceBlock(transcripts)
    // Reference documents in scope travel on the job payload, already extracted: the worker service
    // has no DOCX reader, so the app that owns the file store produces their text.
    const evidenceDocuments = normalizeEvidenceDocuments(payload?.documents)

    // Everything that identifies the patient, collected once and used to scrub the notes,
    // transcripts and evidence documents before they are sent.
    const fundingSource = String(payload?.fundingSource || patientMetadata?.fundingSource || '').trim()
    const identity = buildIdentityBlockFromPatient(patient, { fundingSource })

    const { payload: evidence, model } = await generateAnalysisEvidenceWithOpenAi({
        notes,
        transcriptEvidence,
        evidenceDocuments,
        identity,
        subjectNoun: resolveSubjectNoun({ fundingSource: identity.fundingSource }),
        workerPrompt,
        additionalInstructions: String(analysisConfig.additionalInstructions || '').trim(),
        recommendationBounds,
        addressedBounds,
        model: aiUsage?.model,
        provider: aiUsage?.provider,
        baseUrl: aiUsage?.baseUrl,
        apiKey: aiUsage?.apiKey,
        fetchImpl,
    })

    const documentText = evidenceDocuments.map((document) => document.text).join('\n')
    const sourceText = [notes, transcriptEvidence, documentText].filter(Boolean).join('\n')

    return buildPatientAnalysisFromEvidence({
        patient,
        domain,
        job,
        payload,
        evidence,
        model,
        workerPrompt,
        recommendationBounds,
        addressedBounds,
        sourceStats: {
            notesLength: notes.length,
            transcriptCount: Array.isArray(transcripts) ? transcripts.length : 0,
            transcriptSummaryCount: (Array.isArray(transcripts) ? transcripts : [])
                .filter((item) => String(item?.transcript_summary_text || '').trim()).length,
            notesIncludedLength: Math.min(notes.length, FCA_ANALYSIS_NOTES_CHARS),
            transcriptEvidenceLength: transcriptEvidence.length,
            // The documents are part of what the analysis was built from, so their identity and
            // size belong in sourceStats: without them, flagging or unflagging a file would leave
            // the analysis looking current when it is not.
            documentIds: evidenceDocuments.map((document) => document.id).filter((id) => id !== null),
            documentNames: evidenceDocuments.map((document) => document.fileName),
            documentLength: documentText.length,
            sourceSentenceCount: sentenceSplit(sourceText).length,
            sourceWordCount: wordCount(sourceText),
        },
    })
}

async function upsertPatientAnalysisPostgres(connection, table, analysis) {
    const result = await connection.query(
        `
      INSERT INTO ${table} (
        domain,
        patient_id,
        patient_name,
        status,
        summary_text,
        analysis_payload_json,
        last_job_id,
        source_notes_length,
        transcript_count,
        created_at,
        updated_at
      ) VALUES (
        $1,
        $2,
        $3,
        'ready',
        $4,
        $5,
        $6,
        $7,
        $8,
        NOW(),
        NOW()
      )
      ON CONFLICT (domain, patient_id)
      DO UPDATE SET
        patient_name = EXCLUDED.patient_name,
        status = 'ready',
        summary_text = EXCLUDED.summary_text,
        analysis_payload_json = EXCLUDED.analysis_payload_json,
        last_job_id = EXCLUDED.last_job_id,
        source_notes_length = EXCLUDED.source_notes_length,
        transcript_count = EXCLUDED.transcript_count,
        updated_at = NOW()
      RETURNING id
    `,
        [
            analysis.domain,
            analysis.patientId,
            analysis.patientName,
            analysis.summaryText,
            JSON.stringify(analysis.payload),
            analysis.lastJobId,
            analysis.sourceNotesLength,
            analysis.transcriptCount
        ]
    )

    return result?.rows?.[0]?.id || null
}

async function upsertPatientAnalysisMySql(connection, table, analysis) {
    const [result] = await connection.execute(
        `
      INSERT INTO ${table} (
        domain,
        patient_id,
        patient_name,
        status,
        summary_text,
        analysis_payload_json,
        last_job_id,
        source_notes_length,
        transcript_count,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, 'ready', ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
      ON DUPLICATE KEY UPDATE
        patient_name = VALUES(patient_name),
        status = 'ready',
        summary_text = VALUES(summary_text),
        analysis_payload_json = VALUES(analysis_payload_json),
        last_job_id = VALUES(last_job_id),
        source_notes_length = VALUES(source_notes_length),
        transcript_count = VALUES(transcript_count),
        updated_at = UTC_TIMESTAMP()
    `,
        [
            analysis.domain,
            analysis.patientId,
            analysis.patientName,
            analysis.summaryText,
            JSON.stringify(analysis.payload),
            analysis.lastJobId,
            analysis.sourceNotesLength,
            analysis.transcriptCount
        ]
    )

    return result?.insertId || null
}

async function processAnalysisJobLocally(connection, dbType, analysisTable, row, payload) {
    const domain = String(row?.domain || payload?.domain || '').trim().toLowerCase()
    const patientId = Number.parseInt(String(row?.patient_id || payload?.patientId || payload?.patient_id || ''), 10)

    if (!domain) {
        throw new Error('Analysis job missing domain')
    }
    if (!Number.isFinite(patientId) || patientId <= 0) {
        throw new Error('Analysis job missing valid patient_id')
    }

    const context = dbType === 'postgresql'
        ? await fetchPatientContextPostgres(connection, domain, patientId)
        : await fetchPatientContextMySql(connection, domain, patientId)

    if (!context.patient) {
        throw new Error(`Patient not found for domain=${domain}, patient_id=${patientId}`)
    }

    const transcriptSummaryCount = Number.parseInt(String(context?.transcriptSummaryCount || '0'), 10) || 0
    if (hasAnyTranscriptText(context.transcripts) && transcriptSummaryCount <= 0) {
        const enqueueResult = await enqueueMissingTranscriptSummaryJobs({
            connection,
            dbType,
            domain,
            patientId,
            patientName: context.patient.patient_name,
            transcripts: context.transcripts,
        })
        throw new DeferredRetryAnalysisError(
            `Analysis deferred: waiting for transcript summaries. eligible=${enqueueResult.eligibleCount}, queued_now=${enqueueResult.queuedCount}.`
        )
    }

    // The model is the analyst's only evidence engine, so an unreachable provider surfaces as a
    // failed job (with the usual retry/backoff) rather than a keyword-catalog fallback.
    const analysisPayload = await buildPatientAnalysis({
        patient: context.patient,
        domain,
        job: row,
        payload,
        transcripts: context.transcripts,
        notesText: context.notesText,
        aiUsage: payload?.aiUsage && typeof payload.aiUsage === 'object' && !Array.isArray(payload.aiUsage)
            ? payload.aiUsage
            : {},
    })

    const analysisId = dbType === 'postgresql'
        ? await upsertPatientAnalysisPostgres(connection, analysisTable, {
            domain,
            patientId,
            patientName: context.patient.patient_name,
            summaryText: analysisPayload.summaryText,
            payload: analysisPayload,
            lastJobId: row.id,
            sourceNotesLength: analysisPayload.sourceStats.notesLength,
            transcriptCount: analysisPayload.sourceStats.transcriptCount
        })
        : await upsertPatientAnalysisMySql(connection, analysisTable, {
            domain,
            patientId,
            patientName: context.patient.patient_name,
            summaryText: analysisPayload.summaryText,
            payload: analysisPayload,
            lastJobId: row.id,
            sourceNotesLength: analysisPayload.sourceStats.notesLength,
            transcriptCount: analysisPayload.sourceStats.transcriptCount
        })

    return {
        analysisId,
        patientName: context.patient.patient_name
    }
}

function getBackoffSeconds(attempt, config) {
    const exponent = Math.max(0, attempt - 1)
    const seconds = config.retryBaseSeconds * (2 ** exponent)
    return Math.min(seconds, config.retryMaxSeconds)
}

async function markCompletedPostgres(connection, table, rowId) {
    await connection.query(
        `
      UPDATE ${table}
      SET status = 'completed',
          completed_at = NOW(),
          error_message = NULL,
          updated_at = NOW()
      WHERE id = $1
    `,
        [rowId]
    )
}

async function markCompletedMySql(connection, table, rowId) {
    await connection.execute(
        `
      UPDATE ${table}
      SET status = 'completed',
          completed_at = UTC_TIMESTAMP(),
          error_message = NULL,
          updated_at = UTC_TIMESTAMP()
      WHERE id = ?
    `,
        [rowId]
    )
}

async function markFailedPostgres(connection, table, id, errorMessage, attempts, maxAttempts, nextRetrySeconds) {
    const shouldFail = attempts >= maxAttempts
    const status = shouldFail ? 'failed' : 'queued'

    // `$3` is used both as an assignment target and in the CASE comparison below, so
    // both uses need an explicit ::text cast. Without them Postgres deduces
    // `character varying` from the assignment and `text` from `$3 = 'queued'` and
    // rejects the whole statement with 42P08 "inconsistent types deduced for
    // parameter $3" - which leaves the job stuck in `processing` (UI: "Working").
    await connection.query(
        `
      UPDATE ${table}
      SET attempts = $2::integer,
          status = $3::text,
          error_message = $4,
          next_attempt_at = CASE WHEN $3::text = 'queued' THEN NOW() + ($5::integer || ' seconds')::interval ELSE NULL END,
          updated_at = NOW()
      WHERE id = $1::bigint
    `,
        [id, attempts, status, errorMessage, Math.max(0, Math.floor(Number(nextRetrySeconds) || 0))]
    )
}

async function markFailedMySql(connection, table, id, errorMessage, attempts, maxAttempts, nextRetrySeconds) {
    const shouldFail = attempts >= maxAttempts
    await connection.execute(
        `
      UPDATE ${table}
      SET attempts = ?,
          status = ?,
          error_message = ?,
          next_attempt_at = CASE WHEN ? = 'queued' THEN DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND) ELSE NULL END,
          updated_at = UTC_TIMESTAMP()
      WHERE id = ?
    `,
        [attempts, shouldFail ? 'failed' : 'queued', errorMessage, shouldFail ? 'failed' : 'queued', nextRetrySeconds, id]
    )
}

async function claimMessagesPostgres(connection, table, batchSize, workerId, defaultMaxAttempts) {
    const sql = `
    WITH candidate AS (
      SELECT id
      FROM ${table}
      WHERE status = 'queued'
        AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
        AND COALESCE(attempts, 0) < COALESCE(max_attempts, $1)
      ORDER BY created_at ASC
      LIMIT $2
      FOR UPDATE SKIP LOCKED
    )
    UPDATE ${table} AS q
    SET status = 'processing',
        claimed_at = NOW(),
        claimed_by = $3,
        updated_at = NOW()
    FROM candidate
    WHERE q.id = candidate.id
    RETURNING q.*
  `

    const result = await connection.query(sql, [defaultMaxAttempts, batchSize, workerId])
    return result.rows || []
}

async function claimMessagesMySql(connection, table, batchSize, workerId, defaultMaxAttempts) {
    await connection.beginTransaction()

    try {
        const [rows] = await connection.execute(
            `
        SELECT id
        FROM ${table}
        WHERE status = 'queued'
          AND (next_attempt_at IS NULL OR next_attempt_at <= UTC_TIMESTAMP())
          AND COALESCE(attempts, 0) < COALESCE(max_attempts, ?)
        ORDER BY created_at ASC
        LIMIT ?
        FOR UPDATE SKIP LOCKED
      `,
            [defaultMaxAttempts, batchSize]
        )

        const ids = rows.map((row) => row.id)
        if (ids.length === 0) {
            await connection.commit()
            return []
        }

        const placeholders = ids.map(() => '?').join(', ')
        await connection.execute(
            `
        UPDATE ${table}
        SET status = 'processing',
            claimed_at = UTC_TIMESTAMP(),
            claimed_by = ?,
            updated_at = UTC_TIMESTAMP()
        WHERE id IN (${placeholders})
      `,
            [workerId, ...ids]
        )

        const [claimedRows] = await connection.execute(
            `SELECT * FROM ${table} WHERE id IN (${placeholders})`,
            ids
        )

        await connection.commit()
        return claimedRows || []
    } catch (error) {
        await connection.rollback()
        throw error
    }
}

async function reclaimStaleProcessingPostgres(connection, table, staleProcessingMinutes) {
    const result = await connection.query(
        `
      UPDATE ${table}
      SET status = 'queued',
          claimed_at = NULL,
          claimed_by = NULL,
          updated_at = NOW()
      WHERE status = 'processing'
        AND claimed_at IS NOT NULL
        AND claimed_at <= NOW() - ($1 || ' minutes')::interval
      RETURNING id
    `,
        [staleProcessingMinutes]
    )
    return result.rowCount || 0
}

async function reclaimStaleProcessingMySql(connection, table, staleProcessingMinutes) {
    const [result] = await connection.execute(
        `
      UPDATE ${table}
      SET status = 'queued',
          claimed_at = NULL,
          claimed_by = NULL,
          updated_at = UTC_TIMESTAMP()
      WHERE status = 'processing'
        AND claimed_at IS NOT NULL
        AND claimed_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)
    `,
        [staleProcessingMinutes]
    )
    return result?.affectedRows || 0
}

export async function runAnalysisWorkerCycle(options = {}) {
    const forceRun = options && typeof options === 'object' && options.forceRun === true
    const config = getConfig()
    if (!config.enabled && !forceRun) {
        return { skipped: true, reason: 'disabled' }
    }

    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql' && dbType !== 'mysql') {
        return { skipped: true, reason: `unsupported-db:${dbType || 'none'}` }
    }

    const workerId = `two-analysis-worker-${process.pid}`
    let connection = null

    try {
        connection = await getDatabaseConnection()
        await ensureAnalysisQueueTable(connection, dbType, config.table)
        const analysisTable = resolvePatientAnalysisTableName()
        await ensurePatientAnalysisTable(connection, dbType, analysisTable)

        const reclaimed = dbType === 'postgresql'
            ? await reclaimStaleProcessingPostgres(connection, config.table, config.staleProcessingMinutes)
            : await reclaimStaleProcessingMySql(connection, config.table, config.staleProcessingMinutes)

        const claimed = dbType === 'postgresql'
            ? await claimMessagesPostgres(connection, config.table, config.batchSize, workerId, config.defaultMaxAttempts)
            : await claimMessagesMySql(connection, config.table, config.batchSize, workerId, config.defaultMaxAttempts)

        if (claimed.length === 0) {
            return {
                skipped: true,
                reason: reclaimed > 0 ? 'reclaimed-only' : 'empty',
                reclaimed
            }
        }

        let completedCount = 0
        let failedCount = 0

        for (const row of claimed) {
            const attempts = Number(row.attempts || 0) + 1
            const maxAttempts = Number(row.max_attempts || config.defaultMaxAttempts)

            try {
                const payload = parsePayload(row)
                await processAnalysisJobLocally(connection, dbType, analysisTable, row, payload)

                if (dbType === 'postgresql') {
                    await markCompletedPostgres(connection, config.table, row.id)
                } else {
                    await markCompletedMySql(connection, config.table, row.id)
                }

                completedCount += 1
            } catch (error) {
                let nextRetrySeconds = getBackoffSeconds(attempts, config)
                const safeErrorMessage = truncateText(error?.message || 'Analysis worker failed')
                const attemptsToPersist = isDeferredRetryError(error)
                    ? Math.max(0, attempts - 1)
                    : attempts
                if (isDeferredRetryError(error)) {
                    nextRetrySeconds = Math.max(nextRetrySeconds, Number(error?.retrySeconds || 120))
                }

                if (dbType === 'postgresql') {
                    await markFailedPostgres(connection, config.table, row.id, safeErrorMessage, attemptsToPersist, maxAttempts, nextRetrySeconds)
                } else {
                    await markFailedMySql(connection, config.table, row.id, safeErrorMessage, attemptsToPersist, maxAttempts, nextRetrySeconds)
                }

                failedCount += 1
            }
        }

        return {
            skipped: false,
            forced: forceRun,
            reclaimed,
            claimed: claimed.length,
            completed: completedCount,
            failed: failedCount
        }
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        } else if (connection?.close) {
            await connection.close().catch(() => { })
        }
    }
}

export function startAnalysisWorker() {
    const config = getConfig()

    if (!config.enabled) {
        console.log('ANALYSIS_WORKER_ENABLED=false - analysis worker is disabled')
        return () => { }
    }

    console.log(`ANALYSIS_WORKER_ENABLED=true - analysis worker started (table=${config.table}, poll=${config.pollSeconds}s, batch=${config.batchSize})`)
    console.log(`Analysis worker stale processing timeout: ${config.staleProcessingMinutes} minute(s)`)

    let timer = null
    let stopped = false

    const run = async () => {
        try {
            const result = await runAnalysisWorkerCycle()
            if (!result.skipped) {
                console.log(`[${new Date().toISOString()}] Analysis worker cycle: reclaimed=${result.reclaimed || 0}, claimed=${result.claimed}, completed=${result.completed}, failed=${result.failed}`)
            } else if ((result.reclaimed || 0) > 0) {
                console.log(`[${new Date().toISOString()}] Analysis worker cycle: reclaimed=${result.reclaimed}, no new analysis jobs claimed yet`)
            }
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Analysis worker cycle failed: ${error?.message || error}`)
        }
    }

    const bootstrap = async () => {
        try {
            if (stopped) return

            await run()
            timer = setInterval(() => {
                run().catch(() => { })
            }, config.pollSeconds * 1000)
        } catch (error) {
            console.error(`[startup] Analysis worker did not start cycles: ${error?.message || error}`)
        }
    }

    bootstrap().catch(() => { })

    return () => {
        stopped = true
        if (timer) {
            clearInterval(timer)
        }
    }
}

export default {
    startAnalysisWorker,
    runAnalysisWorkerCycle
}