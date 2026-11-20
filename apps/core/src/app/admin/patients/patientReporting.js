import { createDraftSnapshot } from './patientMetadata'
import { normalizePatientAgents } from './patientPageConfig'
import { safeMetadata } from './patientUtils'

export async function  fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
    const controller = new AbortController()
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)

    try {
        return await fetch(url, { ...options, signal: controller.signal })
    } finally {
        clearTimeout(timeoutHandle)
    }
}

export function  resolveReportingSaveImpact({ mode, draft, initialDraftSnapshot, hasFormalReport }) {
    const currentAgents = normalizePatientAgents(draft?.agents)
    const initialSnapshot = safeMetadata(initialDraftSnapshot ? (() => {
        try {
            return JSON.parse(initialDraftSnapshot)
        } catch {
            return null
        }
    })() : null)
    const initialAgents = normalizePatientAgents(initialSnapshot?.agents)

    const reportingEnabledNow = currentAgents.reporting === true
    const reportingEnabledBefore = initialAgents.reporting === true
    const reportingConfigChanged = createDraftSnapshot({
        ...draft,
        agents: { ...currentAgents },
    }) !== initialDraftSnapshot

    if (mode === 'create') {
        if (reportingEnabledNow) {
            return {
                tone: 'info',
                text: 'Saving will queue draft report generation.',
                statusOverride: 'Creating',
            }
        }
        return null
    }

    if (!reportingEnabledNow && !reportingEnabledBefore) {
        return null
    }

    if (reportingEnabledNow && !reportingEnabledBefore) {
        return {
            tone: 'info',
            text: 'Saving will queue initial draft report generation.',
            statusOverride: 'Creating',
        }
    }

    if (reportingConfigChanged) {
        return {
            tone: 'info',
            text: hasFormalReport
                ? 'Saving will queue draft report regeneration and replace the current draft.'
                : 'Saving will queue draft report generation with the updated reporting settings.',
            statusOverride: 'Updating',
        }
    }

    return null
}

export function  resolveReportEnqueueMethodInfo(reportQueue, statusPayload) {
    const candidates = [reportQueue, statusPayload, reportQueue?.payload, statusPayload?.latest?.payload]
        .filter((value) => value && typeof value === 'object' && !Array.isArray(value))

    const rawMethod = candidates
        .flatMap((value) => [
            value.enqueueMethod,
            value.enqueue_method,
            value.method,
            value.source,
            value.requestedAction,
        ])
        .find((value) => String(value || '').trim())

    const enqueueMethod = String(rawMethod || '').trim()
    if (!enqueueMethod) {
        return { enqueueMethod: null, enqueueMethodLabel: '' }
    }

    let enqueueMethodLabel = enqueueMethod
    if (enqueueMethod.includes('patient-agent-toggle')) {
        enqueueMethodLabel = 'Toggle'
    } else if (enqueueMethod.includes('patient-agent-config-save')) {
        enqueueMethodLabel = 'Config save'
    } else if (enqueueMethod.includes('local-db-fallback')) {
        enqueueMethodLabel = 'Local fallback'
    } else if (enqueueMethod.includes(':')) {
        enqueueMethodLabel = enqueueMethod.split(':').pop() || enqueueMethod
    }

    enqueueMethodLabel = String(enqueueMethodLabel || '')
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase())
        .trim()

    return {
        enqueueMethod,
        enqueueMethodLabel,
    }
}

export function  getReportSourceKey(report) {
    return String(report?.sourceTable || '').trim().toLowerCase()
}

// A draft with no job id is the single in-progress save the FCA builder keeps per patient.
export function  isWorkingReportDraft(report) {
    return getReportSourceKey(report).includes('draft') && !report?.lastJobId
}

// A draft tied to a report job, or a patient_reports row, finished the full workflow.
export function  isGeneratedReportDraft(report) {
    return getReportSourceKey(report).includes('draft') && Boolean(report?.lastJobId)
}

export function  isInProgressReport(report) {
    const source = getReportSourceKey(report)
    return source.includes('job') || source.includes('queue')
}

export function  getReportTypeKey(report) {
    const metadata = report?.sourceMetadata && typeof report.sourceMetadata === 'object' ? report.sourceMetadata : null
    const raw = String(metadata?.reportTypeId || metadata?.reportType || '').trim().toLowerCase()
    return raw || 'unknown'
}

export function  getReportTypeLabelForReport(report) {
    const metadata = report?.sourceMetadata && typeof report.sourceMetadata === 'object' ? report.sourceMetadata : null
    const key = getReportTypeKey(report)
    if (key === 'ndis-functional-capacity-assessment') return 'FCA'
    if (key.startsWith('otf6')) return 'IOTA'

    const name = String(metadata?.reportType || '').trim()
    if (name) return name
    if (key === 'unknown') return 'Report'

    return key
        .split(/[-_]+/)
        .filter(Boolean)
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join(' ')
}
