import { detectDatabaseType, getDatabaseConnection } from '../database.js'
import { ensureReportQueueTable, resolveReportQueueTableName } from './reportQueue.js'
import { ensureScribeQueueTable, resolveScribeQueueTableName } from './scribeQueue.js'
import { extractBuilderFormData, generateFcaReportDraft, isFcaReportType, resolveTranscriptSelection } from './fcaReportGeneration.js'
import { requestChatCompletion, resolveChatApiKey, resolveChatProviderLabel, isUnsupportedChatProvider } from './chatModelRequest.js'
import {
    EGRESS_CHANNEL_REPORT,
    buildIdentityBlockFromPatient,
    guardOutgoingChat,
    resolveSubjectNoun,
    restoreIdentityDeep,
} from '../privacy/index.js'

const DEFAULT_BATCH_SIZE = 10
const DEFAULT_POLL_SECONDS = 200
const DEFAULT_MAX_ATTEMPTS = 5
const DEFAULT_RETRY_BASE_SECONDS = 30
const DEFAULT_RETRY_MAX_SECONDS = 1800
const DEFAULT_STALE_PROCESSING_MINUTES = 15
const DEFAULT_FORMAL_REPORTS_TABLE = 'patient_reports'
const DEFAULT_REPORT_DRAFTS_TABLE = 'patient_report_drafts'
const DEFAULT_SCRIBE_SUMMARIES_TABLE = 'patient_transcript_summaries'
const DEFAULT_REPORT_MODEL = 'gpt-4.1-mini'
const OTF10_REPORT_TYPE_HINTS = ['otf10', 'home-services-review', 'home services review']
// Must match FCA_SCRIBE_SUMMARY_STYLE in ./scribeWorker.js.
const FCA_SCRIBE_SUMMARY_STYLE = 'fca-functional-capacity'
const DEFAULT_HSR_CREATOR_WORKER_PROMPT = 'You are an occupational therapist completing a TAC OTF10 Home Services Review draft. Use only the supplied Patient Notes and transcript Summary. Do not invent facts, dates, services, equipment, hours, contacts, or clinical findings.'

// Standard (non-batch, short-context) list prices in USD per million tokens, verified on
// 2026-11-04 against https://platform.claude.com/docs/en/about-claude/pricing and
// https://developers.openai.com/api/docs/pricing. The same table lives in the app's
// src/app/api/settings/domains/ai-usage/route.js - keep the two in step.
//
// Long-context and >100k-prompt bands are deliberately not modelled: these calls stay inside the
// short-context band, where the listed rate is the one actually charged. A model missing from this
// table is priced as DEFAULT_REPORT_MODEL, which understates anything expensive - add the row
// rather than relying on the fallback.
const MODEL_PRICING_USD_PER_MILLION = {
    // Claude
    'claude-fable-5-1': { input: 10.0, output: 50.0 },
    'claude-fable-5': { input: 10.0, output: 50.0 },
    'claude-opus-5-5': { input: 4.0, output: 20.0 },
    'claude-opus-5': { input: 5.0, output: 25.0 },
    'claude-opus-4-8': { input: 5.0, output: 25.0 },
    'claude-opus-4-7': { input: 5.0, output: 25.0 },
    'claude-opus-4-6': { input: 5.0, output: 25.0 },
    'claude-opus-4-5': { input: 5.0, output: 25.0 },
    'claude-sonnet-5-5': { input: 2.0, output: 10.0 },
    'claude-sonnet-5': { input: 2.0, output: 10.0 },
    'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
    'claude-sonnet-4-5': { input: 3.0, output: 15.0 },
    'claude-haiku-5-5': { input: 0.1, output: 0.5 },
    'claude-haiku-4-5': { input: 1.0, output: 5.0 },
    // OpenRouter (namespaced ids; rates read from GET /v1/models on 2026-11-04)
    'moonshotai/kimi-k3': { input: 0.2, output: 16.0 },
    'qwen/qwen3.8-2.4t-a95b': { input: 2.0, output: 6.0 },
    'minimax/minimax-m3.1-flash': { input: 0.15, output: 0.6 },
    'xiaomi/mimo-v2.6-pro': { input: 0.43, output: 0.87 },
    'z-ai/glm-5.3': { input: 0.08, output: 3.6 },
    // OpenAI
    'gpt-5.6-sol': { input: 4.0, output: 20.0 },
    'gpt-5.6-terra': { input: 2.0, output: 12.0 },
    'gpt-5.6-luna': { input: 0.2, output: 1.2 },
    'gpt-5.5': { input: 5.0, output: 30.0 },
    'gpt-5.4': { input: 2.5, output: 15.0 },
    'gpt-5.4-mini': { input: 0.75, output: 4.5 },
    'gpt-5.4-nano': { input: 0.2, output: 1.25 },
    'gpt-5.2': { input: 1.75, output: 14.0 },
    'gpt-5.1': { input: 1.25, output: 10.0 },
    'gpt-5': { input: 1.25, output: 10.0 },
    'gpt-5-mini': { input: 0.25, output: 2.0 },
    'gpt-5-nano': { input: 0.05, output: 0.4 },
    'gpt-4.1': { input: 2.0, output: 8.0 },
    'gpt-4.1-mini': { input: 0.4, output: 1.6 },
    'gpt-4o': { input: 2.5, output: 10.0 },
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
}

