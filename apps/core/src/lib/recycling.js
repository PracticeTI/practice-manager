const PENDING_DELETE_STATUS = 'pending delete'
const CONTENT_RESTORE_DEFAULT_STATUS = 'published'
const DEFAULT_REPORTS_TABLE = 'patient_reports'
const DEFAULT_REPORT_DRAFTS_TABLE = 'patient_report_drafts'
const DEFAULT_REPORT_QUEUE_TABLE = 'patient_report_jobs'

function parseInteger(rawValue) {
    const parsed = Number.parseInt(String(rawValue || ''), 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function normalizeText(value, fallback = '') {
    return String(value || '').trim() || fallback
}

function normalizeCleanupScope(value) {
    const normalized = normalizeText(value).toLowerCase()
    if (normalized === 'month' || normalized === '3months' || normalized === 'all') {
        return normalized
    }
    return ''
}

function getCleanupCutoffDate(scope, now = new Date()) {
    if (scope === 'all') return null

    const cutoff = new Date(now.getTime())
    if (scope === 'month') {
        cutoff.setMonth(cutoff.getMonth() - 1)
        return cutoff
    }
    if (scope === '3months') {
        cutoff.setMonth(cutoff.getMonth() - 3)
        return cutoff
    }
    return null
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

function isSafeSqlIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || '').trim())
}

function resolveReportTables() {
    const reportsTable = String(process.env.PATIENT_REPORTS_TABLE || DEFAULT_REPORTS_TABLE).trim()
    const draftsTable = String(process.env.PATIENT_REPORT_DRAFTS_TABLE || DEFAULT_REPORT_DRAFTS_TABLE).trim()

    return [reportsTable, draftsTable].filter((table, index, list) => {
        if (!isSafeSqlIdentifier(table)) return false
        return list.indexOf(table) === index
    })
}

function resolveReportQueueTable() {
    const queueTable = String(process.env.REPORT_QUEUE_TABLE || DEFAULT_REPORT_QUEUE_TABLE).trim()
    if (!isSafeSqlIdentifier(queueTable)) return ''
    return queueTable
}

function resolveAllReportTables() {
    const queueTable = resolveReportQueueTable()
    const tables = resolveReportTables()
    if (queueTable && !tables.includes(queueTable)) {
        tables.push(queueTable)
    }
    return tables
}

function isQueueTable(table) {
    const queueTable = resolveReportQueueTable()
    if (!queueTable) return false
    return String(table || '').trim().toLowerCase() === String(queueTable).trim().toLowerCase()
}

function isMissingTableError(error) {
    const message = String(error?.message || '').toLowerCase()
    return message.includes('does not exist')
        || (message.includes('relation') && message.includes('does not exist'))
}

function buildTranscriptItem(row) {
    const transcriptId = parseInteger(row?.id)
    const patientId = parseInteger(row?.patient_id)
    const title = normalizeText(row?.title, `Transcript ${transcriptId || ''}`.trim() || 'Transcript')
    const transcriptText = normalizeText(row?.transcript_text)
    const metadata = parseMetadataValue(row?.metadata) || {}
    const recyclingItemId = `transcript:${transcriptId || row?.id || 'unknown'}`
    const patientHref = patientId
        ? `/admin/patients?patientId=${encodeURIComponent(String(patientId))}&tab=transcripts&transcriptionId=${encodeURIComponent(String(transcriptId || ''))}&includeDeletedTranscript=1`
        : '/admin/patients'

    return {
        itemType: 'transcript',
        itemLabel: 'Transcript',
        id: recyclingItemId,
        sourceTable: 'patient_transcriptions',
        sourceId: transcriptId,
        domain: normalizeText(row?.domain),
        patientId,
        title,
        subtitle: patientId ? `Patient #${patientId}` : 'Patient transcript',
        status: normalizeText(row?.status, PENDING_DELETE_STATUS),
        restoreStatus: normalizeText(metadata?.recycling?.previousStatus, 'completed'),
        previewText: transcriptText,
        href: `/admin/recycling?item=${encodeURIComponent(recyclingItemId)}`,
        patientHref,
        createdAt: row?.created_at || null,
        updatedAt: row?.updated_at || null,
    }
}

