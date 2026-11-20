// The patient "Quote Writer" worker.
//
// Turns a participant's clinical record into a *draft* NDIS quote: a
// `patient_quotes` header plus priced `quote_items` lines. The practitioner
// reviews, edits and sends it like any hand-built quote.
//
// Why this runs in the app rather than in the worker service: every line is
// priced and validated against `ndisSupportCatalogue.js`, which is the single
// source of truth for NDIS support items and price limits. Keeping the worker
// here means there is exactly one answer to "what is the limit for this
// support item in this region?" — the same rule the manual quote form follows.
//
// Two entry points share this module:
//   * the background queue (`patient_quote_jobs`) drained by `runQuoteWriterCycle`
//     and by `POST /api/database/quotes/run-jobs`, and
//   * the inline assist in the Quotes panel (`POST /api/database/quotes/assist`),
//     which runs a single patient synchronously.

import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { resolveDomainAiConfig } from '@/lib/domainAiConfig'
import { DOMAIN_AI_FEATURE_QUOTE_WRITER } from '@/lib/domainAiFeatures'
import { requestAiChatCompletion } from '@/lib/openaiClient'
import {
    EGRESS_CHANNEL_QUOTE,
    buildIdentityBlockFromPatient,
    resolveSubjectNoun,
    restoreIdentityDeep,
} from '@/lib/privacy'
import { ensureNdisCataloguePublished } from '@/lib/ndisCatalogueStore'
import {
    PATIENT_REFERENCE_NUMBER_LABEL,
    nextQuoteNumber,
    parseMetadataValue,
    resolvePatientFundingContext,
    roundMoney,
    toFinite,
} from '@/lib/patientQuotes'
import { ensurePatientQuotesTables } from '@/lib/patientQuotesTable'
import {
    QUOTE_WRITER_LABEL,
    QUOTE_WRITER_ORIGIN,
    QUOTE_WRITER_EVIDENCE_LIMITS,
    buildQuoteDraftEvidence,
    buildQuoteDraftHeader,
    buildQuoteDraftMessages,
    buildQuoteDraftNotes,
    buildQuoteItemMetadata,
    buildQuoteMetadata,
    normalizeQuoteDraftResponse,
    normalizeQuoteWriterConfig,
} from '@/lib/patientQuoteDrafting'
import {
    QUOTE_WRITER_ACTION_DRAFT,
    QUOTE_WRITER_EVENT_CONFIG_CHANGED,
    QUOTE_WRITER_EVENT_ENABLED,
    QUOTE_WRITER_EVENT_REQUESTED,
    ensureQuoteWriterQueueTable,
    resolveQuoteWriterQueueTableName,
} from '@/lib/patientQuoteJobs'

const DEFAULT_EQUIPMENT_SUGGESTIONS_TABLE = 'patient_equipment_suggestions'
const DEFAULT_TRANSCRIPT_SUMMARIES_TABLE = 'patient_transcript_summaries'
const PENDING_DELETE_STATUS = 'pending delete'

const DEFAULT_BATCH_SIZE = 5
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_STALE_PROCESSING_MINUTES = 10
const RETRY_DELAY_SECONDS = 120

const DEFAULT_MODEL = 'gpt-4.1-mini'

function isTrue(value) {
    return String(value).toLowerCase() === 'true'
}

function parsePositiveInt(value, fallback) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : fallback
}

function isSafeSqlIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ''))
}

function resolveTableName(environmentKey, fallback) {
    const table = String(process.env[environmentKey] || fallback).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error(`${environmentKey} must be a safe SQL identifier (letters, numbers, underscore)`)
    }
    return table
}

function resolveEquipmentSuggestionsTableName() {
    return resolveTableName('EQUIPMENT_SOURCER_RESULTS_TABLE', DEFAULT_EQUIPMENT_SUGGESTIONS_TABLE)
}

function isMissingTableError(error) {
    const message = String(error?.message || '').toLowerCase()
    return message.includes('does not exist') || message.includes("doesn't exist")
}

