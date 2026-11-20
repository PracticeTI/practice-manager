// Enqueueing for the FCA Analyst worker.
//
// The analyst runs in the worker service, but the decision to run one belongs here: the AI
// selection lives in this app (AI & Defaults + the published model catalog), and the analyst is
// model-only, so a job queued without an `aiUsage` block falls back to a hardcoded worker default
// and quietly ignores the domain's chosen provider and model.
//
// This module therefore owns every analyst enqueue path:
//   * `enqueuePatientAnalysisJob` - one patient, used by the agent toggle, the config save, the
//     create-patient flow, and the Analysis tab's "Re-run analysis" action.
//   * `enqueueMissingAnalysisJobs` - the backfill, driven by
//     `POST /api/database/patients/analysis/run-jobs`. It used to live inside the worker service
//     (`two`), where it could not see the AI selection - which is exactly how an analysis came back
//     as `gpt-5-mini` after the operator had selected a flagship model.

import { enqueueAnalysisTask } from '@/lib/serviceClient'
import { buildReportAiUsagePayload } from '@/lib/reportAiUsagePayload'
import { loadAnalysisEvidenceDocuments } from '@/lib/analysisEvidenceDocuments'
import { missingTables, runOptionalDdl } from './pgOptionalDdl.js'

const DEFAULT_ANALYSIS_QUEUE_TABLE = 'patient_analysis_jobs'
const DEFAULT_PATIENT_ANALYSIS_TABLE = 'patient_analysis'
const DEFAULT_BACKFILL_LIMIT = 5
const MAX_BACKFILL_LIMIT = 50

function isSafeSqlIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || '').trim())
}

export function resolveAnalysisQueueTableName() {
    const table = String(process.env.ANALYSIS_QUEUE_TABLE || DEFAULT_ANALYSIS_QUEUE_TABLE).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error('ANALYSIS_QUEUE_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
    }
    return table
}

export function resolvePatientAnalysisTableName() {
    const table = String(process.env.PATIENT_ANALYSIS_TABLE || DEFAULT_PATIENT_ANALYSIS_TABLE).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error('PATIENT_ANALYSIS_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
    }
    return table
}

/** Whether the FCA Analyst agent is switched on for a patient's metadata. */
export function isAnalystAgentEnabled(metadata) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false

    for (const key of ['patientAgents', 'agents']) {
        const agents = metadata[key]
        if (agents && typeof agents === 'object' && !Array.isArray(agents)) {
            return agents.analyst === true || agents.analysis === true
        }
    }

    return false
}

export function getAnalysisQueueSchemaStatements(table) {
    return {
        create: `
  CREATE TABLE IF NOT EXISTS ${table} (
    id BIGSERIAL PRIMARY KEY,
    status VARCHAR(32) NOT NULL DEFAULT 'queued',
    domain VARCHAR(100) NOT NULL,
    patient_id BIGINT NOT NULL,
    patient_name TEXT,
    event_type VARCHAR(80) NOT NULL DEFAULT 'analyst_enabled',
    requested_action VARCHAR(80) NOT NULL DEFAULT 'prepare_fca_suggestions',
    payload_json TEXT NOT NULL DEFAULT '{}',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER,
    next_attempt_at TIMESTAMP NULL,
    claimed_at TIMESTAMP NULL,
    claimed_by VARCHAR(128),
    completed_at TIMESTAMP NULL,
    error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`,
        indexes: [
            `CREATE INDEX IF NOT EXISTS ${table}_status_next_attempt_idx ON ${table} (status, next_attempt_at)`,
            `CREATE INDEX IF NOT EXISTS ${table}_domain_created_idx ON ${table} (domain, created_at)`
        ]
    }
}

export async function ensureLocalAnalysisQueueTable(connection, table) {
    const schema = getAnalysisQueueSchemaStatements(table)
    // `CREATE TABLE IF NOT EXISTS` still asks for CREATE on the schema, so a
    // constrained runtime role is refused even when the queue table is already there.
    if ((await missingTables(connection, [table])).length > 0) {
        await connection.query(schema.create)
    }

    // A non-owner role cannot create the indexes; the queue still works without them.
    for (const indexStatement of schema.indexes) {
        await runOptionalDdl(connection, indexStatement)
    }
}

async function enqueuePatientAnalysisJobLocalFallback({ connection, patientId, patientName, domain, metadata, documents, eventType, source, aiUsage }) {
    const table = resolveAnalysisQueueTableName()
    await ensureLocalAnalysisQueueTable(connection, table)

    const payload = {
        domain,
        patientId,
        patientName,
        metadata,
        documents: Array.isArray(documents) ? documents : [],
        aiUsage: aiUsage && typeof aiUsage === 'object' ? aiUsage : {},
        source: String(source || 'one:patient-agent-toggle') + ':local-db-fallback'
    }

    const result = await connection.query(
        `
    INSERT INTO ${table} (
      status,
      domain,
      patient_id,
      patient_name,
      event_type,
      requested_action,
      payload_json,
      attempts,
      created_at,
      updated_at
    ) VALUES (
      'queued',
      $1,
      $2,
      $3,
      $4,
      'prepare_fca_suggestions',
      $5,
      0,
      NOW(),
      NOW()
    )
    RETURNING id
  `,
        [domain, patientId, patientName || null, eventType || 'analyst_enabled', JSON.stringify(payload)]
    )

    return {
        success: true,
        queued: true,
        id: result?.rows?.[0]?.id || null,
        domain,
        patientId,
        requestedAction: 'prepare_fca_suggestions',
        source: 'local-db-fallback'
    }
}