function buildPreviewText(value, maxLength = 220) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    if (!text) return ''
    return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text
}

function buildReportItem(row, sourceTable) {
    const reportId = parseInteger(row?.id)
    const patientId = parseInteger(row?.patient_id)
    const patientName = normalizeText(row?.patient_name)
    const sourceMetadata = parseMetadataValue(row?.source_metadata_json)
        || parseMetadataValue(row?.payload_json)
        || {}
    const metadata = sourceMetadata?.metadata && typeof sourceMetadata.metadata === 'object'
        ? sourceMetadata.metadata
        : {}
    const recycling = sourceMetadata?.recycling && typeof sourceMetadata.recycling === 'object'
        ? sourceMetadata.recycling
        : {}

    const title = patientName
        ? `Report for ${patientName}`
        : normalizeText(row?.title, `Report ${reportId || ''}`.trim() || 'Report')

    const previewText = buildPreviewText(row?.source_notes)
        || buildPreviewText(row?.report_markdown)
        || buildPreviewText(metadata?.additionalContext)

    const recyclingItemId = `report:${sourceTable}:${reportId || row?.id || 'unknown'}`

    return {
        itemType: 'report',
        itemLabel: 'Report',
        id: recyclingItemId,
        sourceTable,
        sourceId: reportId,
        domain: normalizeText(row?.domain),
        patientId,
        title,
        subtitle: patientId ? `Patient #${patientId}` : 'Patient report',
        status: normalizeText(row?.status, PENDING_DELETE_STATUS),
        restoreStatus: normalizeText(recycling?.previousStatus, isQueueTable(sourceTable) ? 'queued' : 'ready'),
        previewText,
        href: `/admin/recycling?item=${encodeURIComponent(recyclingItemId)}`,
        patientHref: '/admin/reports',
        createdAt: row?.created_at || null,
        updatedAt: row?.updated_at || null,
    }
}

function extractContentTitle(row, metadata) {
    const rowTitle = normalizeText(row?.title)
    if (rowTitle) return rowTitle

    const rowName = normalizeText(row?.name)
    if (rowName) return rowName

    const presentationTitle = normalizeText(metadata?.presentation?.default?.title)
    if (presentationTitle) return presentationTitle

    const category = normalizeText(row?.category || metadata?.category)
    if (category) {
        const categoryLabel = category.replace(/[_-]+/g, ' ')
        return categoryLabel.charAt(0).toUpperCase() + categoryLabel.slice(1)
    }

    return 'Content item'
}

function extractContentPreviewText(row, metadata) {
    return buildPreviewText(metadata?.presentation?.default?.summary)
        || buildPreviewText(metadata?.summary)
        || buildPreviewText(row?.summary)
}

function buildContentItem(row) {
    const contentId = parseInteger(row?.id)
    const metadata = parseMetadataValue(row?.metadata) || {}
    const type = normalizeText(row?.type, 'content')
    const subtype = normalizeText(row?.subtype)
    const category = normalizeText(row?.category || metadata?.category)
    const domain = normalizeText(row?.domain || metadata?.domain)
    const title = extractContentTitle(row, metadata)
    const previewText = extractContentPreviewText(row, metadata)
    const recycling = metadata?.recycling && typeof metadata.recycling === 'object'
        ? metadata.recycling
        : {}
    const restoreStatus = normalizeText(recycling?.previousStatus, CONTENT_RESTORE_DEFAULT_STATUS)
    const itemLabel = type === 'post' || type === 'article' ? 'Post' : 'Content'
    const recyclingItemId = `content:${contentId || row?.id || 'unknown'}`
    const subtypeLabel = subtype ? `${subtype} ${itemLabel.toLowerCase()}` : itemLabel.toLowerCase()

    return {
        itemType: 'content',
        itemLabel,
        id: recyclingItemId,
        sourceTable: 'content',
        sourceId: contentId,
        domain,
        title,
        subtitle: category
            ? `${subtypeLabel} • ${category.replace(/[_-]+/g, ' ')}`
            : subtypeLabel,
        status: normalizeText(row?.status, PENDING_DELETE_STATUS),
        restoreStatus,
        previewText,
        href: `/admin/recycling?item=${encodeURIComponent(recyclingItemId)}`,
        patientHref: null,
        createdAt: row?.created_at || null,
        updatedAt: row?.updated_at || null,
    }
}