function cleanText(value) {
    return String(value === undefined || value === null ? '' : value).trim()
}

export function getQuoteWriterConfig() {
    return {
        workerEnabled: isTrue(process.env.QUOTE_WRITER_WORKER_ENABLED || 'false'),
        queueTable: resolveQuoteWriterQueueTableName(),
        batchSize: parsePositiveInt(process.env.QUOTE_WRITER_BATCH_SIZE, DEFAULT_BATCH_SIZE),
        maxAttempts: parsePositiveInt(process.env.QUOTE_WRITER_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS),
        staleProcessingMinutes: parsePositiveInt(
            process.env.QUOTE_WRITER_STALE_PROCESSING_MINUTES,
            DEFAULT_STALE_PROCESSING_MINUTES
        ),
    }
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

async function fetchPatientRow(connection, domain, patientId) {
    const result = await connection.query(
        'SELECT id, patient_name, domain, metadata FROM patients WHERE id = $1 AND domain = $2 LIMIT 1',
        [patientId, domain]
    )
    const row = result.rows?.[0]
    if (!row) return null
    return { ...row, metadata: parseMetadataValue(row.metadata) }
}

async function fetchPatientNotesText(connection, domain, patientId) {
    try {
        const result = await connection.query(
            `SELECT content_text FROM notes
             WHERE domain = $1 AND patient_id = $2
             ORDER BY updated_at DESC NULLS LAST, id DESC
             LIMIT 200`,
            [domain, patientId]
        )
        return (result.rows || [])
            .map((row) => cleanText(row?.content_text))
            .filter(Boolean)
            .join('\n\n')
    } catch (error) {
        // A domain that has never stored a note has no `notes` table yet.
        if (isMissingTableError(error)) return ''
        throw error
    }
}

async function fetchTranscriptSummariesText(connection, domain, patientId, { limit = 20 } = {}) {
    let transcripts = []
    try {
        const result = await connection.query(
            `SELECT id, title, transcript_text, created_at, updated_at
             FROM patient_transcriptions
             WHERE patient_id = $1 AND domain = $2
               AND status <> $3
               AND COALESCE(transcript_text, '') <> ''
             ORDER BY COALESCE(updated_at, created_at) DESC
             LIMIT $4`,
            [patientId, domain, PENDING_DELETE_STATUS, limit]
        )
        transcripts = result.rows || []
    } catch (error) {
        if (isMissingTableError(error)) return ''
        throw error
    }

    if (!transcripts.length) return ''

    const summariesTable = resolveTableName('PATIENT_TRANSCRIPT_SUMMARIES_TABLE', DEFAULT_TRANSCRIPT_SUMMARIES_TABLE)
    const ids = transcripts
        .map((row) => Number.parseInt(String(row?.id || ''), 10))
        .filter((id) => Number.isFinite(id) && id > 0)

    let summaries = []
    if (ids.length) {
        try {
            const result = await connection.query(
                `SELECT transcription_id, summary_style, summary_text, updated_at
                 FROM ${summariesTable}
                 WHERE domain = $1 AND transcription_id = ANY($2::bigint[])`,
                [domain, ids]
            )
            summaries = result.rows || []
        } catch (error) {
            if (!isMissingTableError(error)) throw error
        }
    }

    // The worker reads the newest usable summary per transcript. A transcript with
    // no summary yet still contributes its (truncated) raw text.
    const byTranscription = new Map()
    for (const summary of summaries) {
        const key = Number.parseInt(String(summary?.transcription_id || ''), 10)
        if (!Number.isFinite(key)) continue
        const text = cleanText(summary?.summary_text)
        if (!text) continue
        const current = byTranscription.get(key)
        if (!current || String(summary?.updated_at || '') > String(current?.updated_at || '')) {
            byTranscription.set(key, { ...summary, summary_text: text })
        }
    }

    return transcripts
        .map((row) => {
            const summary = byTranscription.get(Number.parseInt(String(row?.id || ''), 10))
            const title = cleanText(row?.title) || `Transcript ${row?.id}`
            const body = cleanText(summary?.summary_text) || cleanText(row?.transcript_text).slice(0, 4000)
            return body ? `${title}:\n${body}` : ''
        })
        .filter(Boolean)
        .join('\n\n')
}

async function fetchLatestReportMarkdown(connection, domain, patientId) {
    try {
        const result = await connection.query(
            `SELECT report_markdown FROM patient_reports
             WHERE domain = $1 AND patient_id = $2
               AND LOWER(COALESCE(status, 'ready')) <> $3
             ORDER BY updated_at DESC NULLS LAST, created_at DESC, id DESC
             LIMIT 1`,
            [domain, patientId, PENDING_DELETE_STATUS]
        )
        return cleanText(result.rows?.[0]?.report_markdown)
    } catch (error) {
        if (isMissingTableError(error)) return ''
        throw error
    }
}

async function fetchEquipmentSuggestionsText(connection, domain, patientId) {
    const table = resolveEquipmentSuggestionsTableName()
    try {
        const result = await connection.query(
            `SELECT suggestions_json FROM ${table} WHERE domain = $1 AND patient_id = $2 LIMIT 1`,
            [domain, patientId]
        )
        const raw = result.rows?.[0]?.suggestions_json
        if (!raw) return ''

        let parsed = raw
        if (typeof raw === 'string') {
            try {
                parsed = JSON.parse(raw)
            } catch {
                return ''
            }
        }
        if (!Array.isArray(parsed)) return ''

        return parsed
            .slice(0, 25)
            .map((item) => {
                const type = cleanText(item?.equipmentType || item?.equipment_type)
                const supplier = cleanText(item?.supplier)
                const justification = cleanText(item?.justification || item?.description)
                return [type, supplier, justification].filter(Boolean).join(' — ')
            })
            .filter(Boolean)
            .join('\n')
    } catch (error) {
        if (isMissingTableError(error)) return ''
        throw error
    }
}

/**
 * Everything the worker reads for one participant. Every block is optional: a
 * participant with only an intake record still produces a (short) draft, and a
 * missing table is never an error.
 */
export async function collectQuoteWriterContext(connection, { domain, patientId, config } = {}) {
    const patient = await fetchPatientRow(connection, domain, patientId)
    if (!patient) return null

    const metadata = patient.metadata && typeof patient.metadata === 'object' ? patient.metadata : {}
    const answers = metadata.sploseAnswers && typeof metadata.sploseAnswers === 'object' ? metadata.sploseAnswers : {}
    const labelledAnswers = metadata.sploseLabelledAnswers && typeof metadata.sploseLabelledAnswers === 'object'
        ? metadata.sploseLabelledAnswers
        : {}

    const fundingContext = resolvePatientFundingContext({ answers, labelledAnswers })
    const notesText = await fetchPatientNotesText(connection, domain, patientId)
    const transcriptSummaries = await fetchTranscriptSummariesText(connection, domain, patientId)
    const reportMarkdown = await fetchLatestReportMarkdown(connection, domain, patientId)
    const equipmentSuggestions = await fetchEquipmentSuggestionsText(connection, domain, patientId)

    // Only the intake answers that describe the participant, not the 40-odd
    // administrative fields the import writes.
    const intakeSummary = {}
    for (const key of [
        'ndis_goals',
        'primary_diagnosis',
        'functional_capacity',
        'current_supports',
        'living_situation',
    ]) {
        const value = cleanText(answers[key])
        if (value) intakeSummary[key] = value
    }
    const labelledReference = cleanText(labelledAnswers[PATIENT_REFERENCE_NUMBER_LABEL])
    if (labelledReference) intakeSummary[PATIENT_REFERENCE_NUMBER_LABEL] = labelledReference

    return {
        patient,
        patientName: cleanText(patient.patient_name),
        // The identity block is what the model call is scrubbed against. Keeping it on the context
        // means the worker builds it once, from the same record the evidence came from.
        identity: buildIdentityBlockFromPatient(patient, {
            fundingSource: fundingContext.fundingSource,
        }),
        fundingContext,
        evidence: buildQuoteDraftEvidence({
            patientName: patient.patient_name,
            fundingSource: fundingContext.fundingSource,
            referenceLabel: fundingContext.referenceLabel,
            referenceNumber: fundingContext.referenceNumber,
            intakeAnswers: intakeSummary,
            notesText,
            transcriptSummaries,
            reportMarkdown,
            equipmentSuggestions,
            config,
        }),
        hasEvidence: Boolean(notesText || transcriptSummaries || reportMarkdown || equipmentSuggestions),
    }
}

// ---------------------------------------------------------------------------
// Model call
// ---------------------------------------------------------------------------

function supportsCustomTemperature(model) {
    return !/^(gpt-5|o[13-9])/i.test(cleanText(model))
}

/** Domain AI selection: vendor key, model and endpoint, from AI & Defaults. */
export async function resolveQuoteWriterAiConfig(domain) {
    const config = await resolveDomainAiConfig({
        domainKey: domain,
        feature: DOMAIN_AI_FEATURE_QUOTE_WRITER,
    })
    return {
        ...config,
        model: config.model || DEFAULT_MODEL,
        configured: Boolean(config.apiKey),
    }
}

async function requestQuoteDraft({ aiConfig, messages, signal, identity }) {
    if (!aiConfig?.apiKey) {
        throw new Error('No AI API key is configured (add one in Settings → AI & Defaults, or set the provider API key).')
    }

    const completion = await requestAiChatCompletion({
        provider: aiConfig.provider,
        model: aiConfig.model || DEFAULT_MODEL,
        baseUrl: aiConfig.baseUrl,
        apiKey: aiConfig.apiKey,
        messages,
        signal,
        identity,
        channel: EGRESS_CHANNEL_QUOTE,
        ...(supportsCustomTemperature(aiConfig.model) ? { temperature: 0.2 } : {}),
    })

    if (!completion.ok) {
        throw new Error(completion.error || `${QUOTE_WRITER_LABEL} drafting failed (HTTP ${completion.status})`)
    }

    const content = completion.text
    if (!content) {
        throw new Error(`${QUOTE_WRITER_LABEL} returned an empty response`)
    }

    if (typeof content === 'object') return content
    try {
        const parsed = JSON.parse(content)
        return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
        throw new Error(`${QUOTE_WRITER_LABEL} returned a response that was not valid JSON`)
    }
}

// ---------------------------------------------------------------------------
// Drafting
// ---------------------------------------------------------------------------

/**
 * Produces a validated draft for one participant. Pure with respect to the
 * database except for reads: `persist: false` (the panel's preview) returns the
 * draft without writing anything.
 */
export async function generateQuoteDraftForPatient({
    connection,
    domain,
    patientId,
    config,
    jobId = null,
    persist = true,
    signal,
} = {}) {
    const settings = normalizeQuoteWriterConfig(config)
    const context = await collectQuoteWriterContext(connection, { domain, patientId, config: settings })
    if (!context) {
        throw new Error('Patient not found')
    }

    // Drafting is a quote operation, so it is also the point at which the
    // catalogue's shared copy is guaranteed to match the seed. Memoised per
    // process, and cached, so this costs one read per run in practice.
    await ensureNdisCataloguePublished()

    const aiConfig = await resolveQuoteWriterAiConfig(domain)
    const messages = buildQuoteDraftMessages({
        evidence: context.evidence,
        config: settings,
        fundingSource: context.fundingContext.fundingSource,
        subjectNoun: resolveSubjectNoun({
            fundingSource: context.fundingContext.fundingSource,
            ndisNumber: context.fundingContext.referenceNumber,
        }),
    })

    const payload = await requestQuoteDraft({ aiConfig, messages, signal, identity: context.identity })
    // The model never saw a name, so it wrote "the participant". The quote is a local, single-subject
    // document, so the real name goes back into the summary and each line's justification.
    const draft = restoreIdentityDeep(
        normalizeQuoteDraftResponse(payload, { pricingRegion: settings.pricingRegion }),
        context.identity
    )

    const result = {
        patientId,
        patientName: context.patientName,
        fundingContext: context.fundingContext,
        config: settings,
        aiConfig,
        summary: draft.summary,
        lines: draft.lines,
        dropped: draft.dropped,
        proposedCount: draft.proposedCount,
        quoteId: null,
        created: false,
        replacedLineCount: 0,
        skippedReason: null,
    }

    if (!persist) return result

    const written = await writeQuoteDraft(connection, {
        domain,
        patientId,
        patientName: context.patientName,
        fundingContext: context.fundingContext,
        config: settings,
        draft,
        jobId,
    })

    return { ...result, ...written }
}

/**
 * Creates or refreshes the worker's draft for this participant.
 *
 * Safety rules, in order:
 *   1. A quote the practitioner has already moved past `draft` is never touched —
 *      the job reports `quote-already-actioned` instead.
 *   2. A re-run replaces only the lines the worker wrote (matched on
 *      `metadata.origin`), so hand-added lines survive a refresh.
 *   3. A run that produces no lines leaves any existing draft alone rather than
 *      blanking it.
 */
async function writeQuoteDraft(connection, {
    domain,
    patientId,
    patientName,
    fundingContext,
    config,
    draft,
    jobId,
} = {}) {
    const existing = await connection.query(
        'SELECT id, status FROM patient_quotes WHERE domain = $1 AND external_source = $2 AND external_id = $3 LIMIT 1',
        [domain, QUOTE_WRITER_ORIGIN, String(patientId)]
    )
    const existingQuote = existing.rows?.[0] || null

    if (existingQuote && cleanText(existingQuote.status).toLowerCase() !== 'draft') {
        return {
            quoteId: existingQuote.id,
            created: false,
            replacedLineCount: 0,
            skippedReason: 'quote-already-actioned',
        }
    }

    if (!draft.lines.length) {
        return {
            quoteId: existingQuote?.id || null,
            created: false,
            replacedLineCount: 0,
            skippedReason: 'no-supported-lines',
        }
    }

    const header = buildQuoteDraftHeader({ fundingContext, config, preparedBy: QUOTE_WRITER_LABEL })
    const metadata = buildQuoteMetadata({
        summary: draft.summary,
        dropped: draft.dropped,
        config,
        jobId,
    })
    const notes = buildQuoteDraftNotes({ summary: draft.summary, dropped: draft.dropped, pricingRegion: config.pricingRegion })

    let quoteId = existingQuote?.id || null

    if (quoteId) {
        await connection.query(
            `UPDATE patient_quotes
             SET status = 'draft', funding_type = $1, pricing_region = $2, ndis_number = $3,
                 quote_date = $4, valid_until = $5, prepared_by = $6, gst_applicable = $7,
                 notes = $8, metadata = $9::jsonb, updated_at = NOW()
             WHERE id = $10 AND domain = $11`,
            [
                header.funding_type, header.pricing_region, header.ndis_number, header.quote_date,
                header.valid_until, header.prepared_by, header.gst_applicable, notes,
                JSON.stringify(metadata), quoteId, domain,
            ]
        )
    } else {
        const quoteNumber = await nextQuoteNumber(connection, domain)
        const inserted = await connection.query(
            `INSERT INTO patient_quotes (
                domain, patient_id, quote_number, status, funding_type, pricing_region,
                plan_manager, ndis_number, quote_date, valid_until, prepared_by,
                gst_applicable, notes, metadata, external_id, external_source, external_patient_id
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16, $17)
             RETURNING id`,
            [
                domain, patientId, quoteNumber, header.status, header.funding_type, header.pricing_region,
                null, header.ndis_number, header.quote_date, header.valid_until, header.prepared_by,
                header.gst_applicable, notes, JSON.stringify(metadata), String(patientId), QUOTE_WRITER_ORIGIN,
                String(patientId),
            ]
        )
        quoteId = inserted.rows?.[0]?.id || null
        if (!quoteId) throw new Error('Failed to create the draft quote')
    }

    const removed = await connection.query(
        `DELETE FROM quote_items
         WHERE quote_id = $1 AND domain = $2
           AND metadata IS NOT NULL
           AND metadata->>'origin' = $3`,
        [quoteId, domain, QUOTE_WRITER_ORIGIN]
    )
    const replacedLineCount = Number(removed?.rowCount || 0)

    const maxResult = await connection.query(
        'SELECT COALESCE(MAX(position), 0) AS max_position FROM quote_items WHERE quote_id = $1 AND domain = $2',
        [quoteId, domain]
    )
    let position = Math.trunc(toFinite(maxResult.rows?.[0]?.max_position))
    const itemMetadata = JSON.stringify(buildQuoteItemMetadata({ jobId }))

    for (const line of draft.lines) {
        position += 1
        await connection.query(
            `INSERT INTO quote_items (
                domain, quote_id, patient_id, position, ndis_support_item_number,
                ndis_support_item_name, registration_group_number, registration_group_name,
                support_category_number, support_category_name, unit, quantity, unit_price,
                price_limit, quote_required, description, metadata
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb)`,
            [
                domain, quoteId, patientId, position, line.ndis_support_item_number,
                line.ndis_support_item_name, line.registration_group_number, line.registration_group_name,
                line.support_category_number, line.support_category_name, line.unit, line.quantity,
                roundMoney(line.unit_price), line.price_limit, line.quote_required, line.description,
                itemMetadata,
            ]
        )
    }

    return {
        quoteId,
        created: !existingQuote,
        replacedLineCount,
        skippedReason: null,
    }
}

// ---------------------------------------------------------------------------
// Queue lifecycle
// ---------------------------------------------------------------------------

function parseJobPayload(row) {
    const raw = row?.payload_json
    if (raw && typeof raw === 'object') return raw
    try {
        const parsed = JSON.parse(String(raw || '{}'))
        return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
        return {}
    }
}

export async function ensureQuoteWriterTables(connection) {
    await ensureQuoteWriterQueueTable(connection, 'postgresql')
}

async function reclaimStaleJobs(connection, table, minutes) {
    const result = await connection.query(
        `UPDATE ${table} SET status = 'queued', claimed_at = NULL, claimed_by = NULL, updated_at = NOW()
         WHERE status = 'processing' AND claimed_at <= (NOW() AT TIME ZONE 'UTC') - ($1 || ' minutes')::interval`,
        [minutes]
    )
    return Number(result?.rowCount || 0)
}

async function claimJobs(connection, table, { batchSize, maxAttempts }, workerId) {
    const result = await connection.query(
        `WITH candidate AS (
           SELECT id FROM ${table}
           WHERE status = 'queued'
             AND (next_attempt_at IS NULL OR next_attempt_at <= (NOW() AT TIME ZONE 'UTC'))
             AND COALESCE(attempts, 0) < COALESCE(max_attempts, $1)
           ORDER BY created_at ASC
           LIMIT $2
           FOR UPDATE SKIP LOCKED
         )
         UPDATE ${table} q
         SET status = 'processing', claimed_at = NOW(), claimed_by = $3, updated_at = NOW()
         FROM candidate
         WHERE q.id = candidate.id
         RETURNING q.*`,
        [maxAttempts, batchSize, workerId]
    )
    return result.rows || []
}

async function markJobCompleted(connection, table, id) {
    await connection.query(
        `UPDATE ${table} SET status = 'completed', completed_at = NOW(), error_message = NULL, updated_at = NOW() WHERE id = $1`,
        [id]
    )
}

async function markJobFailed(connection, table, row, error, maxAttempts) {
    const attempts = Number(row?.attempts || 0) + 1
    const exhausted = attempts >= Number(row?.max_attempts || maxAttempts)
    const nextStatus = exhausted ? 'failed' : 'queued'
    const message = cleanText(error?.message || `${QUOTE_WRITER_LABEL} job failed`).slice(0, 2000)

    // Both `$3` uses need an explicit ::text cast, or Postgres deduces
    // `character varying` for the assignment and `text` from the comparison and
    // rejects the statement with 42P08 (leaving the job stuck in `processing`).
    await connection.query(
        `UPDATE ${table}
         SET attempts = $2::integer,
             status = $3::text,
             error_message = $4,
             next_attempt_at = CASE WHEN $3::text = 'queued' THEN (NOW() AT TIME ZONE 'UTC') + ($5 || ' seconds')::interval ELSE NULL END,
             updated_at = NOW()
         WHERE id = $1::bigint`,
        [row.id, attempts, nextStatus, message, RETRY_DELAY_SECONDS]
    )
}

/**
 * Drains queued Quote Writer jobs. Returns a summary instead of throwing so a
 * single bad job never stops the cycle.
 */
export async function runQuoteWriterCycle({ forceRun = false, batchSize = null } = {}) {
    const config = getQuoteWriterConfig()
    if (!config.workerEnabled && forceRun !== true) {
        return { skipped: true, reason: 'disabled' }
    }

    if (detectDatabaseType() !== 'postgresql') {
        return { skipped: true, reason: 'unsupported-db' }
    }

    let connection = null
    try {
        // Called before the connection is taken: it opens its own short-lived one.
        await ensurePatientQuotesTables()
        connection = await getDatabaseConnection()
        const table = config.queueTable
        await ensureQuoteWriterTables(connection)

        const reclaimed = await reclaimStaleJobs(connection, table, config.staleProcessingMinutes)
        const limit = Number.isFinite(batchSize) && batchSize > 0 ? Math.floor(batchSize) : config.batchSize
        const jobs = await claimJobs(connection, table, { batchSize: limit, maxAttempts: config.maxAttempts }, `one-quote-writer-${process.pid}`)

        if (!jobs.length) {
            return { skipped: true, reason: reclaimed ? 'reclaimed-only' : 'empty', reclaimed }
        }

        let completed = 0
        let failed = 0
        const outcomes = []

        for (const row of jobs) {
            const payload = parseJobPayload(row)
            try {
                const result = await generateQuoteDraftForPatient({
                    connection,
                    domain: row.domain,
                    patientId: Number(row.patient_id),
                    config: payload?.metadata?.patientAgents?.quoteWriterConfig,
                    jobId: row.id,
                })
                await markJobCompleted(connection, table, row.id)
                completed += 1
                outcomes.push({ jobId: row.id, quoteId: result.quoteId, lineCount: result.lines.length, skippedReason: result.skippedReason })
            } catch (error) {
                await markJobFailed(connection, table, row, error, config.maxAttempts)
                failed += 1
                outcomes.push({ jobId: row.id, error: cleanText(error?.message) })
            }
        }

        return { skipped: false, reclaimed, claimed: jobs.length, completed, failed, outcomes }
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
    }
}

/** Per-status job counts for the queue, for the drain endpoint's status read. */
export async function readQuoteWriterQueueSummary(connection) {
    const table = resolveQuoteWriterQueueTableName()
    const empty = { queued: 0, processing: 0, completed: 0, failed: 0 }

    try {
        const result = await connection.query(
            `SELECT status, COUNT(*)::int AS count FROM ${table} GROUP BY status`
        )
        const counts = { ...empty }
        for (const row of result.rows || []) {
            const key = cleanText(row?.status).toLowerCase()
            if (Object.prototype.hasOwnProperty.call(counts, key)) {
                counts[key] = Number(row.count) || 0
            }
        }
        return counts
    } catch (error) {
        if (isMissingTableError(error)) return empty
        throw error
    }
}

export {
    QUOTE_WRITER_ACTION_DRAFT,
    QUOTE_WRITER_EVENT_CONFIG_CHANGED,
    QUOTE_WRITER_EVENT_ENABLED,
    QUOTE_WRITER_EVENT_REQUESTED,
    QUOTE_WRITER_EVIDENCE_LIMITS,
}
