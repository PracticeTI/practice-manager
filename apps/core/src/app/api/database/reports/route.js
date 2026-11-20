import { NextResponse } from 'next/server'
import { verifyAdminToken } from '@/lib/auth'
import { detectDatabaseType } from '@/lib/database'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { enqueueReportTask } from '@/lib/serviceClient'
import { readReportConfigForDomain, readReportSettingsForDomain } from '@/lib/reportSettingsStore'
import { getReportAiProviderApiKeyAvailability, resolveReportAiSelection } from '@/lib/reportAiProviders'
import { resolveAiProviderApiKey } from '@/lib/ai/credentials'
import { readAiProviderModelCatalog } from '@/lib/aiProviderModelCatalog'
import { mergeReportRows } from '@/lib/reportListUtils'
import { isOtf10ReportType, isNdisFcaReportType, selectHsrReportType } from '@/lib/reportTypeSelection'
import { loadAnalysisEvidenceDocumentIds } from '@/lib/analysisEvidenceDocuments'
import { readDomainPracticeName } from '@/lib/domainPracticeName'
import { runOptionalDdl } from '@/lib/pgOptionalDdl'
import { ensureLocalReportQueueTable } from '@/lib/patientQueueFallbacks'

const DEFAULT_REPORTS_TABLE = 'patient_reports'
const DEFAULT_REPORT_DRAFTS_TABLE = 'patient_report_drafts'
const DEFAULT_REPORT_QUEUE_TABLE = 'patient_report_jobs'
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100
const DEFAULT_WINDOW_DAYS = 30
const PENDING_DELETE_STATUS = 'pending delete'
const REPORT_RESTORE_DEFAULT_STATUS = 'ready'

function isSafeSqlIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || '').trim())
}