async function fetchPendingDeleteTranscriptItems(connection, dbType, domain, limit) {
    const scopedDomain = normalizeText(domain).toLowerCase()
    if (!scopedDomain) return []

    const result = await connection.query(
        `SELECT id, domain, patient_id, status, title, transcript_text, metadata, created_at, updated_at
             FROM patient_transcriptions
             WHERE domain = $1
               AND status = $2
             ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
             LIMIT $3`,
        [scopedDomain, PENDING_DELETE_STATUS, limit]
    )
    return (result.rows || []).map(buildTranscriptItem)
}

async function fetchPendingDeleteReportItems(connection, dbType, domain, limit) {
    const scopedDomain = normalizeText(domain).toLowerCase()
    if (!scopedDomain) return []

    const tables = resolveAllReportTables()
    if (tables.length === 0) return []

    const items = []
    for (const table of tables) {
        try {
            const queueShape = isQueueTable(table)

            const sql = queueShape
                ? `SELECT id, domain, patient_id, patient_name, status, payload_json, created_at, updated_at
                       FROM ${table}
                       WHERE domain = $1
                         AND status = $2
                       ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
                       LIMIT $3`
                : `SELECT id, domain, patient_id, patient_name, status, report_markdown, source_notes, source_metadata_json, created_at, updated_at
                       FROM ${table}
                       WHERE domain = $1
                         AND status = $2
                       ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
                       LIMIT $3`

            const result = await connection.query(sql, [scopedDomain, PENDING_DELETE_STATUS, limit])
            items.push(...(result.rows || []).map((row) => buildReportItem(row, table)))
        } catch (error) {
            if (!isMissingTableError(error)) {
                throw error
            }
        }
    }

    return items
}

async function fetchPendingDeleteContentItems(connection, dbType, domain, limit) {
    const scopedDomain = normalizeText(domain).toLowerCase()
    if (!scopedDomain) return []

    const result = await connection.query(
        `SELECT id,
                                        COALESCE(NULLIF(TRIM(domain), ''), attributes->>'domain', metadata->>'domain', '') AS domain,
                                        type, subtype, name, title, status, metadata, created_at, updated_at,
                    COALESCE(attributes->>'category', metadata->>'category', '') AS category
             FROM content
                         WHERE LOWER(COALESCE(NULLIF(TRIM(domain), ''), attributes->>'domain', metadata->>'domain', '')) = $1
               AND status = $2
             ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
             LIMIT $3`,
        [scopedDomain, PENDING_DELETE_STATUS, limit]
    )
    return (result.rows || []).map(buildContentItem)
}

function normalizeReportSourceTable(value) {
    const normalized = normalizeText(value).toLowerCase()
    if (!normalized) return ''

    for (const table of resolveAllReportTables()) {
        if (String(table || '').trim().toLowerCase() === normalized) {
            return table
        }
    }

    return ''
}