/**
 * Queue one analyst run.
 *
 * The domain's AI selection travels with the job, so the worker never has to guess a model.
 *
 * The patient's in-scope reference documents travel too, already extracted: the worker service has
 * no DOCX reader, so the text has to be produced here. Callers inside an RLS transaction can pass
 * `documents` themselves; otherwise they are loaded on a connection of their own.
 */
export async function enqueuePatientAnalysisJob({ connection, patientId, patientName, domain, metadata, documents, eventType = 'analyst_enabled', source = 'one:patient-agent-toggle' }) {
    // The analyst runs on a model, so the domain's AI selection has to travel with the job exactly
    // as it does for report generation. Without it the analyst has no provider, model, or base URL.
    const aiUsage = await buildReportAiUsagePayload(domain)
    const evidenceDocuments = Array.isArray(documents)
        ? documents
        : await loadAnalysisEvidenceDocuments({ domain, patientId })

    let upstreamResult = null
    try {
        upstreamResult = await enqueueAnalysisTask({
            domain,
            patientId,
            patientName,
            eventType,
            requestedAction: 'prepare_fca_suggestions',
            payload: {
                domain,
                patientId,
                patientName,
                metadata,
                documents: evidenceDocuments,
                aiUsage,
                source
            }
        })
    } catch (error) {
        upstreamResult = {
            success: false,
            error: error?.message || 'Failed to enqueue analysis job'
        }
    }

    if (upstreamResult?.success || upstreamResult?.queued === true) {
        return upstreamResult
    }

    const fallbackResult = await enqueuePatientAnalysisJobLocalFallback({
        connection,
        domain,
        patientId,
        patientName,
        metadata,
        documents: evidenceDocuments,
        eventType,
        source,
        aiUsage
    })

    if (!fallbackResult?.success && fallbackResult?.queued !== true) {
        throw new Error(upstreamResult?.error || 'Failed to enqueue analysis job')
    }

    return {
        ...fallbackResult,
        upstreamUnavailable: true,
        upstreamError: upstreamResult?.error || null
    }
}

/**
 * Queue analyst runs for patients who have the analyst agent enabled but no stored analysis.
 *
 * This is the backfill that used to run inside the worker service. It picks only patients with no
 * `patient_analysis` row and no job already queued or processing, so it self-heals a deleted
 * analysis without ever re-running one that already exists.
 */
export async function enqueueMissingAnalysisJobs({ connection, limit } = {}) {
    const queueTable = resolveAnalysisQueueTableName()
    const analysisTable = resolvePatientAnalysisTableName()
    const parsedLimit = Number.parseInt(String(limit ?? ''), 10)
    const batchSize = Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, MAX_BACKFILL_LIMIT)
        : DEFAULT_BACKFILL_LIMIT

    await ensureLocalAnalysisQueueTable(connection, queueTable)

    const candidates = (await connection.query(
        `
            SELECT p.id, p.domain, p.patient_name, p.metadata
            FROM patients p
            LEFT JOIN ${analysisTable} a
                ON a.domain = p.domain
             AND a.patient_id = p.id
            WHERE a.id IS NULL
                AND (
                    p.metadata->'patientAgents'->>'analyst' = 'true'
                    OR p.metadata->'patientAgents'->>'analysis' = 'true'
                    OR p.metadata->'agents'->>'analyst' = 'true'
                    OR p.metadata->'agents'->>'analysis' = 'true'
                )
                AND NOT EXISTS (
                    SELECT 1
                    FROM ${queueTable} q
                    WHERE q.domain = p.domain
                      AND q.patient_id = p.id
                      AND q.status IN ('queued', 'processing')
                )
            ORDER BY p.updated_at DESC NULLS LAST, p.id DESC
            LIMIT $1
        `,
        [batchSize]
    )).rows || []

    const results = []
    for (const candidate of candidates) {
        try {
            const result = await enqueuePatientAnalysisJob({
                connection,
                patientId: candidate.id,
                patientName: candidate.patient_name,
                domain: candidate.domain,
                metadata: candidate.metadata,
                eventType: 'analyst_backfill',
                source: 'one:analysis-backfill'
            })
            results.push({ patientId: candidate.id, queued: result?.queued === true || result?.success === true, error: result?.error || null })
        } catch (error) {
            results.push({ patientId: candidate.id, queued: false, error: error?.message || 'Failed to enqueue' })
        }
    }

    return {
        candidates: candidates.length,
        queued: results.filter((item) => item.queued).length,
        failed: results.filter((item) => !item.queued).length,
        results
    }
}