function resolveReportsTables() {
    const draftsTable = String(process.env.PATIENT_REPORT_DRAFTS_TABLE || DEFAULT_REPORT_DRAFTS_TABLE).trim()
    const reportsTable = String(process.env.PATIENT_REPORTS_TABLE || DEFAULT_REPORTS_TABLE).trim()

    if (!isSafeSqlIdentifier(draftsTable)) {
        throw new Error('PATIENT_REPORT_DRAFTS_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
    }

    if (!isSafeSqlIdentifier(reportsTable)) {
        throw new Error('PATIENT_REPORTS_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
    }

    // Prefer canonical report rows first so list timestamps match patient report "Last updated".
    return Array.from(new Set([reportsTable, draftsTable]))
}

function normalizeDomainKey(value) {
    return String(value || '').trim().toLowerCase()
}

function resolveReportQueueTableName() {
    const table = String(process.env.REPORT_QUEUE_TABLE || DEFAULT_REPORT_QUEUE_TABLE).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error('REPORT_QUEUE_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
    }
    return table
}

function parsePositiveInteger(value, fallback) {
    const parsed = Number.parseInt(String(value || '').trim(), 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseWindowDays(value) {
    if (String(value || '').trim().toLowerCase() === 'all') {
        return null
    }

    const parsed = parsePositiveInteger(value, DEFAULT_WINDOW_DAYS)
    return Math.min(365, parsed)
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

function isHsrCreatorEnabled(metadata) {
    const agents = metadata?.patientAgents || metadata?.agents
    return Boolean(agents && typeof agents === 'object' && !Array.isArray(agents) && agents.hsrCreator === true)
}

async function readPatientForReportBackfill(connection, domain, patientId) {
    if (!Number.isFinite(Number(patientId)) || Number(patientId) <= 0) return null

    const result = await connection.query(
        'SELECT id, patient_name, metadata FROM patients WHERE domain = $1 AND id = $2 LIMIT 1',
        [domain, patientId]
    )
    return result?.rows?.[0] || null
}

function normalizeString(value, fallback = '') {
    const normalized = String(value || '').trim()
    return normalized || fallback
}

function normalizeTimestampUtc(value) {
    if (!value) return null
    if (value instanceof Date) {
        const ts = value.getTime()
        return Number.isFinite(ts) ? value.toISOString() : null
    }

    const text = String(value || '').trim()
    if (!text) return null

    const parsed = Date.parse(text)
    if (Number.isFinite(parsed)) {
        return new Date(parsed).toISOString()
    }

    return text
}

function normalizeReportOptions(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return value
}

function normalizeBuilderState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    return value
}

function resolveProviderApiKey(provider) {
    return normalizeString(resolveAiProviderApiKey(provider))
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

function isTextTemplateMimeType(mimeType) {
    const normalized = String(mimeType || '').trim().toLowerCase()
    if (!normalized) return false

    if (normalized.startsWith('text/')) return true
    if (normalized.includes('markdown')) return true
    if (normalized.includes('html')) return true
    return false
}

function normalizeReportSourceTable(value) {
    const normalized = String(value || '').trim().toLowerCase()
    if (!normalized) {
        return ''
    }

    try {
        const tables = [...resolveReportsTables(), resolveReportQueueTableName()]
        for (const table of tables) {
            if (String(table || '').trim().toLowerCase() === normalized) {
                return table
            }
        }
    } catch {
        return ''
    }

    return ''
}

function buildRecyclingMetadata(sourceMetadata, existingStatus) {
    const metadata = sourceMetadata && typeof sourceMetadata === 'object' ? sourceMetadata : {}
    const recycling = metadata.recycling && typeof metadata.recycling === 'object' ? metadata.recycling : {}
    const normalizedExistingStatus = String(existingStatus || '').trim().toLowerCase() || REPORT_RESTORE_DEFAULT_STATUS
    const previousStatus = normalizedExistingStatus === PENDING_DELETE_STATUS
        ? String(recycling.previousStatus || REPORT_RESTORE_DEFAULT_STATUS).trim().toLowerCase() || REPORT_RESTORE_DEFAULT_STATUS
        : normalizedExistingStatus

    return {
        ...metadata,
        recycling: {
            ...recycling,
            previousStatus,
            deletedAt: new Date().toISOString(),
        },
    }
}

async function enqueueReportJobLocalFallback({ connection, domain, patientId, patientName, payload, eventType = 'reporting_enabled', requestedAction = 'create_or_edit' }) {
    const table = resolveReportQueueTableName()
    await ensureLocalReportQueueTable(connection, table)

    // The worker's schema declares patient_id NOT NULL, but this route can queue a
    // report for a patient that has no record yet. Only the table owner can relax
    // that, so this lands on local databases and is skipped for a constrained
    // runtime role (see lib/pgOptionalDdl.js).
    try {
        await runOptionalDdl(connection, `ALTER TABLE ${table} ALTER COLUMN patient_id DROP NOT NULL`)
    } catch (error) {
        const message = String(error?.message || '')
        if (!message.includes('does not exist') && !message.includes('does not have') && !message.includes('already')) {
            throw error
        }
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
                $5,
                $6,
                0,
                NOW(),
                NOW()
            )
            RETURNING id
        `,
        [domain, patientId || null, patientName || null, eventType, requestedAction, JSON.stringify(payload)]
    )

    return {
        success: true,
        queued: true,
        id: result?.rows?.[0]?.id || null,
        domain,
        patientId: patientId || null,
        requestedAction,
        source: 'local-db-fallback',
    }
}

function normalizeAiOverrideOptions(reportTypeOptions) {
    const source = reportTypeOptions && typeof reportTypeOptions === 'object' && !Array.isArray(reportTypeOptions)
        ? reportTypeOptions
        : {}
    const nestedAi = source.ai && typeof source.ai === 'object' && !Array.isArray(source.ai)
        ? source.ai
        : {}

    const provider = normalizeString(
        source.aiProvider
        || source.provider
        || nestedAi.provider
        || ''
    )
    const modelTier = normalizeString(
        source.aiModelTier
        || source.modelTier
        || nestedAi.modelTier
        || ''
    )
    const model = normalizeString(
        source.aiModel
        || source.model
        || source.reportModel
        || nestedAi.model
        || ''
    )
    const baseUrl = normalizeString(
        source.aiBaseUrl
        || source.baseUrl
        || nestedAi.baseUrl
        || ''
    )

    return {
        provider,
        modelTier,
        model,
        baseUrl,
    }
}

async function buildReportAiUsagePayload(domain, reportTypeOptions = {}) {
    const domainKey = normalizeDomainKey(domain)
    const [config, catalog] = await Promise.all([
        readReportConfigForDomain(domainKey),
        readAiProviderModelCatalog(),
    ])
    const overrides = normalizeAiOverrideOptions(reportTypeOptions)
    const selected = resolveReportAiSelection({
        ...config,
        aiProvider: overrides.provider || config?.aiProvider,
        aiModelTier: overrides.modelTier || config?.aiModelTier,
        providerModels: catalog?.models,
    })
    const providerApiKeyStatus = getReportAiProviderApiKeyAvailability()
    const model = overrides.model || selected.model
    const baseUrl = overrides.baseUrl || selected.baseUrl
    const apiKey = resolveProviderApiKey(selected.provider)

    return {
        gateway: selected.provider === 'openai' ? 'openai' : 'direct',
        vendor: selected.providerLabel,
        provider: selected.provider,
        modelTier: selected.tier,
        model,
        baseUrl,
        hasApiKey: providerApiKeyStatus[selected.provider] === true,
        apiKey: apiKey || undefined,
    }
}

function deriveReportTypeConfig(domain, settings, requestedTypeId = '') {
    const normalizedSettings = settings?.settings && typeof settings.settings === 'object'
        ? settings.settings
        : settings
    const templates = Array.isArray(settings?.templates) ? settings.templates : []
    const reportTypes = Array.isArray(normalizedSettings?.reportTypes) ? normalizedSettings.reportTypes : []
    const config = normalizedSettings?.config && typeof normalizedSettings.config === 'object' ? normalizedSettings.config : {}
    const configuredTypes = reportTypes.filter((item) => item && typeof item === 'object')

    if (configuredTypes.length === 0) {
        return {
            reportTypeId: '',
            reportTypeName: 'default',
            reportTypeOptions: {},
        }
    }

    const requested = normalizeString(requestedTypeId || config.defaultReportTypeId || '', '')
    const selectedType = configuredTypes.find((item) => String(item?.id || '').trim() === requested)
    const resolvedType = selectedType || configuredTypes[0]
    const templateId = String(resolvedType?.templateId || '').trim()
    const selectedTemplate = templateId
        ? templates.find((item) => String(item?.id || '').trim() === templateId)
        : null

    const selectedTemplateMimeType = String(selectedTemplate?.mimeType || '').trim()
    const selectedTemplateContent = selectedTemplate && isTextTemplateMimeType(selectedTemplateMimeType)
        ? stripEmbeddedDataImageMarkup(decodeTemplateContentBase64(selectedTemplate.contentBase64))
        : ''

    const reportTemplate = selectedTemplate && selectedTemplateContent
        ? {
            id: String(selectedTemplate.id || '').trim() || null,
            name: String(selectedTemplate.name || '').trim() || null,
            fileName: String(selectedTemplate.fileName || '').trim() || null,
            mimeType: selectedTemplateMimeType || null,
            content: selectedTemplateContent.slice(0, 200000),
        }
        : null

    return {
        reportTypeId: String(resolvedType?.id || '').trim(),
        reportTypeName: String(resolvedType?.name || '').trim() || 'default',
        reportTypeOptions: normalizeReportOptions(resolvedType?.config || resolvedType?.options || {}),
        reportTemplateId: templateId || null,
        reportTemplate,
    }
}

function deriveHsrReportTypeConfig(domain, settings, deletedReportMetadata = {}) {
    const normalizedSettings = settings?.settings && typeof settings.settings === 'object'
        ? settings.settings
        : settings
    const reportTypes = Array.isArray(normalizedSettings?.reportTypes)
        ? normalizedSettings.reportTypes.filter((item) => item && typeof item === 'object')
        : []
    const requestedTypeId = normalizeString(deletedReportMetadata?.reportTypeId || '')
    const requestedTypeName = normalizeString(deletedReportMetadata?.reportType || '')
    const resolvedType = selectHsrReportType(reportTypes, deletedReportMetadata)

    if (!resolvedType && (isOtf10ReportType(requestedTypeId) || isOtf10ReportType(requestedTypeName))) {
        throw new Error('Configured OTF10 Home Services Review report type no longer exists')
    }
    if (!resolvedType) {
        throw new Error('No active OTF10 Home Services Review report type is configured for HSR backfill')
    }

    return deriveReportTypeConfig(domain, settings, normalizeString(resolvedType.id || ''))
}

function stripMarkdown(value) {
    return String(value || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/<img\b[^>]*>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/[#>*_`~-]/g, ' ')
        .replace(/\r?\n+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

function buildReportPreview(reportMarkdown, sourceNotes) {
    const text = stripMarkdown(sourceNotes || reportMarkdown)
    if (!text) return ''
    return text.length > 180 ? `${text.slice(0, 177)}...` : text
}

function mapQueueStatusLabel(status, row) {
    const normalized = String(status || '').trim().toLowerCase()
    const eventType = String(row?.event_type || '').trim().toLowerCase()
    const isUpdateAction = eventType === 'reporting_config_changed'

    if (normalized === 'queued') {
        return isUpdateAction ? 'Update Pending' : 'Creating'
    }
    if (normalized === 'processing') {
        return isUpdateAction ? 'Updating' : 'Creating'
    }
    if (normalized === 'failed') return 'Failed'
    if (normalized === 'completed') return 'Ready'
    return 'Waiting'
}

/**
 * Which of these patients already have a published report (`patient_reports` row)?
 *
 * The dashboard uses this to decide whether a report tile opens the patient's
 * current report or the report type's builder. It cannot be inferred from the
 * listed rows: a patient's newest row is often a *draft* saved after the worker
 * published the report (so the row is newer than the published one), and the
 * 50-row window can be filled by a single patient's draft history.
 */
async function fetchPatientIdsWithCurrentReport(connection, table, domain, patientIds) {
    const ids = [...new Set((Array.isArray(patientIds) ? patientIds : [])
        .map((value) => Number.parseInt(String(value ?? ''), 10))
        .filter((value) => Number.isFinite(value) && value > 0))]

    if (ids.length === 0) return new Set()

    const result = await connection.query(
        `SELECT DISTINCT patient_id
         FROM ${table}
         WHERE domain = $1 AND patient_id = ANY($2::int[])`,
        [domain, ids]
    )

    return new Set((result.rows || [])
        .map((row) => String(row.patient_id ?? '').trim())
        .filter(Boolean))
}

function normalizeReportRow(row) {
    if (!row || typeof row !== 'object') return null

    const sourceMetadata = parseJsonObject(row.source_metadata_json || row.sourceMetadata || null)
    const reportMarkdown = String(row.report_markdown ?? row.reportMarkdown ?? '').trim()
    const sourceNotes = String(row.source_notes ?? row.sourceNotes ?? '').trim()
    const updatedAt = normalizeTimestampUtc(row.updated_at_utc || row.updatedAtUtc || row.updated_at || row.updatedAt)
    const createdAt = normalizeTimestampUtc(row.created_at_utc || row.createdAtUtc || row.created_at || row.createdAt)
    const generatedAt = String(
        sourceMetadata?.generatedAt
        || sourceMetadata?.generated_at
        || ''
    ).trim() || null
    const sourceTable = String(row.sourceTable || '').trim()
    const rowId = row.id
    const normalizedStatus = String(row.status || '').trim().toLowerCase()
    const displayTimestamp = generatedAt
        || (normalizedStatus === 'queued' || normalizedStatus === 'creating' || normalizedStatus === 'processing' || normalizedStatus === 'waiting'
            ? createdAt || updatedAt || null
            : updatedAt || createdAt || null)

    return {
        id: rowId,
        domain: row.domain,
        patientId: row.patient_id ?? row.patientId ?? null,
        patientName: row.patient_name ?? row.patientName ?? '',
        preview: row.preview || buildReportPreview(reportMarkdown, sourceNotes),
        reportMarkdown,
        sourceNotes,
        sourceMetadata,
        generatedAt,
        createdAt,
        updatedAt,
        timestamp: displayTimestamp,
        sourceTable: sourceTable || null,
        status: row.status || null,
        statusLabel: row.statusLabel || null,
        lastJobId: row.last_job_id ?? row.lastJobId ?? null,
        listKey: row.listKey || `${sourceTable || 'unknown'}:${rowId ?? ''}`,
        // Whether the *patient* has a published report — not whether this row is one.
        // Tri-state on purpose: only an explicit false means "no current report", so a
        // caller reading a payload written before this flag existed keeps its old
        // behaviour instead of launching a builder.
        hasCurrentReport: typeof row.hasCurrentReport === 'boolean' ? row.hasCurrentReport : null,
    }
}

async function markReportPendingDelete(connection, table, domain, id) {
    const existingResult = await connection.query(
        `SELECT id, status, source_metadata_json
         FROM ${table}
         WHERE id = $1 AND domain = $2
         LIMIT 1`,
        [id, domain]
    )
    const existing = existingResult.rows?.[0] || null
    if (!existing) return null

    const nextSourceMetadata = buildRecyclingMetadata(parseJsonObject(existing.source_metadata_json || null), existing.status)

    const updateResult = await connection.query(
        `UPDATE ${table}
         SET status = $1,
             source_metadata_json = $2::jsonb,
             updated_at = NOW()
         WHERE id = $3 AND domain = $4
         RETURNING id, domain, patient_id, patient_name, report_markdown, source_notes, source_metadata_json, created_at, updated_at, status`,
        [PENDING_DELETE_STATUS, JSON.stringify(nextSourceMetadata), id, domain]
    )

    return updateResult.rows?.[0] || null
}

async function markQueueReportPendingDelete(connection, table, domain, id) {
    const existingResult = await connection.query(
        `SELECT id, status, payload_json
         FROM ${table}
         WHERE id = $1 AND domain = $2
         LIMIT 1`,
        [id, domain]
    )
    const existing = existingResult.rows?.[0] || null
    if (!existing) return null

    const payload = parseJsonObject(existing.payload_json || null) || {}
    const nextPayload = buildRecyclingMetadata(payload, existing.status)

    const updateResult = await connection.query(
        `UPDATE ${table}
         SET status = $1,
             payload_json = $2,
             updated_at = NOW()
         WHERE id = $3 AND domain = $4
         RETURNING id, domain, patient_id, patient_name, status, event_type, requested_action, payload_json, error_message, created_at, updated_at`,
        [PENDING_DELETE_STATUS, JSON.stringify(nextPayload), id, domain]
    )

    return updateResult.rows?.[0] || null
}

function normalizeQueueRow(row, queueTable) {
    if (!row || typeof row !== 'object') return null

    const status = String(row.status || 'queued').trim().toLowerCase() || 'queued'
    const createdAt = normalizeTimestampUtc(row.created_at_utc || row.createdAtUtc || row.created_at)
    const updatedAt = normalizeTimestampUtc(row.updated_at_utc || row.updatedAtUtc || row.updated_at)
    const sourceTable = String(queueTable || row.sourceTable || '').trim() || 'patient_report_jobs'
    const rowId = row.id
    const payload = parseJsonObject(row.payload_json || null)
    const payloadPatientId = Number.parseInt(String(payload?.patientId || payload?.patient_id || ''), 10)
    const resolvedPatientId = Number.isFinite(payloadPatientId) && payloadPatientId > 0
        ? payloadPatientId
        : (row.patient_id ?? null)
    const resolvedPatientName = String(row.patient_name || payload?.patientName || payload?.patient_name || '').trim()
    const sourceNotes = String(payload?.metadata?.additionalContext || '').trim()
    const displayTimestamp = status === 'queued' || status === 'creating' || status === 'processing' || status === 'waiting'
        ? createdAt || updatedAt || null
        : updatedAt || createdAt || null

    return {
        id: rowId,
        domain: row.domain,
        patientId: resolvedPatientId,
        patientName: resolvedPatientName,
        preview: buildReportPreview('', sourceNotes) || 'Report job queued',
        reportMarkdown: '',
        sourceNotes,
        sourceMetadata: payload,
        generatedAt: null,
        createdAt,
        updatedAt,
        timestamp: displayTimestamp,
        sourceTable,
        status,
        statusLabel: mapQueueStatusLabel(status, row),
        listKey: `${sourceTable}:${rowId ?? ''}`,
    }
}

function isMissingTableError(error) {
    const message = String(error?.message || '').toLowerCase()
    return message.includes('does not exist')
        || (message.includes('relation') && message.includes('does not exist'))
}

async function verifyRequest(request) {
    const authHeader = request.headers.get('authorization') || ''
    if (!authHeader.startsWith('Bearer ')) {
        return null
    }

    const token = authHeader.replace('Bearer ', '').trim()
    if (!token) {
        return null
    }

    return verifyAdminToken(token)
}

async function fetchReports(connection, table, domain, windowDays, limit, search, patientId) {
    const searchTerm = String(search || '').trim()
    const searchPattern = `%${searchTerm.toLowerCase()}%`
    const cutoffDays = Number.isFinite(windowDays)
        ? Math.max(1, Math.min(365, windowDays))
        : null

    const conditions = [
        'domain = $1',
        `LOWER(COALESCE(status, 'ready')) <> '${PENDING_DELETE_STATUS}'`,
    ]
    const values = [domain]
    let paramIndex = 2

    if (cutoffDays !== null) {
        conditions.push(`COALESCE(updated_at, created_at) >= NOW() - INTERVAL '${cutoffDays} days'`)
    }

    if (Number.isFinite(patientId) && patientId > 0) {
        conditions.push(`patient_id = $${paramIndex}`)
        values.push(patientId)
        paramIndex += 1
    }

    if (searchTerm) {
        conditions.push(`(
            LOWER(COALESCE(patient_name, '')) LIKE $${paramIndex}
            OR LOWER(COALESCE(report_markdown, '')) LIKE $${paramIndex}
            OR LOWER(COALESCE(source_notes, '')) LIKE $${paramIndex}
        )`)
        values.push(searchPattern)
        paramIndex += 1
    }

    values.push(limit)
    const limitParam = paramIndex

    const result = await connection.query(
        `
            SELECT id, domain, patient_id, patient_name, report_markdown, source_notes, source_metadata_json, last_job_id, created_at, updated_at,
                   (created_at AT TIME ZONE current_setting('TIMEZONE')) AS created_at_utc,
                   (updated_at AT TIME ZONE current_setting('TIMEZONE')) AS updated_at_utc,
                   status
            FROM ${table}
            WHERE ${conditions.join(' AND ')}
            ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
            LIMIT $${limitParam}
        `,
        values
    )

    return result.rows || []
}

async function fetchQueuedReportJobs(connection, table, domain, windowDays, limit, search, patientId) {
    const searchTerm = String(search || '').trim()
    const searchPattern = `%${searchTerm.toLowerCase()}%`
    const cutoffDays = Number.isFinite(windowDays)
        ? Math.max(1, Math.min(365, windowDays))
        : null

    const conditions = [
        'domain = $1',
        `LOWER(COALESCE(status, 'queued')) <> 'completed'`,
        `LOWER(COALESCE(status, 'queued')) <> '${PENDING_DELETE_STATUS}'`,
    ]
    const values = [domain]
    let paramIndex = 2

    if (cutoffDays !== null) {
        conditions.push(`COALESCE(updated_at, created_at) >= NOW() - INTERVAL '${cutoffDays} days'`)
    }

    if (Number.isFinite(patientId) && patientId > 0) {
        conditions.push(`patient_id = $${paramIndex}`)
        values.push(patientId)
        paramIndex += 1
    }

    if (searchTerm) {
        conditions.push(`(
            LOWER(COALESCE(patient_name, '')) LIKE $${paramIndex}
            OR LOWER(COALESCE(payload_json, '')) LIKE $${paramIndex}
            OR LOWER(COALESCE(error_message, '')) LIKE $${paramIndex}
        )`)
        values.push(searchPattern)
        paramIndex += 1
    }

    values.push(limit)
    const limitParam = paramIndex

    const result = await connection.query(
        `
            SELECT id, domain, patient_id, patient_name, status, event_type, requested_action, payload_json, error_message, created_at, updated_at,
                   (created_at AT TIME ZONE current_setting('TIMEZONE')) AS created_at_utc,
                   (updated_at AT TIME ZONE current_setting('TIMEZONE')) AS updated_at_utc
            FROM ${table}
            WHERE ${conditions.join(' AND ')}
            ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
            LIMIT $${limitParam}
        `,
        values
    )

    return result.rows || []
}

export async function GET(request) {
    try {
        const adminUser = await verifyRequest(request)
        if (!adminUser) {
            return NextResponse.json({ success: false, error: 'Unauthorized: valid admin token required' }, { status: 401 })
        }

        const { searchParams } = new URL(request.url)
        const requestedDomain = normalizeDomainKey(searchParams.get('domain'))
        const domain = adminUser.role === 'superadmin' && requestedDomain
            ? requestedDomain
            : normalizeDomainKey(adminUser.domain || requestedDomain)

        if (!domain) {
            return NextResponse.json({ success: false, error: 'domain is required' }, { status: 400 })
        }

        const dbType = detectDatabaseType()
        if (dbType !== 'postgresql') {
            return NextResponse.json({ success: false, error: 'Relational database required for reports listing' }, { status: 400 })
        }

        const tables = resolveReportsTables()
        const limit = Math.min(MAX_LIMIT, parsePositiveInteger(searchParams.get('limit'), DEFAULT_LIMIT))
        const windowDays = parseWindowDays(searchParams.get('days'))
        const search = String(searchParams.get('search') || '').trim()
        const patientId = parsePositiveInteger(searchParams.get('patient_id'), 0)

        const connection = await getDomainBoundConnection(domain)
        try {
            let rows = []
            let sourceTable = ''
            const fetchedRowsByTable = []

            for (const table of tables) {
                try {
                    const fetched = await fetchReports(connection, table, domain, windowDays, limit, search, patientId)
                    fetchedRowsByTable.push({ table, rows: fetched })
                    if (fetched.length > 0 || table === tables[tables.length - 1]) {
                        rows = fetched
                        sourceTable = table
                    }
                } catch (error) {
                    if (!isMissingTableError(error)) {
                        throw error
                    }
                }
            }

            const reportRows = fetchedRowsByTable.find((entry) => entry.table === tables[0])?.rows || []
            const draftRows = fetchedRowsByTable.find((entry) => entry.table === tables[1])?.rows || []
            const mergedRows = mergeReportRows(reportRows, draftRows, limit)

            let queueRows = []
            try {
                const queueTable = resolveReportQueueTableName()
                const queued = await fetchQueuedReportJobs(connection, queueTable, domain, windowDays, limit, search, patientId)
                queueRows = queued
                    .map((row) => normalizeQueueRow(row, queueTable))
                    .filter(Boolean)
            } catch (error) {
                if (!isMissingTableError(error)) {
                    throw error
                }
            }

            const listRows = [...(mergedRows.length > 0 ? mergedRows : rows), ...queueRows]
                .sort((left, right) => {
                    const leftValue = Date.parse(String(left?.updated_at || left?.updatedAt || left?.created_at || left?.createdAt || left?.timestamp || ''))
                    const rightValue = Date.parse(String(right?.updated_at || right?.updatedAt || right?.created_at || right?.createdAt || right?.timestamp || ''))
                    const leftTs = Number.isFinite(leftValue) ? leftValue : 0
                    const rightTs = Number.isFinite(rightValue) ? rightValue : 0

                    if (rightTs !== leftTs) return rightTs - leftTs
                    return String(right?.listKey || right?.id || '').localeCompare(String(left?.listKey || left?.id || ''))
                })
                .slice(0, limit)

            const currentReportPatientIds = await fetchPatientIdsWithCurrentReport(
                connection,
                tables[0],
                domain,
                listRows.map((row) => row?.patient_id ?? row?.patientId)
            )

            return NextResponse.json({
                success: true,
                domain,
                limit,
                days: windowDays,
                search,
                patientId: patientId > 0 ? patientId : null,
                sourceTable: sourceTable || null,
                data: listRows.map((row) => {
                    const hasCurrentReport = currentReportPatientIds.has(String(row?.patient_id ?? row?.patientId ?? '').trim())
                    const normalizableRow = typeof row === 'object' && row !== null && 'sourceTable' in row
                        ? { ...row, source_metadata_json: row.source_metadata_json }
                        : row

                    return normalizeReportRow(
                        normalizableRow && typeof normalizableRow === 'object'
                            ? { ...normalizableRow, hasCurrentReport }
                            : normalizableRow
                    )
                }).filter(Boolean),
            })
        } finally {
            if (connection?.end) {
                await connection.end().catch(() => { })
            } else if (connection?.close) {
                await connection.close().catch(() => { })
            }
        }
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load reports' }, { status: 500 })
    }
}

export async function POST(request) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required for report queueing' }, { status: 400 })
    }

    let connection = null

    try {
        const adminUser = await verifyRequest(request)
        if (!adminUser) {
            return NextResponse.json({ success: false, error: 'Unauthorized: valid admin token required' }, { status: 401 })
        }

        const payload = await request.json().catch(() => ({}))
        const requestedDomain = normalizeDomainKey(payload?.domain || '')
        const adminDomain = normalizeDomainKey(adminUser?.domain || '')
        const domain = adminUser?.role === 'superadmin' && requestedDomain
            ? requestedDomain
            : normalizeDomainKey(adminDomain || requestedDomain)
        const patientName = normalizeString(payload?.patientName || payload?.patient_name || '')
        const reportType = normalizeString(payload?.reportType || payload?.report_type || '')
        const context = normalizeString(payload?.context || payload?.additionalContext || '')
        const patientId = Number.parseInt(String(payload?.patientId || payload?.patient_id || ''), 10)
        const options = normalizeReportOptions(payload?.options || payload?.reportOptions || {})
        const builderState = normalizeBuilderState(payload?.builderState)

        if (!domain) {
            return NextResponse.json({ success: false, error: 'domain is required' }, { status: 400 })
        }
        if (adminUser?.role !== 'superadmin' && requestedDomain && adminDomain && requestedDomain !== adminDomain) {
            return NextResponse.json({ success: false, error: 'Forbidden: cannot queue report for requested domain' }, { status: 403 })
        }
        if (!patientName) {
            return NextResponse.json({ success: false, error: 'patientName is required' }, { status: 400 })
        }

        connection = await getDomainBoundConnection(domain)

        const reportSettings = await readReportSettingsForDomain(domain)
        const requestedReportTypeId = normalizeString(reportType, '')
        const reportTypeConfig = deriveReportTypeConfig(domain, reportSettings, requestedReportTypeId)
        const aiUsage = await buildReportAiUsagePayload(domain, reportTypeConfig.reportTypeOptions)

        const selectedReportTypeId = reportTypeConfig.reportTypeId || requestedReportTypeId || ''
        const effectiveReportType = reportTypeConfig.reportTypeName || requestedReportTypeId || 'default'
        // The documents the analyst is reading for this patient. The FCA report leads with the
        // analyst's findings, so the worker needs the scope to tell whether those findings match
        // this record. Only FCA reports use it, so nothing else pays for the query.
        const analystScopeDocumentIds = Number.isFinite(patientId) && patientId > 0
            && (isNdisFcaReportType(selectedReportTypeId) || isNdisFcaReportType(effectiveReportType))
            ? await loadAnalysisEvidenceDocumentIds({ domain, patientId })
            : []
        const practiceName = await readDomainPracticeName(domain)
        const queuePayload = {
            domain,
            patientId: Number.isFinite(patientId) && patientId > 0 ? patientId : null,
            patientName,
            metadata: {
                source: 'one:admin-reports-new',
                reportType: effectiveReportType,
                reportOptions: options,
                additionalContext: context,
                analystScopeDocumentIds,
                practiceName,
                reportTypeId: selectedReportTypeId || effectiveReportType,
                reportTypeConfig: reportTypeConfig.reportTypeOptions || {},
                reportTemplateId: reportTypeConfig.reportTemplateId || null,
                reportTemplate: reportTypeConfig.reportTemplate || null,
                builderState,
                adminRequested: true,
            },
            aiUsage,
            source: 'one:admin-reports-new',
        }

        let result = null
        try {
            result = await enqueueReportTask({
                domain,
                patientId: Number.isFinite(patientId) && patientId > 0 ? patientId : 0,
                patientName,
                eventType: 'reporting_enabled',
                requestedAction: 'create_or_edit',
                payload: queuePayload,
            })
        } catch (error) {
            result = {
                success: false,
                error: error?.message || 'Failed to enqueue report job',
            }
        }

        if (!result?.success && result?.queued !== true) {
            result = await enqueueReportJobLocalFallback({
                connection,
                domain,
                patientId: Number.isFinite(patientId) && patientId > 0 ? patientId : null,
                patientName,
                payload: queuePayload,
                eventType: 'reporting_enabled',
                requestedAction: 'create_or_edit',
            })
        }

        let mirroredQueueRowId = null
        if (result?.success || result?.queued === true) {
            const upstreamSource = String(result?.source || '').trim().toLowerCase()
            const alreadyLocalFallback = upstreamSource === 'local-db-fallback'

            if (!alreadyLocalFallback) {
                try {
                    const mirrorResult = await enqueueReportJobLocalFallback({
                        connection,
                        domain,
                        patientId: Number.isFinite(patientId) && patientId > 0 ? patientId : null,
                        patientName,
                        payload: queuePayload,
                        eventType: 'reporting_enabled',
                        requestedAction: 'create_or_edit',
                    })
                    mirroredQueueRowId = mirrorResult?.id || null
                } catch {
                    mirroredQueueRowId = null
                }
            }
        }

        if (!result?.success && result?.queued !== true) {
            throw new Error(result?.error || 'Failed to queue report')
        }

        return NextResponse.json({
            success: true,
            queued: true,
            reportType: effectiveReportType,
            patientName,
            domain,
            queue: result,
            queueMirror: mirroredQueueRowId ? { id: mirroredQueueRowId, source: 'local-db-fallback' } : null,
        })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to queue report' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        } else if (connection?.close) {
            await connection.close().catch(() => { })
        }
    }
}

async function enqueueHsrBackfillAfterCurrentReportDelete({ connection, domain, record }) {
    const patientId = Number.parseInt(String(record?.patient_id || ''), 10)
    const patient = await readPatientForReportBackfill(connection, domain, patientId)
    const patientMetadata = parseJsonObject(patient?.metadata) || {}
    if (!patient || !isHsrCreatorEnabled(patientMetadata)) {
        return { queued: false, reason: 'hsr_creator_disabled' }
    }

    const deletedReportMetadata = parseJsonObject(record?.source_metadata_json) || {}
    const reportSettings = await readReportSettingsForDomain(domain)
    const reportTypeConfig = deriveHsrReportTypeConfig(domain, reportSettings, deletedReportMetadata)
    const effectiveReportType = reportTypeConfig.reportTypeName
    const selectedReportTypeId = reportTypeConfig.reportTypeId
    const patientName = normalizeString(patient.patient_name || record?.patient_name || '')
    const aiUsage = await buildReportAiUsagePayload(domain, reportTypeConfig.reportTypeOptions)
    const practiceName = await readDomainPracticeName(domain)
    const queuePayload = {
        domain,
        patientId,
        patientName,
        metadata: {
            ...patientMetadata,
            reportType: effectiveReportType,
            reportTypeId: selectedReportTypeId,
            reportTypeConfig: reportTypeConfig.reportTypeOptions || {},
            reportTemplateId: reportTypeConfig.reportTemplateId || deletedReportMetadata.reportTemplateId || null,
            reportTemplate: reportTypeConfig.reportTemplate || null,
            practiceName,
            source: 'one:hsr-current-report-deleted',
        },
        aiUsage,
        source: 'one:hsr-current-report-deleted',
    }

    let result = null
    try {
        result = await enqueueReportTask({
            domain,
            patientId,
            patientName,
            eventType: 'hsr_creator_backfill',
            requestedAction: 'create_or_edit',
            payload: queuePayload,
        })
    } catch (error) {
        result = { success: false, error: error?.message || 'Failed to enqueue HSR backfill' }
    }

    if (!result?.success && result?.queued !== true) {
        result = await enqueueReportJobLocalFallback({
            connection,
            domain,
            patientId,
            patientName,
            payload: queuePayload,
            eventType: 'hsr_creator_backfill',
            requestedAction: 'create_or_edit',
        })
    }

    const upstreamSource = String(result?.source || '').trim().toLowerCase()
    if ((result?.success || result?.queued === true) && upstreamSource !== 'local-db-fallback') {
        await enqueueReportJobLocalFallback({
            connection,
            domain,
            patientId,
            patientName,
            payload: queuePayload,
            eventType: 'hsr_creator_backfill',
            requestedAction: 'create_or_edit',
        })
    }

    if (!result?.success && result?.queued !== true) {
        throw new Error(result?.error || 'Failed to enqueue HSR backfill')
    }

    return { queued: true, queue: result }
}

export async function DELETE(request) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required for report delete' }, { status: 400 })
    }

    let connection = null

    try {
        const adminUser = await verifyRequest(request)
        if (!adminUser) {
            return NextResponse.json({ success: false, error: 'Unauthorized: valid admin token required' }, { status: 401 })
        }

        const payload = await request.json().catch(() => ({}))
        const requestedDomain = normalizeDomainKey(payload?.domain || '')
        const adminDomain = normalizeDomainKey(adminUser?.domain || '')
        const domain = adminUser?.role === 'superadmin' && requestedDomain
            ? requestedDomain
            : normalizeDomainKey(adminDomain || requestedDomain)
        const sourceTable = normalizeReportSourceTable(payload?.sourceTable || payload?.source_table || '')
        const reportId = parsePositiveInteger(payload?.id || payload?.reportId || payload?.sourceId, 0)

        if (!domain) {
            return NextResponse.json({ success: false, error: 'domain is required' }, { status: 400 })
        }
        if (adminUser?.role !== 'superadmin' && requestedDomain && adminDomain && requestedDomain !== adminDomain) {
            return NextResponse.json({ success: false, error: 'Forbidden: cannot delete report for requested domain' }, { status: 403 })
        }
        if (!sourceTable) {
            return NextResponse.json({ success: false, error: 'sourceTable is invalid' }, { status: 400 })
        }
        if (!Number.isFinite(reportId) || reportId <= 0) {
            return NextResponse.json({ success: false, error: 'Valid report id is required' }, { status: 400 })
        }

        connection = await getDomainBoundConnection(domain)
        const queueTable = resolveReportQueueTableName()
        const isQueueRow = String(sourceTable).trim().toLowerCase() === String(queueTable).trim().toLowerCase()
        const record = isQueueRow
            ? await markQueueReportPendingDelete(connection, sourceTable, domain, reportId)
            : await markReportPendingDelete(connection, sourceTable, domain, reportId)

        if (!record) {
            return NextResponse.json({ success: false, error: 'Report not found' }, { status: 404 })
        }

        const [currentReportsTable] = resolveReportsTables()
        const deletedCurrentReport = !isQueueRow
            && String(sourceTable).trim().toLowerCase() === String(currentReportsTable).trim().toLowerCase()
        let backfill = { queued: false, reason: 'not_current_report' }
        if (deletedCurrentReport) {
            try {
                backfill = await enqueueHsrBackfillAfterCurrentReportDelete({
                    connection,
                    domain,
                    record,
                })
            } catch (error) {
                backfill = { queued: false, error: error?.message || 'Failed to enqueue HSR backfill' }
            }
        }

        return NextResponse.json({
            success: true,
            record: normalizeReportRow(
                isQueueRow
                    ? normalizeQueueRow(record, sourceTable)
                    : { ...record, sourceTable }
            ),
            backfill,
        })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to mark report as pending delete' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        } else if (connection?.close) {
            await connection.close().catch(() => { })
        }
    }
}