async function restoreReportItem({ connection, dbType, domain, sourceId, sourceTable }) {
    const scopedDomain = normalizeText(domain).toLowerCase()
    const parsedSourceId = parseInteger(sourceId)
    const normalizedTable = normalizeReportSourceTable(sourceTable)

    if (!scopedDomain || !parsedSourceId || !normalizedTable) {
        return null
    }

    const queueShape = isQueueTable(normalizedTable)
    const selectSql = queueShape
        ? `SELECT id, domain, patient_id, patient_name, status, payload_json, created_at, updated_at
               FROM ${normalizedTable}
               WHERE id = $1 AND domain = $2 AND status = $3
               LIMIT 1`
        : `SELECT id, domain, patient_id, patient_name, status, report_markdown, source_notes, source_metadata_json, created_at, updated_at
               FROM ${normalizedTable}
               WHERE id = $1 AND domain = $2 AND status = $3
               LIMIT 1`

    const result = await connection.query(selectSql, [parsedSourceId, scopedDomain, PENDING_DELETE_STATUS])
    const existing = result.rows?.[0] || null
    if (!existing) return null

    const sourceMetadata = parseMetadataValue(existing.source_metadata_json)
        || parseMetadataValue(existing.payload_json)
        || {}
    const recycling = sourceMetadata?.recycling && typeof sourceMetadata.recycling === 'object'
        ? sourceMetadata.recycling
        : {}
    const restoreStatus = normalizeText(recycling?.previousStatus, queueShape ? 'queued' : 'ready')
    const nextSourceMetadata = {
        ...sourceMetadata,
        recycling: {
            ...recycling,
            restoredAt: new Date().toISOString(),
        },
    }

    const updateSql = queueShape
        ? `UPDATE ${normalizedTable}
               SET status = $1, payload_json = $2, updated_at = NOW()
               WHERE id = $3 AND domain = $4
               RETURNING id, domain, patient_id, patient_name, status, payload_json, created_at, updated_at`
        : `UPDATE ${normalizedTable}
               SET status = $1, source_metadata_json = $2::jsonb, updated_at = NOW()
               WHERE id = $3 AND domain = $4
               RETURNING id, domain, patient_id, patient_name, status, report_markdown, source_notes, source_metadata_json, created_at, updated_at`

    const updateResult = await connection.query(updateSql, [restoreStatus, JSON.stringify(nextSourceMetadata), parsedSourceId, scopedDomain])
    return buildReportItem(updateResult.rows?.[0] || existing, normalizedTable)
}

async function restoreContentItem({ connection, dbType, domain, sourceId }) {
    const scopedDomain = normalizeText(domain).toLowerCase()
    const parsedSourceId = parseInteger(sourceId)
    if (!scopedDomain || !parsedSourceId) {
        return null
    }

    const result = await connection.query(
        `SELECT id,
                                        COALESCE(NULLIF(TRIM(domain), ''), attributes->>'domain', metadata->>'domain', '') AS domain,
                                        type, subtype, name, title, status, metadata, created_at, updated_at,
                    COALESCE(attributes->>'category', metadata->>'category', '') AS category
             FROM content
             WHERE id = $1
                             AND LOWER(COALESCE(NULLIF(TRIM(domain), ''), attributes->>'domain', metadata->>'domain', '')) = $2
               AND status = $3
             LIMIT 1`,
        [parsedSourceId, scopedDomain, PENDING_DELETE_STATUS]
    )
    const existing = result.rows?.[0] || null
    if (!existing) return null

    const metadata = parseMetadataValue(existing.metadata) || {}
    const restoreStatus = normalizeText(metadata?.recycling?.previousStatus, CONTENT_RESTORE_DEFAULT_STATUS)
    const nextMetadata = {
        ...metadata,
        recycling: {
            ...(metadata.recycling || {}),
            restoredAt: new Date().toISOString(),
        },
    }

    const updateResult = await connection.query(
        `UPDATE content
             SET status = $1, metadata = $2::jsonb, updated_at = NOW()
             WHERE id = $3
                             AND LOWER(COALESCE(NULLIF(TRIM(domain), ''), attributes->>'domain', metadata->>'domain', '')) = $4
                         RETURNING id,
                                             COALESCE(NULLIF(TRIM(domain), ''), attributes->>'domain', metadata->>'domain', '') AS domain,
                                             type, subtype, name, title, status, metadata, created_at, updated_at,
                       COALESCE(attributes->>'category', metadata->>'category', '') AS category`,
        [restoreStatus, JSON.stringify(nextMetadata), parsedSourceId, scopedDomain]
    )
    return buildContentItem(updateResult.rows?.[0] || existing)
}

