function getSortTimestamp(row) {
    const rawValue = row?.updated_at || row?.updatedAt || row?.created_at || row?.createdAt || null
    if (rawValue === null || rawValue === '') {
        return Number.MIN_SAFE_INTEGER
    }

    const parsed = Date.parse(rawValue)
    if (Number.isFinite(parsed)) {
        return parsed
    }

    const numericValue = Number.parseInt(String(rawValue), 10)
    return Number.isFinite(numericValue) ? numericValue : Number.MIN_SAFE_INTEGER
}

function normalizeReportRowForList(row, sourceTable) {
    if (!row || typeof row !== 'object') return null

    const resolvedSourceTable = String(sourceTable || '').trim() || 'unknown'
    const rowId = row?.id ?? ''

    return {
        ...row,
        sourceTable: resolvedSourceTable,
        listKey: `${resolvedSourceTable}:${rowId}`,
        _sortTimestamp: getSortTimestamp(row),
    }
}

export function mergeReportRows(reportRows = [], draftRows = [], limit = 50) {
    const combined = []

    for (const row of reportRows) {
        const normalized = normalizeReportRowForList(row, 'patient_reports')
        if (normalized) combined.push(normalized)
    }

    for (const row of draftRows) {
        const normalized = normalizeReportRowForList(row, 'patient_report_drafts')
        if (normalized) combined.push(normalized)
    }

    combined.sort((left, right) => {
        const leftTimestamp = Number(left?._sortTimestamp ?? Number.MIN_SAFE_INTEGER)
        const rightTimestamp = Number(right?._sortTimestamp ?? Number.MIN_SAFE_INTEGER)

        if (rightTimestamp === leftTimestamp) {
            return String(right?.id || '').localeCompare(String(left?.id || ''))
        }

        return rightTimestamp - leftTimestamp
    })

    return combined.slice(0, Math.max(1, Number(limit) || 50))
}

export function getLatestReportPerPatient(rows = []) {
    const selected = []
    const seenPatientIds = new Set()

    for (const row of Array.isArray(rows) ? rows : []) {
        const patientId = String(row?.patientId || row?.patient_id || '').trim()
        if (patientId && seenPatientIds.has(patientId)) continue

        selected.push(row)
        if (patientId) seenPatientIds.add(patientId)
    }

    return selected
}

export function getMostRecentReportPerPatient(rows = [], limit = 2) {
    return getLatestReportPerPatient(rows).slice(0, Math.max(1, Number(limit) || 2))
}

function getReportVersionRowKey(row) {
    const sourceTable = String(row?.sourceTable || '').trim().toLowerCase()
    const id = String(row?.id ?? '').trim()
    if (sourceTable && id) return `${sourceTable}:${id}`
    return String(row?.listKey || '').trim()
}

function isCompleteReportRow(row) {
    const sourceTable = String(row?.sourceTable || '').trim().toLowerCase()
    // A draft without a job id is the builder's working copy, not a published version.
    if (sourceTable.includes('draft') && !row?.lastJobId) return false
    return Boolean(String(row?.reportMarkdown || '').trim())
}

export function getReportVersions(rows = []) {
    const versions = []
    const indexesByJobId = new Map()
    const indexesByRowKey = new Map()

    for (const row of Array.isArray(rows) ? rows : []) {
        if (!row || typeof row !== 'object' || !isCompleteReportRow(row)) continue

        const jobId = String(row?.lastJobId || '').trim()
        const rowKey = getReportVersionRowKey(row)
        const isCanonical = !String(row?.sourceTable || '').trim().toLowerCase().includes('draft')

        if (jobId && indexesByJobId.has(jobId)) {
            const existingIndex = indexesByJobId.get(jobId)
            // The patient_reports row and its generated draft can describe the same job.
            if (isCanonical && String(versions[existingIndex]?.sourceTable || '').trim().toLowerCase().includes('draft')) {
                versions[existingIndex] = row
            }
            continue
        }

        if (!jobId && rowKey && indexesByRowKey.has(rowKey)) continue

        if (jobId) indexesByJobId.set(jobId, versions.length)
        if (rowKey) indexesByRowKey.set(rowKey, versions.length)
        versions.push(row)
    }

    versions.sort((left, right) => getSortTimestamp(right) - getSortTimestamp(left))

    const canonicalIndex = versions.findIndex((row) => (
        !String(row?.sourceTable || '').trim().toLowerCase().includes('draft')
    ))
    const currentIndex = canonicalIndex >= 0 ? canonicalIndex : (versions.length > 0 ? 0 : -1)

    return versions.map((row, index) => ({
        ...row,
        isCurrent: index === currentIndex,
    }))
}

export function filterPendingQueuedReports(pendingRows = [], serverRows = []) {
    const pending = Array.isArray(pendingRows) ? pendingRows : []
    const server = Array.isArray(serverRows) ? serverRows : []

    if (pending.length === 0) {
        return []
    }

    return pending.filter((pendingRow) => {
        const pendingPatientId = String(pendingRow?.patientId || '').trim()
        const pendingName = String(pendingRow?.patientName || '').trim().toLowerCase()
        const pendingQueueId = String(pendingRow?.sourceMetadata?.queueId || pendingRow?.id || '').trim()

        return !server.some((row) => {
            const serverId = String(row?.id || '').trim()
            const serverPatientId = String(row?.patientId || row?.patient_id || '').trim()
            const serverName = String(row?.patientName || row?.patient_name || '').trim().toLowerCase()
            const serverSourceTable = String(row?.sourceTable || '').trim().toLowerCase()
            const serverQueueId = String(row?.sourceMetadata?.queueId || '').trim()
            const isServerQueueRow = serverSourceTable === 'patient_report_jobs'
                || serverSourceTable.includes('report_jobs')
                || serverSourceTable.includes('report_queue')

            if (pendingQueueId && serverQueueId && pendingQueueId === serverQueueId) {
                return true
            }

            if (pendingQueueId && serverId && pendingQueueId === serverId) {
                return true
            }

            if (isServerQueueRow && pendingPatientId && serverPatientId) {
                return pendingPatientId === serverPatientId
            }

            if (isServerQueueRow && !pendingPatientId && !serverPatientId && pendingName && serverName) {
                return pendingName === serverName
            }

            return false
        })
    })
}