class DeferredRetryReportError extends Error {
    constructor(message) {
        super(message)
        this.name = 'DeferredRetryReportError'
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

function hasAnyTranscriptText(transcripts) {
    return (Array.isArray(transcripts) ? transcripts : []).some((item) => String(item?.transcript_text || '').trim())
}

// Transcripts that still need an FCA summary: not excluded by the builder, not already summarised
// in the FCA style, and not supplied by the clinician at Step 8. Anything left here would leave a
// gap in the report evidence, so the job defers until it is filled.
function findTranscriptsMissingFcaSummary(transcripts, builderFormData) {
    const selection = resolveTranscriptSelection(builderFormData)

    return (Array.isArray(transcripts) ? transcripts : []).filter((item) => {
        const id = String(item?.id ?? '').trim()
        if (selection.excludedIds.has(id)) return false
        if (selection.summaryOverrides.has(id)) return false
        return !String(item?.transcript_fca_summary_text || '').trim()
    })
}

function isDeferredRetryError(error) {
    return error instanceof DeferredRetryReportError
}

// Style -> the transcript field carrying that style's summary. An unlisted style falls back to
// the generic summary. Every report-specific style MUST be listed here: if the wrong field is
// read, this helper reports nothing missing while the report keeps deferring forever waiting for
// a summary the enqueue never requested.
const SUMMARY_STYLE_TRANSCRIPT_FIELDS = {
    'otf10-home-services': 'transcript_otf10_summary_text',
    [FCA_SCRIBE_SUMMARY_STYLE]: 'transcript_fca_summary_text',
}

function resolveMissingSummaryTranscriptionIds(transcripts, summaryStyle) {
    const ids = []
    const seen = new Set()
    const summaryField = SUMMARY_STYLE_TRANSCRIPT_FIELDS[String(summaryStyle || '').trim()] || 'transcript_summary_text'

    for (const item of Array.isArray(transcripts) ? transcripts : []) {
        const transcriptText = String(item?.transcript_text || '').trim()
        if (!transcriptText) continue
        if (String(item?.[summaryField] || '').trim()) continue

        const transcriptionId = Number.parseInt(String(item?.id || ''), 10)
        if (!Number.isFinite(transcriptionId) || transcriptionId <= 0) continue
        if (seen.has(transcriptionId)) continue
        seen.add(transcriptionId)
        ids.push(transcriptionId)
    }

    return ids
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
            'fca_summary_prereq',
            'summarize_transcript',
            json_build_object(
                'domain', $1::text,
                'patientId', $2::bigint,
                'patientName', $3::text,
                'transcriptionId', candidate.transcription_id,
                'source', 'two:report-worker-fca-prereq',
                'scribeConfig', json_build_object('summaryStyle', COALESCE($5::text, 'topic-bullets-third-person')),
                'aiUsage', json_build_object('model', $6::text, 'provider', $7::text, 'baseUrl', $8::text)
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
                 AND s.summary_style = COALESCE($5::text, 'topic-bullets-third-person')
        WHERE s.id IS NULL
          AND NOT EXISTS (
                SELECT 1
                FROM ${queueTable} q
                WHERE q.domain = $1::text
                  AND q.patient_id = $2::bigint
                  AND q.transcription_id = candidate.transcription_id
                  AND q.status IN ('queued', 'processing')
                  -- Only an in-flight job for the SAME style makes this one redundant. A queued
                  -- generic summary must not suppress a report-specific style request, because
                  -- dropping that request leaves the report deferring forever.
                  AND COALESCE(NULLIF(q.payload_json, '')::jsonb->'scribeConfig'->>'summaryStyle', 'topic-bullets-third-person')
                      = COALESCE($5::text, 'topic-bullets-third-person')
          )
        RETURNING id
    `,
        [
            params.domain,
            params.patientId,
            params.patientName || null,
            params.transcriptionIds,
            params.summaryStyle || null,
            params.aiUsage?.model || null,
            params.aiUsage?.provider || null,
            params.aiUsage?.baseUrl || null,
        ]
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
            'fca_summary_prereq',
            'summarize_transcript',
            JSON_OBJECT(
                'domain', ?,
                'patientId', ?,
                'patientName', ?,
                'transcriptionId', t.id,
                'source', 'two:report-worker-fca-prereq',
                'scribeConfig', JSON_OBJECT('summaryStyle', ?),
                'aiUsage', JSON_OBJECT('model', ?, 'provider', ?, 'baseUrl', ?)
            ),
            0,
            UTC_TIMESTAMP(),
            UTC_TIMESTAMP()
        FROM patient_transcriptions t
        LEFT JOIN ${summariesTable} s
          ON s.domain = ?
         AND s.transcription_id = t.id
                 AND s.summary_style = ?
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
                  -- See the Postgres variant: the in-flight job must match the summary style.
                  AND COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(q.payload_json, '$.scribeConfig.summaryStyle')), ''), 'topic-bullets-third-person')
                      = ?
          )
    `,
        [
            params.domain,
            params.patientId,
            params.patientName || null,
            params.domain,
            params.patientId,
            params.patientName || null,
            params.summaryStyle || 'topic-bullets-third-person',
            params.aiUsage?.model || null,
            params.aiUsage?.provider || null,
            params.aiUsage?.baseUrl || null,
            params.domain,
            params.summaryStyle || 'topic-bullets-third-person',
            params.domain,
            params.patientId,
            ...params.transcriptionIds,
            params.domain,
            params.patientId,
            params.summaryStyle || 'topic-bullets-third-person',
        ]
    )

    return result?.affectedRows || 0
}

async function enqueueMissingTranscriptSummaryJobs({ connection, dbType, domain, patientId, patientName, transcripts, summaryStyle, aiUsage }) {
    const transcriptionIds = resolveMissingSummaryTranscriptionIds(transcripts, summaryStyle)
    if (transcriptionIds.length === 0) {
        return { eligibleCount: 0, queuedCount: 0 }
    }

    const queueTable = resolveScribeQueueTableName()
    const summariesTable = resolveScribeSummariesTableName()
    await ensureScribeQueueTable(connection, dbType, queueTable)

    // Only the non-secret model context travels to the scribe queue; the worker resolves the
    // API key from its own environment.
    const scribeAiUsage = {
        model: String(aiUsage?.model || '').trim() || null,
        provider: String(aiUsage?.provider || '').trim() || null,
        baseUrl: String(aiUsage?.baseUrl || '').trim() || null,
    }

    const queuedCount = dbType === 'postgresql'
        ? await enqueueTranscriptSummaryJobsPostgres(connection, queueTable, summariesTable, {
            domain,
            patientId,
            patientName,
            transcriptionIds,
            summaryStyle,
            aiUsage: scribeAiUsage,
        })
        : await enqueueTranscriptSummaryJobsMySql(connection, queueTable, summariesTable, {
            domain,
            patientId,
            patientName,
            transcriptionIds,
            summaryStyle,
            aiUsage: scribeAiUsage,
        })

    return {
        eligibleCount: transcriptionIds.length,
        queuedCount,
    }
}

function getConfig() {
    return {
        enabled: isTrue(process.env.REPORT_WORKER_ENABLED || 'false'),
        table: resolveReportQueueTableName(),
        batchSize: parsePositiveInt(process.env.REPORT_BATCH_SIZE, DEFAULT_BATCH_SIZE),
        pollSeconds: parsePositiveInt(process.env.REPORT_POLL_SECONDS, DEFAULT_POLL_SECONDS),
        defaultMaxAttempts: parsePositiveInt(process.env.REPORT_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS),
        retryBaseSeconds: parsePositiveInt(process.env.REPORT_RETRY_BASE_SECONDS, DEFAULT_RETRY_BASE_SECONDS),
        retryMaxSeconds: parsePositiveInt(process.env.REPORT_RETRY_MAX_SECONDS, DEFAULT_RETRY_MAX_SECONDS),
        staleProcessingMinutes: parsePositiveInt(
            process.env.REPORT_STALE_PROCESSING_MINUTES,
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

function truncateLongText(value, maxLength = 120000) {
    if (!value) return ''
    const text = String(value)
    if (text.length <= maxLength) return text
    return `${text.slice(0, maxLength)}\n\n[truncated ${text.length - maxLength} chars]`
}

function estimateTokensFromText(value) {
    const text = String(value || '').trim()
    if (!text) return 0
    return Math.max(1, Math.ceil(text.length / 4))
}

function resolvePricing(modelName) {
    const normalizedModel = String(modelName || '').trim().toLowerCase()
    const direct = MODEL_PRICING_USD_PER_MILLION[normalizedModel]
    if (direct) return direct
    // A dated alias (`claude-sonnet-4-5-20250929`) is the same model at the same price.
    const undated = normalizedModel.replace(/-\d{8}$/, '')
    return MODEL_PRICING_USD_PER_MILLION[undated] || MODEL_PRICING_USD_PER_MILLION[DEFAULT_REPORT_MODEL]
}

function resolveUsageModel(payload) {
    const payloadModel = String(payload?.aiUsage?.model || '').trim()
    return payloadModel || DEFAULT_REPORT_MODEL
}

function finiteOrNull(value) {
    if (value === null || value === undefined || value === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

function buildReportUsage({ sourceNotes, reportMarkdown, model, providerUsage }) {
    const pricing = resolvePricing(model)
    const reportedInput = finiteOrNull(providerUsage?.inputTokens)
    const reportedOutput = finiteOrNull(providerUsage?.outputTokens)

    // When the provider tells us what it charged for, that beats any estimate: reasoning tokens
    // never appear in the finished markdown, so a text-length estimate badly understates them.
    if (reportedInput !== null || reportedOutput !== null) {
        const inputTokens = reportedInput ?? 0
        const outputTokens = reportedOutput ?? 0
        const reportedCost = finiteOrNull(providerUsage?.costUsd)
        return {
            model,
            inputTokens,
            outputTokens,
            totalTokens: finiteOrNull(providerUsage?.totalTokens) ?? inputTokens + outputTokens,
            // Only some hosts report the charge; the rest are priced from the token counts.
            estimatedCostUsd: reportedCost !== null && reportedCost > 0
                ? reportedCost
                : ((inputTokens * pricing.input) + (outputTokens * pricing.output)) / 1000000,
            reasoningTokens: finiteOrNull(providerUsage?.reasoningTokens) ?? 0,
            source: 'provider-usage'
        }
    }

    const inputTokens = estimateTokensFromText(sourceNotes)
    const outputTokens = estimateTokensFromText(reportMarkdown)
    const totalTokens = inputTokens + outputTokens
    const estimatedCostUsd = ((inputTokens * pricing.input) + (outputTokens * pricing.output)) / 1000000

    return {
        model,
        inputTokens,
        outputTokens,
        totalTokens,
        estimatedCostUsd,
        source: 'estimated-text-length'
    }
}

function isSafeSqlIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ''))
}

function isMissingTableError(error) {
    const message = String(error?.message || '').toLowerCase()
    return message.includes('does not exist')
        || message.includes('unknown table')
        || (message.includes('relation') && message.includes('does not exist'))
}

function resolveFormalReportsTableName() {
    const table = String(process.env.PATIENT_REPORTS_TABLE || DEFAULT_FORMAL_REPORTS_TABLE).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error('PATIENT_REPORTS_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
    }
    return table
}

function resolveReportDraftsTableName() {
    const table = String(process.env.PATIENT_REPORT_DRAFTS_TABLE || DEFAULT_REPORT_DRAFTS_TABLE).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error('PATIENT_REPORT_DRAFTS_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
    }
    return table
}

function resolveScribeSummariesTableName() {
    const table = String(process.env.PATIENT_TRANSCRIPT_SUMMARIES_TABLE || DEFAULT_SCRIBE_SUMMARIES_TABLE).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error('PATIENT_TRANSCRIPT_SUMMARIES_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
    }
    return table
}

function enrichTranscriptsWithSummaries(transcripts, summaryRows) {
    const items = Array.isArray(transcripts) ? transcripts : []
    const summaries = Array.isArray(summaryRows) ? summaryRows : []
    const summaryByTranscriptionId = new Map()

    for (const row of summaries) {
        const transcriptionId = Number.parseInt(String(row?.transcription_id || ''), 10)
        if (!Number.isFinite(transcriptionId) || transcriptionId <= 0) continue

        const summaryStyle = String(row?.summary_style || '').trim() || 'topic-bullets-third-person'
        const current = summaryByTranscriptionId.get(transcriptionId) || {}
        summaryByTranscriptionId.set(transcriptionId, {
            ...current,
            summaryText: summaryStyle === 'topic-bullets-third-person' ? String(row?.summary_text || '').trim() : current.summaryText || '',
            otf10SummaryText: summaryStyle === 'otf10-home-services' ? String(row?.summary_text || '').trim() : current.otf10SummaryText || '',
            fcaSummaryText: summaryStyle === FCA_SCRIBE_SUMMARY_STYLE ? String(row?.summary_text || '').trim() : current.fcaSummaryText || '',
            summaryPayload: summaryStyle === 'topic-bullets-third-person' ? parseJsonObject(row?.summary_payload_json) : current.summaryPayload || {},
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
            transcript_otf10_summary_text: String(summary?.otf10SummaryText || '').trim(),
            transcript_fca_summary_text: String(summary?.fcaSummaryText || '').trim(),
            transcript_summary_payload: summary?.summaryPayload || {},
            transcript_fca_summary_payload: summary?.fcaSummaryPayload || {},
            transcript_summary_updated_at: summary?.updatedAt || null,
        }
    })
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

function isTextTemplateMimeType(mimeType) {
    const normalized = String(mimeType || '').trim().toLowerCase()
    if (!normalized) return false
    if (normalized.startsWith('text/')) return true
    if (normalized.includes('markdown')) return true
    if (normalized.includes('html')) return true
    return false
}

function decodeTemplateContentBase64(base64Value) {
    const normalized = String(base64Value || '').trim()
    if (!normalized) return ''
    try {
        return Buffer.from(normalized, 'base64').toString('utf8')
    } catch {
        return ''
    }
}

function stripEmbeddedDataImageMarkup(templateSource) {
    let source = String(templateSource || '')
    if (!source) return ''

    source = source.replace(/!\[([^\]]*)\]\(\s*data:image\/[^)\s]+(?:\s+"[^"]*")?\s*\)/gi, (full, alt) => {
        const label = String(alt || '').trim()
        return label ? `[Image: ${label}]` : ''
    })

    source = source.replace(/<img\b[^>]*\bsrc=(['"])data:image\/[^'"]+\1[^>]*>/gi, '')
    return source
}

function resolveTemplateIdFromSettings(settingsObject, requestedReportTypeId = '') {
    const settings = settingsObject && typeof settingsObject === 'object' ? settingsObject : {}
    const reportTypes = Array.isArray(settings.reportTypes) ? settings.reportTypes.filter((item) => item && typeof item === 'object') : []
    const config = settings.config && typeof settings.config === 'object' ? settings.config : {}

    if (reportTypes.length === 0) {
        return ''
    }

    const requested = String(requestedReportTypeId || config.defaultReportTypeId || '').trim()
    const selected = reportTypes.find((item) => String(item?.id || '').trim() === requested) || reportTypes[0]
    return String(selected?.templateId || '').trim()
}

async function loadTemplateSnapshotForJob(connection, dbType, domain, requestedReportTypeId = '') {
    try {
        let settingsJson = null

        if (dbType === 'postgresql') {
            const settingsResult = await connection.query(
                `SELECT settings_json FROM report_domain_settings WHERE domain = $1 LIMIT 1`,
                [domain]
            )
            settingsJson = settingsResult?.rows?.[0]?.settings_json || null
        } else {
            const [settingsRows] = await connection.execute(
                `SELECT settings_json FROM report_domain_settings WHERE domain = ? LIMIT 1`,
                [domain]
            )
            settingsJson = settingsRows?.[0]?.settings_json || null
        }

        const settingsObject = parseJsonObject(settingsJson)
        const templateId = resolveTemplateIdFromSettings(settingsObject, requestedReportTypeId)
        if (!templateId) {
            return null
        }

        let templateRow = null
        if (dbType === 'postgresql') {
            const templateResult = await connection.query(
                `
                    SELECT template_id, name, file_name, mime_type, content_base64
                    FROM report_templates
                    WHERE domain = $1 AND template_id = $2
                    LIMIT 1
                `,
                [domain, templateId]
            )
            templateRow = templateResult?.rows?.[0] || null
        } else {
            const [templateRows] = await connection.execute(
                `
                    SELECT template_id, name, file_name, mime_type, content_base64
                    FROM report_templates
                    WHERE domain = ? AND template_id = ?
                    LIMIT 1
                `,
                [domain, templateId]
            )
            templateRow = templateRows?.[0] || null
        }

        if (!templateRow) {
            return null
        }

        const mimeType = String(templateRow?.mime_type || '').trim()
        if (!isTextTemplateMimeType(mimeType)) {
            return null
        }

        const content = stripEmbeddedDataImageMarkup(decodeTemplateContentBase64(templateRow?.content_base64))
        if (!content) {
            return null
        }

        return {
            id: String(templateRow?.template_id || '').trim() || null,
            name: String(templateRow?.name || '').trim() || null,
            fileName: String(templateRow?.file_name || '').trim() || null,
            mimeType,
            content: content.slice(0, 200000),
            reportConfig: settingsObject?.config && typeof settingsObject.config === 'object'
                ? settingsObject.config
                : {},
        }
    } catch (error) {
        if (isMissingTableError(error)) {
            return null
        }
        throw error
    }
}

function formatTranscriptEntry(entry, index) {
    const title = String(entry?.title || `Transcript ${index + 1}`).trim() || `Transcript ${index + 1}`
    const status = String(entry?.status || '').trim()
    const createdAt = entry?.created_at || entry?.updated_at || null
    const transcriptText = truncateLongText(String(entry?.transcript_text || '').trim(), 12000)

    const parts = []
    parts.push(`### ${title}`)
    if (status || createdAt) {
        const meta = [status ? `Status: ${status}` : '', createdAt ? `Recorded: ${new Date(createdAt).toISOString()}` : '']
            .filter(Boolean)
            .join(' | ')
        parts.push(meta)
    }
    parts.push('')
    parts.push(transcriptText || '(No transcript text available)')
    return parts.join('\n')
}

function splitPatientName(value) {
    const fullName = String(value || '').trim()
    if (!fullName) {
        return { firstName: '', lastName: '' }
    }

    const parts = fullName.split(/\s+/).filter(Boolean)
    if (parts.length === 1) {
        return { firstName: parts[0], lastName: '' }
    }

    return {
        firstName: parts[0],
        lastName: parts.slice(1).join(' ')
    }
}

function replaceTemplateTokenValue(templateSource, tokenName, value) {
    const source = String(templateSource || '')
    const replacement = String(value || '').trim()
    if (!source || !replacement || !tokenName) {
        return source
    }

    const escapedToken = String(tokenName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const tokenPattern = `{{\\s*${escapedToken}\\s*}}`
    if (/_rows$/i.test(tokenName)) {
        const tableBodyPattern = new RegExp(
            `(<tbody\\b[^>]*>)(?:(?!<\\/tbody>)[\\s\\S])*?${tokenPattern}(?:(?!<\\/tbody>)[\\s\\S])*?(<\\/tbody>)`,
            'gi'
        )
        const withReplacedTableBody = source.replace(tableBodyPattern, `$1\n${replacement}\n$2`)
        if (withReplacedTableBody !== source) {
            return withReplacedTableBody
        }
    }

    return source.replace(new RegExp(tokenPattern, 'gi'), replacement)
}

function buildTemplateVariableMap({ patientName, domain, practiceName, notes, jobId, additionalContext, identity = null, reportConfig = null }) {
    const { firstName, lastName } = splitPatientName(patientName)
    const reportDate = new Date().toISOString().slice(0, 10)
    // Templates name the practice, not the domain key it is stored under.
    const practice = String(practiceName || '').trim() || String(domain || '').trim()
    // The cover page names the assessing clinician and the practice contact details. The report
    // settings store them one per line; the template wants a single centred line.
    const providerLines = String(reportConfig?.providerDetails || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)

    return {
        patient_name: String(patientName || '').trim(),
        patient_name_first: firstName,
        patient_name_last: lastName,
        report_date: reportDate,
        domain: String(domain || '').trim(),
        practice_name: practice,
        practice,
        ndis_number: String(identity?.ndisNumber || '').trim(),
        date_of_birth: String(identity?.dateOfBirth || '').trim(),
        address: String(identity?.address || '').trim(),
        provider_name: providerLines[0] || '',
        provider_contact: providerLines.slice(1).join(' · '),
        provider_details: providerLines.join(' · '),
        source_job_id: String(jobId || '').trim(),
        patient_notes: String(notes || '').trim(),
        additional_context: String(additionalContext || '').trim(),
    }
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

const OTF10_TABLE_CELL_STYLE = 'border-top: 0.5pt solid #1E2850; border-left: 0.5pt solid #1E2850; border-bottom: 0.5pt solid #1E2850; border-right: 0.5pt solid #1E2850'

function tableRows(items, fields) {
    return (Array.isArray(items) ? items : [])
        .map((item) => {
            const values = fields.map((field) => escapeHtml(item?.[field]))
            return `<tr>${values.map((value) => `<td style="${OTF10_TABLE_CELL_STYLE}"><p>${value}</p></td>`).join('')}</tr>`
        })
        .join('\n')
}

// OTF10 is a fixed TAC pro-forma: every answer belongs in its own short field. Falling back to
// whole-report prose here previously duplicated the entire draft into ~10 separate fields.
const OTF10_FIELD_UNAVAILABLE = 'Not documented in the available notes or transcript summaries.'

function patientIntakeValue(metadata, answerKeys = [], labels = [], legacyKeys = []) {
    const profile = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}
    const answers = profile.sploseAnswers && typeof profile.sploseAnswers === 'object' && !Array.isArray(profile.sploseAnswers)
        ? profile.sploseAnswers
        : {}
    const labelledAnswers = profile.sploseLabelledAnswers && typeof profile.sploseLabelledAnswers === 'object' && !Array.isArray(profile.sploseLabelledAnswers)
        ? profile.sploseLabelledAnswers
        : {}

    for (const key of answerKeys) {
        const value = String(answers[key] || '').trim()
        if (value) return value
    }

    const normalizedLabels = new Map(
        Object.entries(labelledAnswers).map(([label, value]) => [String(label || '').trim().toLowerCase(), value])
    )
    for (const label of labels) {
        const value = String(normalizedLabels.get(String(label || '').trim().toLowerCase()) || '').trim()
        if (value) return value
    }

    return legacyKeys.map((key) => String(profile[key] || '').trim()).find(Boolean) || ''
}

function buildOtf10VariableMap({ patientMetadata, generatedFields = null, reportConfig = null }) {
    const profile = patientMetadata && typeof patientMetadata === 'object' && !Array.isArray(patientMetadata)
        ? patientMetadata
        : {}
    const profileValue = (...keys) => keys.map((key) => String(profile?.[key] || '').trim()).find(Boolean) || ''
    const config = reportConfig && typeof reportConfig === 'object' && !Array.isArray(reportConfig) ? reportConfig : {}
    const configValue = (...keys) => keys.map((key) => String(config?.[key] || '').trim()).find(Boolean) || ''
    const fieldValue = (key, fallback = '') => String(generatedFields?.[key] || '').trim() || fallback

    return {
        date_of_birth: patientIntakeValue(
            profile,
            ['date_of_birth', 'dob'],
            ['Date of birth'],
            ['dateOfBirth', 'date_of_birth']
        ),
        claim_number: patientIntakeValue(
            profile,
            ['claim_or_reference_number', 'tac_claim_number', 'ndis_number'],
            ['NDIS number/ TAC Claim Number/Work Cover Reference Number'],
            ['claimNumber', 'claim_number', 'ndisNumber', 'ndis_number']
        ),
        accident_date: patientIntakeValue(
            profile,
            ['accident_date_if_tac', 'accident_date'],
            ['Accident date (if TAC)'],
            ['accidentDate', 'accident_date']
        ),
        review_date: new Date().toISOString().slice(0, 10),
        initial_home_services_assessment_date: profileValue('initialHomeServicesAssessmentDate'),
        contributors_rows: tableRows(generatedFields?.contributors, ['name', 'relationship', 'contact', 'date', 'engagement']),
        household_goals: fieldValue('household_goals', OTF10_FIELD_UNAVAILABLE),
        social_situation_changes: fieldValue('social_situation_changes'),
        social_situation_changes_detail: fieldValue('social_situation_changes_detail'),
        functional_capacity_changes: fieldValue('functional_capacity_changes'),
        information_source: fieldValue('information_source', 'Patient notes and transcript summaries.'),
        injury_related_changes: fieldValue('injury_related_changes'),
        household_member_capacity_changes: fieldValue('household_member_capacity_changes'),
        household_member_capacity_details: fieldValue('household_member_capacity_details'),
        cultural_considerations: fieldValue('cultural_considerations', profileValue('culturalConsiderations')),
        funded_support_rows: tableRows(generatedFields?.funded_support, ['task', 'frequency', 'duration', 'justification']),
        assistive_technology_rows: tableRows(generatedFields?.assistive_technology, ['equipmentType', 'supplier', 'trialSummary', 'justification']),
        quotation_details: fieldValue('quotation_details', profileValue('quotationDetails')),
        additional_ot_funding_rows: tableRows(generatedFields?.additional_ot_funding, ['area', 'intervention', 'justification', 'hours']),
        summary_of_plan: fieldValue('summary_of_plan', OTF10_FIELD_UNAVAILABLE),
        further_assessment_recommendation: fieldValue('further_assessment_recommendation'),
        days_hours_available: configValue('daysHoursAvailable') || profileValue('daysHoursAvailable'),
        provider_date: new Date().toISOString().slice(0, 10),
        provider_details: configValue('providerDetails') || profileValue('providerDetails'),
        privacy_statement: '',
    }
}

function isOtf10ReportType(value) {
    const normalized = String(value || '').trim().toLowerCase()
    return OTF10_REPORT_TYPE_HINTS.some((hint) => normalized.includes(hint))
}

function parseJsonResponse(content) {
    const source = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    try {
        const parsed = JSON.parse(source)
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
    } catch {
        return null
    }
}

function summarizeTranscriptEvidence(transcripts) {
    return (Array.isArray(transcripts) ? transcripts : [])
        .map((item) => String(item?.transcript_summary_text || '').trim())
        .filter(Boolean)
        .join('\n\n')
}

function summarizeOtf10TranscriptEvidence(transcripts) {
    return (Array.isArray(transcripts) ? transcripts : [])
        .map((item) => String(item?.transcript_otf10_summary_text || '').trim())
        .filter(Boolean)
        .join('\n\n')
}

function mapToTranscriptSummaries(transcripts) {
    return (Array.isArray(transcripts) ? transcripts : [])
        .map((item, index) => ({
            ...item,
            title: `${String(item?.title || `Transcript ${index + 1}`).trim()} Summary`,
            transcript_text: String(item?.transcript_otf10_summary_text || item?.transcript_summary_text || '').trim(),
        }))
        .filter((item) => item.transcript_text)
}

// Mirrors the concision of real TAC OTF10 forms: each answer is a short paragraph or a few bullets,
// never a full narrative report.
const OTF10_FIELD_STYLE_RULES = [
    'Style rules:',
    '- Each free-text field is a single form answer: at most 120 words, written as 2-6 short bullet lines starting with "- ", or one short paragraph where a list would read oddly.',
    '- Never restate the whole clinical picture in more than one field; answer only what that specific field asks.',
    '- social_situation_changes, functional_capacity_changes and household_member_capacity_changes must be exactly "Yes" or "No"; put the explanation in the matching detail field.',
    '- funded_support rows must state concrete frequency and time (e.g. "Four days per week, 60 minutes per visit") and a review period (e.g. "6 months"); omit the row entirely if the evidence does not support it.',
    '- summary_of_plan must state the support duration and suggested review time in 100 words or fewer.',
    '- Use empty strings or empty arrays when evidence is absent. Never pad a field with generic clinical filler.',
].join('\n')

async function generateOtf10Fields({
    identity,
    subjectNoun = 'participant',
    notes,
    transcripts,
    model,
    provider,
    baseUrl,
    apiKey,
    includeTranscripts = true,
    additionalInstructions = '',
    workerPrompt = '',
}) {
    const normalizedProvider = String(provider || '').trim().toLowerCase()
    const resolvedApiKey = resolveChatApiKey({ provider: normalizedProvider, model, apiKey })
    if (!resolvedApiKey || isUnsupportedChatProvider(normalizedProvider)) {
        return null
    }

    const evidence = [
        `Patient Notes:\n${truncateLongText(notes || 'No Patient Notes available.', 30000)}`,
        includeTranscripts
            ? `Transcript Summary:\n${truncateLongText(summarizeOtf10TranscriptEvidence(transcripts) || summarizeTranscriptEvidence(transcripts) || 'No transcript Summary available.', 30000)}`
            : null,
    ].filter(Boolean).join('\n\n')
    const systemPrompt = [
        String(workerPrompt || '').trim() || DEFAULT_HSR_CREATOR_WORKER_PROMPT,
        includeTranscripts ? null : 'Transcript summaries are intentionally excluded; rely only on the supplied Patient Notes.',
        'Return valid JSON only. Use empty strings or empty arrays when evidence is absent.',
        String(additionalInstructions || '').trim() || null,
    ].filter(Boolean).join(' ')
    const userPrompt = [
        evidence,
        '',
        'Return JSON with these keys: household_goals, social_situation_changes, social_situation_changes_detail, functional_capacity_changes, information_source, injury_related_changes, household_member_capacity_changes, household_member_capacity_details, cultural_considerations, summary_of_plan, further_assessment_recommendation, quotation_details, contributors (array of objects with name, relationship, contact, date, engagement), funded_support (array of objects with task, frequency, duration, justification), assistive_technology (array of objects with equipmentType, supplier, trialSummary, justification), additional_ot_funding (array of objects with area, intervention, justification, hours).',
        '',
        OTF10_FIELD_STYLE_RULES,
    ].join('\n')

    // The person is named by their role, never by name. The guard then verifies the result and
    // refuses the call if any identifier survived.
    const guarded = guardOutgoingChat(
        {
            system: systemPrompt,
            messages: [
                { role: 'user', content: `Subject: refer to the person as "the ${subjectNoun}".\n\n${userPrompt}` },
            ],
        },
        { identity, channel: EGRESS_CHANNEL_REPORT }
    )

    const result = await requestChatCompletion({
        provider: normalizedProvider,
        model: model || DEFAULT_REPORT_MODEL,
        baseUrl,
        apiKey: resolvedApiKey,
        system: guarded.system,
        messages: guarded.messages,
        jsonMode: true,
        temperature: 0.1,
        errorLabel: 'OTF10 field generation failed',
    })
    if (!result.ok) {
        throw new Error(result.error)
    }

    // The document is local and a person reads it, so the real name goes back in. This is the
    // restore step for the report body; it never travels back to a model.
    return restoreIdentityDeep(parseJsonResponse(result.text), identity)
}

function buildReportFromTemplate({ templateContent, generatedReportMarkdown, variableMap }) {
    const source = String(templateContent || '').trim()
    if (!source) {
        return String(generatedReportMarkdown || '').trim()
    }

    const hasGeneratedBodyToken = /{{\s*generated_report_body\s*}}/i.test(source)
    const hasTemplateTokens = /{{\s*[a-z0-9_]+\s*}}/i.test(source)

    let hydrated = source
    for (const [tokenName, tokenValue] of Object.entries(variableMap || {})) {
        hydrated = replaceTemplateTokenValue(hydrated, tokenName, tokenValue)
    }

    // Cover-page tokens are optional: a patient record without an NDIS number or the domain
    // without provider details must not leave literal {{token}} text on the cover.
    for (const tokenName of ['ndis_number', 'date_of_birth', 'address', 'provider_name', 'provider_contact', 'provider_details']) {
        hydrated = hydrated.replace(new RegExp(`{{\\s*${tokenName}\\s*}}`, 'gi'), '')
    }

    const generatedBody = String(generatedReportMarkdown || '').trim()
    if (!generatedBody) {
        return hydrated
    }

    if (hasGeneratedBodyToken) {
        const withEmbeddedBody = replaceTemplateTokenValue(hydrated, 'generated_report_body', generatedBody)
        if (withEmbeddedBody !== hydrated) {
            return withEmbeddedBody
        }
        return hydrated
    }

    // Tokenized templates already define structure; avoid duplicating large generated sections.
    if (hasTemplateTokens) {
        return hydrated
    }

    return `${hydrated}\n\n---\n\n${generatedBody}`
}

function removeFcaTemplateScaffolding(markdown) {
    const output = []
    let removingNotice = false
    let removingGeneratedHeader = false

    for (const line of String(markdown || '').replace(/\r\n/g, '\n').split('\n')) {
        const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line.trim())
        const headingText = String(heading?.[1] || '').trim().toLowerCase()

        if (removingNotice) {
            if (!heading) continue
            removingNotice = false
        }

        if (removingGeneratedHeader) {
            if (!line.trim() || /^(?:participant|practice):/i.test(line.trim())) continue
            removingGeneratedHeader = false
        }

        if (headingText === 'clinical draft notice') {
            removingNotice = true
            continue
        }
        if (headingText === 'generated report body') continue
        if (headingText === 'functional capacity assessment (draft)') {
            removingGeneratedHeader = true
            continue
        }

        output.push(line)
    }

    return output.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function buildFormalReport({ patientName, domain, practiceName, notes, transcripts, job }) {
    const normalizedName = String(patientName || '').trim() || 'Unknown patient'
    const normalizedPractice = String(practiceName || '').trim() || String(domain || '').trim().toLowerCase()
    const nowIso = new Date().toISOString()
    const transcriptEntries = Array.isArray(transcripts) ? transcripts : []

    const transcriptSection = transcriptEntries.length > 0
        ? transcriptEntries.map((entry, index) => formatTranscriptEntry(entry, index)).join('\n\n')
        : 'No transcripts found for this patient.'

    const notesSection = notes
        ? truncateLongText(notes, 20000)
        : 'No structured patient notes were found.'

    const header = [
        '# Formal Patient Report',
        '',
        `Patient: ${normalizedName}`,
        `Practice: ${normalizedPractice || 'unknown'}`,
        `Generated At: ${nowIso}`,
        `Source Job ID: ${job?.id || 'n/a'}`,
        ''
    ].join('\n')

    const summary = [
        '## Summary',
        '',
        'This report is an MVP-generated draft assembled from patient notes and transcript records.',
        'Review and edit for clinical correctness before final external use.',
        ''
    ].join('\n')

    const notesBlock = [
        '## Clinical Notes',
        '',
        notesSection,
        ''
    ].join('\n')

    const transcriptsBlock = [
        '## Transcript Evidence',
        '',
        transcriptSection,
        ''
    ].join('\n')

    const assessment = [
        '## Assessment Draft',
        '',
        '- Presenting concerns should be validated against the notes and transcripts above.',
        '- Functional impacts, risks, and supports should be explicitly confirmed by clinician review.',
        '- Update this section with finalized professional language before distribution.',
        ''
    ].join('\n')

    const plan = [
        '## Plan / Recommendations Draft',
        '',
        '- Confirm immediate actions and follow-up dates.',
        '- Document treatment goals and measurable outcomes.',
        '- Capture handover items for care coordination.',
        ''
    ].join('\n')

    return [header, summary, notesBlock, transcriptsBlock, assessment, plan].join('\n')
}

const PENDING_DELETE_STATUS = 'pending delete'

function getReportTableSchemaStatements(table, dbType) {
    if (dbType === 'postgresql') {
        return {
            create: `
      CREATE TABLE IF NOT EXISTS ${table} (
        id BIGSERIAL PRIMARY KEY,
        domain VARCHAR(100) NOT NULL,
        patient_id BIGINT NOT NULL,
        patient_name TEXT,
        report_markdown TEXT NOT NULL,
        source_notes TEXT,
        transcript_count INTEGER NOT NULL DEFAULT 0,
        source_metadata_json TEXT NOT NULL DEFAULT '{}',
        last_job_id BIGINT,
        status VARCHAR(32) NOT NULL DEFAULT 'ready',
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
        report_markdown LONGTEXT NOT NULL,
        source_notes LONGTEXT,
        transcript_count INT NOT NULL DEFAULT 0,
        source_metadata_json LONGTEXT NOT NULL,
        last_job_id BIGINT,
        status VARCHAR(32) NOT NULL DEFAULT 'ready',
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

    throw new Error(`Unsupported database type for patient reports: ${dbType}`)
}

function getReportDraftTableSchemaStatements(table, dbType) {
    if (dbType === 'postgresql') {
        return {
            create: `
            CREATE TABLE IF NOT EXISTS ${table} (
                id BIGSERIAL PRIMARY KEY,
                domain VARCHAR(100) NOT NULL,
                patient_id BIGINT NOT NULL,
                patient_name TEXT,
                report_markdown TEXT NOT NULL,
                source_notes TEXT,
                transcript_count INTEGER NOT NULL DEFAULT 0,
                source_metadata_json TEXT NOT NULL DEFAULT '{}',
                last_job_id BIGINT,
                status VARCHAR(32) NOT NULL DEFAULT 'ready',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
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
                report_markdown LONGTEXT NOT NULL,
                source_notes LONGTEXT,
                transcript_count INT NOT NULL DEFAULT 0,
                source_metadata_json LONGTEXT NOT NULL,
                last_job_id BIGINT,
                status VARCHAR(32) NOT NULL DEFAULT 'ready',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                KEY ${table}_domain_patient_idx (domain, patient_id),
                KEY ${table}_updated_idx (updated_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `,
            indexes: []
        }
    }

    throw new Error(`Unsupported database type for patient report drafts: ${dbType}`)
}

async function ensureFormalReportsTable(connection, dbType, table) {
    const schema = getReportTableSchemaStatements(table, dbType)
    await connection.query(schema.create)

    if (dbType === 'postgresql') {
        // Legacy tables may exist without a unique key needed by ON CONFLICT.
        await connection.query(
            `
              WITH ranked AS (
                SELECT id,
                  ROW_NUMBER() OVER (
                    PARTITION BY domain, patient_id
                    ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
                  ) AS rn
                FROM ${table}
              )
              DELETE FROM ${table} target
              USING ranked
              WHERE target.id = ranked.id
                AND ranked.rn > 1
            `
        )

        await connection.query(
            `CREATE UNIQUE INDEX IF NOT EXISTS ${table}_domain_patient_unique ON ${table} (domain, patient_id)`
        )
    }

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
}

async function ensureReportDraftsTable(connection, dbType, table) {
    const schema = getReportDraftTableSchemaStatements(table, dbType)
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
        // Unique index required for ON CONFLICT (domain, patient_id, last_job_id) idempotency guard.
        try {
            await connection.query(
                `CREATE UNIQUE INDEX IF NOT EXISTS ${table}_domain_patient_job_unique ON ${table} (domain, patient_id, last_job_id) WHERE last_job_id IS NOT NULL`
            )
        } catch (error) {
            const message = String(error?.message || '')
            if (!message.includes('already exists')) {
                throw error
            }
        }
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
    } catch (error) {
        if (!isMissingTableError(error)) {
            throw error
        }
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
    const transcriptOtf10SummaryCount = transcriptsWithSummaries.filter((item) => String(item?.transcript_otf10_summary_text || '').trim()).length
    const transcriptFcaSummaryCount = transcriptsWithSummaries.filter((item) => String(item?.transcript_fca_summary_text || '').trim()).length

    return {
        patient: patientResult.rows?.[0] || null,
        transcripts: transcriptsWithSummaries,
        transcriptSummaryCount,
        transcriptOtf10SummaryCount,
        transcriptFcaSummaryCount,
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
    } catch (error) {
        if (!isMissingTableError(error)) {
            throw error
        }
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
    const transcriptOtf10SummaryCount = transcriptsWithSummaries.filter((item) => String(item?.transcript_otf10_summary_text || '').trim()).length
    const transcriptFcaSummaryCount = transcriptsWithSummaries.filter((item) => String(item?.transcript_fca_summary_text || '').trim()).length

    return {
        patient: patientRows?.[0] || null,
        transcripts: transcriptsWithSummaries,
        transcriptSummaryCount,
        transcriptOtf10SummaryCount,
        transcriptFcaSummaryCount,
        notesText,
    }
}

async function upsertFormalReportPostgres(connection, table, report) {
    const result = await connection.query(
        `
      INSERT INTO ${table} (
        domain,
        patient_id,
        patient_name,
        report_markdown,
        source_notes,
        transcript_count,
        source_metadata_json,
        last_job_id,
        status,
        created_at,
        updated_at
      ) VALUES (
                                $1::text,
                                $2::bigint,
                                $3::text,
                                $4::text,
                                $5::text,
                                $6::integer,
                                $7::text,
                                $8::bigint,
        'ready',
        NOW(),
        NOW()
      )
      ON CONFLICT (domain, patient_id)
      DO UPDATE SET
        patient_name = EXCLUDED.patient_name,
        report_markdown = EXCLUDED.report_markdown,
        source_notes = EXCLUDED.source_notes,
        transcript_count = EXCLUDED.transcript_count,
        source_metadata_json = EXCLUDED.source_metadata_json,
        last_job_id = EXCLUDED.last_job_id,
        status = 'ready',
        updated_at = NOW()
      RETURNING id
    `,
        [
            report.domain,
            report.patientId,
            report.patientName,
            report.reportMarkdown,
            report.sourceNotes,
            report.transcriptCount,
            JSON.stringify(report.sourceMetadata),
            report.lastJobId
        ]
    )

    return result?.rows?.[0]?.id || null
}

async function upsertFormalReportMySql(connection, table, report) {
    const [result] = await connection.execute(
        `
      INSERT INTO ${table} (
        domain,
        patient_id,
        patient_name,
        report_markdown,
        source_notes,
        transcript_count,
        source_metadata_json,
        last_job_id,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', UTC_TIMESTAMP(), UTC_TIMESTAMP())
      ON DUPLICATE KEY UPDATE
        patient_name = VALUES(patient_name),
        report_markdown = VALUES(report_markdown),
        source_notes = VALUES(source_notes),
        transcript_count = VALUES(transcript_count),
        source_metadata_json = VALUES(source_metadata_json),
        last_job_id = VALUES(last_job_id),
        status = 'ready',
        updated_at = UTC_TIMESTAMP()
    `,
        [
            report.domain,
            report.patientId,
            report.patientName,
            report.reportMarkdown,
            report.sourceNotes,
            report.transcriptCount,
            JSON.stringify(report.sourceMetadata),
            report.lastJobId
        ]
    )

    return result?.insertId || null
}

async function insertFormalReportDraftPostgres(connection, table, report) {
    const result = await connection.query(
        `
            INSERT INTO ${table} (
                domain,
                patient_id,
                patient_name,
                report_markdown,
                source_notes,
                transcript_count,
                source_metadata_json,
                last_job_id,
                status,
                created_at,
                updated_at
            ) VALUES (
                $1::text,
                $2::bigint,
                $3::text,
                $4::text,
                $5::text,
                $6::integer,
                $7::text,
                $8::bigint,
                'ready',
                NOW(),
                NOW()
            )
            ON CONFLICT DO NOTHING
            RETURNING id
        `,
        [
            report.domain,
            report.patientId,
            report.patientName,
            report.reportMarkdown,
            report.sourceNotes,
            report.transcriptCount,
            JSON.stringify(report.sourceMetadata),
            report.lastJobId
        ]
    )

    return result?.rows?.[0]?.id || null
}

async function insertFormalReportDraftMySql(connection, table, report) {
    const [result] = await connection.execute(
        `
            INSERT INTO ${table} (
                domain,
                patient_id,
                patient_name,
                report_markdown,
                source_notes,
                transcript_count,
                source_metadata_json,
                last_job_id,
                status,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', UTC_TIMESTAMP(), UTC_TIMESTAMP())
        `,
        [
            report.domain,
            report.patientId,
            report.patientName,
            report.reportMarkdown,
            report.sourceNotes,
            report.transcriptCount,
            JSON.stringify(report.sourceMetadata),
            report.lastJobId
        ]
    )

    return result?.insertId || null
}

async function processReportJobLocally(connection, dbType, formalReportsTable, reportDraftsTable, row, payload) {
    const domain = String(row?.domain || payload?.domain || '').trim().toLowerCase()
    const patientId = Number.parseInt(String(row?.patient_id || payload?.patientId || payload?.patient_id || ''), 10)

    if (!domain) {
        throw new Error('Report job missing domain')
    }
    if (!Number.isFinite(patientId) || patientId <= 0) {
        throw new Error('Report job missing valid patient_id')
    }

    const context = dbType === 'postgresql'
        ? await fetchPatientContextPostgres(connection, domain, patientId)
        : await fetchPatientContextMySql(connection, domain, patientId)

    const patient = context.patient
    if (!patient) {
        throw new Error(`Patient not found for domain=${domain}, patient_id=${patientId}`)
    }

    const patientMetadata = parseJsonObject(patient.metadata)
    // Everything that identifies this patient, collected once. Every model call in this job is
    // scrubbed against it, and the report header is written from it locally.
    const reportFundingSource = patientIntakeValue(
        patientMetadata,
        ['funding_source_or_referral_type'],
        ['Funding Source or Referral Type', 'Funding source'],
        ['fundingSource']
    )
    const identity = buildIdentityBlockFromPatient(patient, { fundingSource: reportFundingSource })
    // The notes come from the Notes entity (loaded with the patient context),
    // never from patient metadata - there is only one Notes entity.
    const notes = String(context.notesText || '').trim()
    const transcripts = Array.isArray(context.transcripts) ? context.transcripts : []
    const transcriptSummaryCount = Number.parseInt(String(context?.transcriptSummaryCount || '0'), 10) || 0
    const transcriptOtf10SummaryCount = Number.parseInt(String(context?.transcriptOtf10SummaryCount || '0'), 10) || 0
    // The FCA prerequisite re-derives its own per-transcript gaps from the loaded transcripts, so
    // `context.transcriptFcaSummaryCount` is informational only.

    const queuedMetadata = payload?.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
        ? payload.metadata
        : {}
    const queuedReportTypeId = String(
        queuedMetadata.reportTypeId
        || payload?.reportTypeId
        || payload?.reportType
        || queuedMetadata.reportType
        || ''
    ).trim()
    const queuedTemplate = queuedMetadata?.reportTemplate && typeof queuedMetadata.reportTemplate === 'object'
        ? queuedMetadata.reportTemplate
        : null
    const storedTemplate = await loadTemplateSnapshotForJob(connection, dbType, domain, queuedReportTypeId)
    const resolvedTemplate = queuedTemplate && String(queuedTemplate?.content || '').trim()
        ? { ...queuedTemplate, reportConfig: storedTemplate?.reportConfig || {} }
        : storedTemplate
    const queuedTemplateContent = stripEmbeddedDataImageMarkup(String(resolvedTemplate?.content || '').trim())
    const queuedReportTypeName = String(queuedMetadata.reportType || payload?.reportType || '').trim()
    // The practice's display name ("South East OT"), supplied by the app that queues the job. The
    // domain key stays internal: reports and prompts name the practice, not the key.
    const queuedPracticeName = String(queuedMetadata.practiceName || '').trim()

    const reportEvidenceTranscripts = isOtf10ReportType(queuedReportTypeId) || isOtf10ReportType(queuedReportTypeName)
        ? mapToTranscriptSummaries(transcripts)
        : transcripts

    let generatedReportMarkdown = buildFormalReport({
        patientName: patient.patient_name,
        domain,
        practiceName: queuedPracticeName,
        notes,
        transcripts: reportEvidenceTranscripts,
        job: row
    })
    let otf10GeneratedFields = null
    let generationMetadata = null
    let generationEngine = 'two-report-worker-mvp'

    const isFca = isFcaReportType(queuedReportTypeId) || isFcaReportType(queuedReportTypeName)
    const isOtf10 = isOtf10ReportType(queuedReportTypeId) || isOtf10ReportType(queuedReportTypeName)

    if (isFca) {
        try {
            const builderFormData = extractBuilderFormData(queuedMetadata)
            const hasTranscriptText = hasAnyTranscriptText(transcripts)
            // FCA evidence now comes from the FCA-specific summary style, so a report cannot be
            // generated until every included transcript has one (or the clinician supplied it at
            // Step 8). Waiting on the generic style instead - the previous behaviour - let the
            // worker run with no FCA summaries at all.
            const missingFcaSummary = findTranscriptsMissingFcaSummary(transcripts, builderFormData)
            if (hasTranscriptText && missingFcaSummary.length > 0) {
                const enqueueResult = await enqueueMissingTranscriptSummaryJobs({
                    connection,
                    dbType,
                    domain,
                    patientId,
                    patientName: patient.patient_name,
                    transcripts: missingFcaSummary,
                    summaryStyle: FCA_SCRIBE_SUMMARY_STYLE,
                    aiUsage: payload?.aiUsage,
                })
                throw new DeferredRetryReportError(
                    `FCA report deferred: waiting for FCA transcript summaries. missing=${missingFcaSummary.length}, eligible=${enqueueResult.eligibleCount}, queued_now=${enqueueResult.queuedCount}.`
                )
            }

            const advancedDraft = await generateFcaReportDraft({
                patientName: patient.patient_name,
                domain,
                practiceName: queuedPracticeName,
                notes,
                transcripts,
                additionalContext: String(queuedMetadata?.additionalContext || '').trim(),
                builderFormData,
                model: resolveUsageModel(payload),
                provider: payload?.aiUsage?.provider,
                baseUrl: payload?.aiUsage?.baseUrl,
                hasApiKey: payload?.aiUsage?.hasApiKey === true,
                apiKey: payload?.aiUsage?.apiKey,
                jobId: row?.id,
                reportTypeConfig: queuedMetadata?.reportTypeConfig,
            })

            const advancedMarkdown = String(advancedDraft?.markdown || '').trim()
            if (advancedMarkdown) {
                generatedReportMarkdown = advancedMarkdown
                generationMetadata = advancedDraft?.meta || null
                generationEngine = 'two-report-worker-fca-v1'
            }
        } catch (error) {
            generationMetadata = {
                adapter: 'fallback-to-mvp',
                error: truncateText(error?.message || 'Advanced FCA generation failed'),
            }
        }
    }

    if (isOtf10) {
        const hasTranscriptText = hasAnyTranscriptText(transcripts)
        if (hasTranscriptText && transcriptOtf10SummaryCount <= 0) {
            const enqueueResult = await enqueueMissingTranscriptSummaryJobs({
                connection,
                dbType,
                domain,
                patientId,
                patientName: patient.patient_name,
                transcripts,
                summaryStyle: isOtf10 ? 'otf10-home-services' : 'topic-bullets-third-person',
                aiUsage: payload?.aiUsage,
            })
            throw new DeferredRetryReportError(
                `OTF10 report deferred: waiting for transcript summaries. eligible=${enqueueResult.eligibleCount}, queued_now=${enqueueResult.queuedCount}.`
            )
        }

        try {
            const hsrCreatorConfig = patientMetadata?.patientAgents?.hsrCreatorConfig && typeof patientMetadata.patientAgents.hsrCreatorConfig === 'object'
                ? patientMetadata.patientAgents.hsrCreatorConfig
                : {}
            otf10GeneratedFields = await generateOtf10Fields({
                identity,
                subjectNoun: resolveSubjectNoun({ fundingSource: reportFundingSource }),
                notes,
                transcripts,
                model: resolveUsageModel(payload),
                provider: payload?.aiUsage?.provider,
                baseUrl: payload?.aiUsage?.baseUrl,
                apiKey: payload?.aiUsage?.apiKey,
                includeTranscripts: hsrCreatorConfig.includeTranscripts !== false,
                additionalInstructions: String(hsrCreatorConfig.additionalInstructions || '').trim(),
                workerPrompt: String(hsrCreatorConfig.workerPrompt || '').trim(),
            })
            if (otf10GeneratedFields) {
                generationEngine = 'two-report-worker-otf10-v1'
                generationMetadata = {
                    ...(generationMetadata || {}),
                    otf10: {
                        adapter: resolveChatProviderLabel({ provider: payload?.aiUsage?.provider, model: resolveUsageModel(payload) }),
                        includeTranscripts: hsrCreatorConfig.includeTranscripts !== false,
                        transcriptEvidenceSource: hsrCreatorConfig.includeTranscripts === false
                            ? 'excluded-by-setting'
                            : transcriptOtf10SummaryCount > 0
                                ? 'otf10-home-services-summary'
                                : transcriptSummaryCount > 0
                                    ? 'topic-bullets-summary'
                                    : 'none',
                    },
                }
            }
        } catch (error) {
            generationMetadata = {
                ...(generationMetadata || {}),
                otf10: {
                    adapter: 'fallback-to-deterministic-fields',
                    error: truncateText(error?.message || 'OTF10 field generation failed'),
                },
            }
            // An empty OTF10 pro-forma is worse than a retry: surface the failure instead of
            // silently completing the job with blank form fields.
            throw error
        }
    }

    const templateVariables = buildTemplateVariableMap({
        patientName: patient.patient_name,
        domain,
        practiceName: queuedPracticeName,
        notes,
        jobId: row?.id,
        additionalContext: queuedMetadata?.additionalContext,
        identity,
        reportConfig: resolvedTemplate?.reportConfig,
    })
    const otf10Variables = buildOtf10VariableMap({
        patientMetadata,
        generatedFields: otf10GeneratedFields,
        reportConfig: resolvedTemplate?.reportConfig,
    })

    const composedReportMarkdown = buildReportFromTemplate({
        templateContent: queuedTemplateContent,
        generatedReportMarkdown,
        variableMap: {
            ...templateVariables,
            ...otf10Variables,
        },
    })
    const reportMarkdown = isFca && queuedTemplateContent
        ? removeFcaTemplateScaffolding(composedReportMarkdown)
        : composedReportMarkdown

    const usage = buildReportUsage({
        sourceNotes: notes || null,
        reportMarkdown,
        model: resolveUsageModel(payload),
        providerUsage: generationMetadata?.usage || null,
    })

    const sourceMetadata = {
        generatedAt: new Date().toISOString(),
        transcriptIds: transcripts.map((item) => item.id),
        transcriptCount: transcripts.length,
        transcriptSummaryCount,
        jobId: row.id,
        eventType: row.event_type || null,
        requestedAction: row.requested_action || null,
        generator: queuedTemplateContent ? `${generationEngine}-template-v1` : generationEngine,
        reportTypeId: queuedReportTypeId || null,
        reportType: queuedReportTypeName || null,
        reportTypeConfig: queuedMetadata.reportTypeConfig && typeof queuedMetadata.reportTypeConfig === 'object'
            ? queuedMetadata.reportTypeConfig
            : null,
        reportTemplateId: String(queuedMetadata.reportTemplateId || resolvedTemplate?.id || '').trim() || null,
        templateApplied: Boolean(queuedTemplateContent),
        additionalContext: String(queuedMetadata.additionalContext || '').trim() || null,
        generationMetadata,
        transcriptEvidenceSource: generationMetadata?.transcriptEvidenceSource || null,
        usage
    }

    const draftReport = {
        domain,
        patientId,
        patientName: patient.patient_name,
        reportMarkdown,
        sourceNotes: notes || null,
        transcriptCount: transcripts.length,
        sourceMetadata,
        lastJobId: row.id
    }

    if (dbType === 'postgresql') {
        await insertFormalReportDraftPostgres(connection, reportDraftsTable, draftReport)
    } else {
        await insertFormalReportDraftMySql(connection, reportDraftsTable, draftReport)
    }

    const reportId = dbType === 'postgresql'
        ? await upsertFormalReportPostgres(connection, formalReportsTable, {
            ...draftReport
        })
        : await upsertFormalReportMySql(connection, formalReportsTable, {
            ...draftReport
        })

    return {
        reportId,
        transcriptCount: transcripts.length,
        patientName: patient.patient_name,
        usage
    }
}

function getBackoffSeconds(attempt, config) {
    const exponent = Math.max(0, attempt - 1)
    const seconds = config.retryBaseSeconds * (2 ** exponent)
    return Math.min(seconds, config.retryMaxSeconds)
}

async function markCompletedPostgres(connection, table, rowId, usage) {
    await connection.query(
        `
      UPDATE ${table}
      SET status = 'completed',
          usage_model = $2,
          usage_input_tokens = $3::bigint,
          usage_output_tokens = $4::bigint,
          usage_total_tokens = $5::bigint,
          usage_estimated_cost_usd = $6,
          completed_at = NOW(),
          error_message = NULL,
          updated_at = NOW()
      WHERE id = $1::bigint
    `,
        [
            rowId,
            usage?.model || null,
            Number.isFinite(Number(usage?.inputTokens)) ? Number(usage.inputTokens) : null,
            Number.isFinite(Number(usage?.outputTokens)) ? Number(usage.outputTokens) : null,
            Number.isFinite(Number(usage?.totalTokens)) ? Number(usage.totalTokens) : null,
            Number.isFinite(Number(usage?.estimatedCostUsd)) ? Number(usage.estimatedCostUsd) : null
        ]
    )
}

async function markCompletedMySql(connection, table, rowId, usage) {
    await connection.execute(
        `
      UPDATE ${table}
      SET status = 'completed',
          usage_model = ?,
          usage_input_tokens = ?,
          usage_output_tokens = ?,
          usage_total_tokens = ?,
          usage_estimated_cost_usd = ?,
          completed_at = UTC_TIMESTAMP(),
          error_message = NULL,
          updated_at = UTC_TIMESTAMP()
      WHERE id = ?
    `,
        [
            usage?.model || null,
            Number.isFinite(Number(usage?.inputTokens)) ? Number(usage.inputTokens) : null,
            Number.isFinite(Number(usage?.outputTokens)) ? Number(usage.outputTokens) : null,
            Number.isFinite(Number(usage?.totalTokens)) ? Number(usage.totalTokens) : null,
            Number.isFinite(Number(usage?.estimatedCostUsd)) ? Number(usage.estimatedCostUsd) : null,
            rowId
        ]
    )
}

async function markFailedPostgres(connection, table, id, errorMessage, attempts, maxAttempts, nextRetrySeconds) {
    const shouldFail = attempts >= maxAttempts
    const status = shouldFail ? 'failed' : 'queued'

    // Queue timestamps are written and compared with NOW() only. Mixing in
    // `NOW() AT TIME ZONE 'UTC'` put a reader's wall clock against a writer's wall clock, so a
    // job claimed seconds ago looked hours stale whenever the session timezone was not UTC.
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
                AND COALESCE(attempts, 0) < COALESCE(max_attempts, $1::integer)
      ORDER BY created_at ASC
            LIMIT $2::integer
      FOR UPDATE SKIP LOCKED
    )
    UPDATE ${table} AS q
    SET status = 'processing',
        claimed_at = NOW(),
        claimed_by = $3::text,
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
    // `claimed_at` is written with NOW() (session wall clock), so it must be read back the same
    // way. Comparing it against `NOW() AT TIME ZONE 'UTC'` made every in-flight job look hours
    // stale on a non-UTC session, so a cycle that overlapped a running report requeued it and
    // generated the whole report - and paid for it - a second time.
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

export async function runReportWorkerCycle(options = {}) {
    const forceRun = options && typeof options === 'object' && options.forceRun === true
    const config = getConfig()
    if (!config.enabled && !forceRun) {
        return { skipped: true, reason: 'disabled' }
    }

    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql' && dbType !== 'mysql') {
        return { skipped: true, reason: `unsupported-db:${dbType || 'none'}` }
    }

    const workerId = `two-report-worker-${process.pid}`
    let connection = null

    try {
        connection = await getDatabaseConnection()
        await ensureReportQueueTable(connection, dbType, config.table)
        const formalReportsTable = resolveFormalReportsTableName()
        const reportDraftsTable = resolveReportDraftsTableName()
        await ensureFormalReportsTable(connection, dbType, formalReportsTable)
        await ensureReportDraftsTable(connection, dbType, reportDraftsTable)

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
                const result = await processReportJobLocally(connection, dbType, formalReportsTable, reportDraftsTable, row, payload)

                if (dbType === 'postgresql') {
                    await markCompletedPostgres(connection, config.table, row.id, result?.usage)
                } else {
                    await markCompletedMySql(connection, config.table, row.id, result?.usage)
                }

                completedCount += 1
            } catch (error) {
                let nextRetrySeconds = getBackoffSeconds(attempts, config)
                const safeErrorMessage = truncateText(error?.message || 'Report worker failed')
                console.error(`[report-worker] job ${row.id} failed for domain=${row.domain || 'unknown'} patient_id=${row.patient_id || 'unknown'}: ${safeErrorMessage}`)
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

export function startReportWorker() {
    const config = getConfig()

    if (!config.enabled) {
        console.log('REPORT_WORKER_ENABLED=false - report worker is disabled')
        return () => { }
    }

    console.log(`REPORT_WORKER_ENABLED=true - report worker started (table=${config.table}, poll=${config.pollSeconds}s, batch=${config.batchSize})`)
    console.log(`Report worker stale processing timeout: ${config.staleProcessingMinutes} minute(s)`)

    let timer = null
    let stopped = false

    const run = async () => {
        try {
            const result = await runReportWorkerCycle()
            if (!result.skipped) {
                console.log(`[${new Date().toISOString()}] Report worker cycle: reclaimed=${result.reclaimed || 0}, claimed=${result.claimed}, completed=${result.completed}, failed=${result.failed}`)
            } else if ((result.reclaimed || 0) > 0) {
                console.log(`[${new Date().toISOString()}] Report worker cycle: reclaimed=${result.reclaimed}, no new report jobs claimed yet`)
            }
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Report worker cycle failed: ${error?.message || error}`)
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
            console.error(`[startup] Report worker did not start cycles: ${error?.message || error}`)
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
    startReportWorker,
    runReportWorkerCycle
}

export const __testOnly = {
    buildReportFromTemplate,
    buildReportUsage,
    removeFcaTemplateScaffolding,
    buildTemplateVariableMap,
    buildOtf10VariableMap,
    tableRows,
    enrichTranscriptsWithSummaries,
    findTranscriptsMissingFcaSummary,
    resolveMissingSummaryTranscriptionIds,
}