async function cleanupTranscriptItems({ connection, dbType, domain, cutoffDate }) {
    const scopedDomain = normalizeText(domain).toLowerCase()
    if (!scopedDomain) return 0

    const sql = cutoffDate
        ? `DELETE FROM patient_transcriptions
               WHERE domain = $1
                 AND status = $2
                 AND COALESCE(updated_at, created_at) < $3`
        : `DELETE FROM patient_transcriptions
               WHERE domain = $1
                 AND status = $2`
    const params = cutoffDate ? [scopedDomain, PENDING_DELETE_STATUS, cutoffDate] : [scopedDomain, PENDING_DELETE_STATUS]
    const result = await connection.query(sql, params)
    return Number(result?.rowCount || 0)
}

async function cleanupReportItems({ connection, dbType, domain, cutoffDate }) {
    const scopedDomain = normalizeText(domain).toLowerCase()
    if (!scopedDomain) return 0

    let deletedCount = 0
    for (const table of resolveAllReportTables()) {
        try {
            const sql = cutoffDate
                ? `DELETE FROM ${table}
                       WHERE domain = $1
                         AND status = $2
                         AND COALESCE(updated_at, created_at) < $3`
                : `DELETE FROM ${table}
                       WHERE domain = $1
                         AND status = $2`
            const params = cutoffDate ? [scopedDomain, PENDING_DELETE_STATUS, cutoffDate] : [scopedDomain, PENDING_DELETE_STATUS]
            const result = await connection.query(sql, params)
            deletedCount += Number(result?.rowCount || 0)
        } catch (error) {
            if (!isMissingTableError(error)) {
                throw error
            }
        }
    }

    return deletedCount
}

async function cleanupContentItems({ connection, dbType, domain, cutoffDate }) {
    const scopedDomain = normalizeText(domain).toLowerCase()
    if (!scopedDomain) return 0

    const sql = cutoffDate
        ? `DELETE FROM content
                             WHERE LOWER(COALESCE(NULLIF(TRIM(domain), ''), attributes->>'domain', metadata->>'domain', '')) = $1
                                 AND status = $2
                                 AND COALESCE(updated_at, created_at) < $3`
        : `DELETE FROM content
                             WHERE LOWER(COALESCE(NULLIF(TRIM(domain), ''), attributes->>'domain', metadata->>'domain', '')) = $1
                                 AND status = $2`
    const params = cutoffDate ? [scopedDomain, PENDING_DELETE_STATUS, cutoffDate] : [scopedDomain, PENDING_DELETE_STATUS]
    const result = await connection.query(sql, params)
    return Number(result?.rowCount || 0)
}

const RECYCLING_SOURCE_DEFINITIONS = [
    {
        key: 'content',
        label: 'Content',
        fetchItems: fetchPendingDeleteContentItems,
    },
    {
        key: 'transcripts',
        label: 'Transcript',
        fetchItems: fetchPendingDeleteTranscriptItems,
    },
    {
        key: 'reports',
        label: 'Report',
        fetchItems: fetchPendingDeleteReportItems,
    },
]

export async function fetchRecyclingItems({ connection, dbType, domain, limit = 100, sourceKey = 'all' }) {
    const parsedLimit = Number.parseInt(String(limit || ''), 10)
    const scopedLimit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(parsedLimit, 500)) : 100
    const definitions = sourceKey && sourceKey !== 'all'
        ? RECYCLING_SOURCE_DEFINITIONS.filter((item) => item.key === sourceKey)
        : RECYCLING_SOURCE_DEFINITIONS

    const itemsBySource = await Promise.all(definitions.map(async (definition) => {
        const items = await definition.fetchItems(connection, dbType, domain, scopedLimit)
        return items.map((item) => ({
            ...item,
            itemSourceKey: definition.key,
            itemSourceLabel: definition.label,
        }))
    }))

    return itemsBySource
        .flat()
        .sort((left, right) => {
            const leftTime = Date.parse(left?.updatedAt || left?.createdAt || 0)
            const rightTime = Date.parse(right?.updatedAt || right?.createdAt || 0)
            return rightTime - leftTime
        })
}

export async function restoreRecyclingItem({ connection, dbType, domain, itemType, sourceId, sourceTable }) {
    const scopedDomain = normalizeText(domain).toLowerCase()
    const normalizedItemType = normalizeText(itemType).toLowerCase()
    const parsedSourceId = parseInteger(sourceId)
    if (!scopedDomain || !normalizedItemType || !parsedSourceId) {
        return null
    }

    if (normalizedItemType === 'report') {
        return restoreReportItem({
            connection,
            dbType,
            domain: scopedDomain,
            sourceId: parsedSourceId,
            sourceTable,
        })
    }

    if (normalizedItemType === 'content' || normalizedItemType === 'post') {
        return restoreContentItem({
            connection,
            dbType,
            domain: scopedDomain,
            sourceId: parsedSourceId,
        })
    }

    if (normalizedItemType !== 'transcript') {
        return null
    }

    const result = await connection.query(
        `SELECT id, domain, patient_id, status, title, transcript_text, metadata, created_at, updated_at
             FROM patient_transcriptions
             WHERE id = $1 AND domain = $2 AND status = $3
             LIMIT 1`,
        [parsedSourceId, scopedDomain, PENDING_DELETE_STATUS]
    )
    const existing = result.rows?.[0] || null
    if (!existing) return null

    const metadata = parseMetadataValue(existing.metadata) || {}
    const restoreStatus = normalizeText(metadata?.recycling?.previousStatus, 'completed')
    const nextMetadata = {
        ...metadata,
        recycling: {
            ...(metadata.recycling || {}),
            restoredAt: new Date().toISOString(),
        },
    }

    const updateResult = await connection.query(
        `UPDATE patient_transcriptions
             SET status = $1, metadata = $2::jsonb, updated_at = NOW()
             WHERE id = $3 AND domain = $4
             RETURNING id, domain, patient_id, status, title, transcript_text, metadata, created_at, updated_at`,
        [restoreStatus, JSON.stringify(nextMetadata), parsedSourceId, scopedDomain]
    )
    return buildTranscriptItem(updateResult.rows?.[0] || existing)
}

export async function cleanupRecyclingItems({ connection, dbType, domain, scope }) {
    const scopedDomain = normalizeText(domain).toLowerCase()
    const normalizedScope = normalizeCleanupScope(scope)
    if (!scopedDomain || !normalizedScope) {
        return null
    }

    const cutoffDate = getCleanupCutoffDate(normalizedScope)
    const contentCount = await cleanupContentItems({ connection, dbType, domain: scopedDomain, cutoffDate })
    const transcriptCount = await cleanupTranscriptItems({ connection, dbType, domain: scopedDomain, cutoffDate })
    const reportCount = await cleanupReportItems({ connection, dbType, domain: scopedDomain, cutoffDate })

    return {
        scope: normalizedScope,
        deletedCount: contentCount + transcriptCount + reportCount,
        counts: {
            content: contentCount,
            transcripts: transcriptCount,
            reports: reportCount,
        },
    }
}

export { PENDING_DELETE_STATUS, RECYCLING_SOURCE_DEFINITIONS }
