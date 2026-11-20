import { NextResponse } from 'next/server'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { enqueueBillingTask, enqueueReportTask } from '@/lib/serviceClient'
import { enqueuePatientScribeJob, isScribeAgentEnabled } from '@/lib/patientScribeQueue'
import { enqueueEquipmentSourcerJob, isEquipmentSourcerEnabled } from '@/lib/patientEquipmentQueue'
import { enqueueQuoteWriterJob, isQuoteWriterEnabled } from '@/lib/patientQuoteJobs'
import { recordActivity, resolveActivityActor } from '@/lib/activities'
import { quoteWriterConfigSignature } from '@/lib/patientQuoteDrafting'
import { readReportSettingsForDomain } from '@/lib/reportSettingsStore'
import { buildReportAiUsagePayload } from '@/lib/reportAiUsagePayload'
import { enqueuePatientAnalysisJob } from '@/lib/patientAnalysisJobs'
import { enqueuePatientBillingJobLocalFallback, enqueuePatientReportJobLocalFallback } from '@/lib/patientQueueFallbacks'
import { readDomainPracticeName } from '@/lib/domainPracticeName'
import { syncPatientFormContacts } from '@/lib/patientFormContacts'

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

function normalizePatientRow(row) {
    if (!row || typeof row !== 'object') return row
    return {
        ...row,
        metadata: parseMetadataValue(row.metadata),
    }
}

function validateId(rawId) {
    const id = Number.parseInt(String(rawId || ''), 10)
    return Number.isFinite(id) && id > 0 ? id : null
}

async function resolveRouteParams(params) {
    if (params && typeof params.then === 'function') {
        return await params
    }
    return params || {}
}

function requireDomain(request) {
    const { searchParams } = new URL(request.url)
    const domain = String(searchParams.get('domain') || '').trim()
    return domain || null
}

/**
 * Resolve the domain this request may touch: an admin's own domain, or the
 * requested one for a superadmin. A patient row carries PII, so an unresolved
 * scope must fail rather than fall through to an unfiltered query.
 */
async function resolveScopedDomain(request) {
    return resolveAdminDomainScope(request, requireDomain(request))
}

function validateMetadata(metadata) {
    if (metadata === null || metadata === undefined) return null
    if (typeof metadata !== 'object' || Array.isArray(metadata)) {
        return 'metadata must be an object or null'
    }
    return null
}

function isReportingAgentEnabled(metadata) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false

    const patientAgents = metadata.patientAgents
    if (patientAgents && typeof patientAgents === 'object' && !Array.isArray(patientAgents)) {
        return patientAgents.reporting === true
    }

    const legacyAgents = metadata.agents
    if (legacyAgents && typeof legacyAgents === 'object' && !Array.isArray(legacyAgents)) {
        return legacyAgents.reporting === true
    }

    return false
}

function normalizeStringArray(value) {
    if (!Array.isArray(value)) return []
    return Array.from(new Set(
        value
            .map((item) => String(item || '').trim().toLowerCase())
            .filter(Boolean)
    )).sort((a, b) => a.localeCompare(b))
}

const REPORT_TYPE_VALUES = new Set([
    'functional-capacity-assessment',
    'assistive-technology-assessment',
    'home-modification-assessment',
    'otf6-initial-occupational-therapy-assessment',
])

const LEGACY_REPORT_TYPE_MAP = {
    clinical: 'functional-capacity-assessment',
    soap: 'assistive-technology-assessment',
    'bullet-summary': 'home-modification-assessment',
}

function normalizeReportingOutputStyle(value) {
    const normalized = String(value || '').trim().toLowerCase()
    const mapped = LEGACY_REPORT_TYPE_MAP[normalized] || normalized
    return REPORT_TYPE_VALUES.has(mapped) ? mapped : 'functional-capacity-assessment'
}

function normalizeOptionalStringId(value) {
    return String(value || '').trim()
}

function getConfiguredReportTypes(settingsPayload) {
    const normalizedSettings = settingsPayload?.settings && typeof settingsPayload.settings === 'object'
        ? settingsPayload.settings
        : settingsPayload
    const reportTypes = Array.isArray(normalizedSettings?.reportTypes) ? normalizedSettings.reportTypes : []
    return reportTypes.filter((item) => item && typeof item === 'object')
}

function resolveExplicitReportTypeFromPatientMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        return { reportTypeId: '', reportType: '' }
    }

    const patientAgents = metadata.patientAgents && typeof metadata.patientAgents === 'object' && !Array.isArray(metadata.patientAgents)
        ? metadata.patientAgents
        : metadata.agents && typeof metadata.agents === 'object' && !Array.isArray(metadata.agents)
            ? metadata.agents
            : {}

    const reportingConfig = patientAgents.reportingConfig && typeof patientAgents.reportingConfig === 'object' && !Array.isArray(patientAgents.reportingConfig)
        ? patientAgents.reportingConfig
        : {}

    const reportTypeId = String(
        reportingConfig.reportTypeId
        || reportingConfig.report_type_id
        || ''
    ).trim()
    const reportType = String(
        reportingConfig.reportType
        || reportingConfig.report_type
        || ''
    ).trim()

    return { reportTypeId, reportType }
}

function isHsrCreatorEnabled(metadata) {
    const agents = metadata?.patientAgents || metadata?.agents
    return Boolean(agents && typeof agents === 'object' && agents.hsrCreator === true)
}

async function resolveQueuedReportTypeMetadata(domain, patientMetadata) {
    const explicit = resolveExplicitReportTypeFromPatientMetadata(patientMetadata)

    let settingsPayload = null
    try {
        settingsPayload = await readReportSettingsForDomain(domain)
    } catch {
        settingsPayload = null
    }
    const configuredReportTypes = getConfiguredReportTypes(settingsPayload)
    const settingsObject = settingsPayload?.settings && typeof settingsPayload.settings === 'object'
        ? settingsPayload.settings
        : settingsPayload
    const defaultReportTypeId = String(settingsObject?.config?.defaultReportTypeId || '').trim()

    const selected = configuredReportTypes.find((item) => String(item?.id || '').trim() === explicit.reportTypeId)
        || configuredReportTypes.find((item) => String(item?.name || '').trim().toLowerCase() === explicit.reportType.toLowerCase())
        || configuredReportTypes.find((item) => String(item?.id || '').trim() === defaultReportTypeId)
        || configuredReportTypes.find((item) => String(item?.id || '').trim() === defaultReportTypeId)
        || configuredReportTypes[0]
        || null

    const resolvedReportTypeId = explicit.reportTypeId || String(selected?.id || '').trim()
    const resolvedReportType = explicit.reportType || String(selected?.name || '').trim()

    return {
        reportTypeId: resolvedReportTypeId || null,
        reportType: resolvedReportType || null,
    }
}

function getReportingConfigSignature(metadata) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        return JSON.stringify({
            outputStyle: 'functional-capacity-assessment',
            detailLevel: 'standard',
            includeRecommendations: true,
            includeTranscriptSnippets: true,
            focusAreas: ['functional-capacity'],
            additionalInstructions: '',
            comparativeReportFormatPatientId: '',
            comparativeReportFormatDraftId: '',
            comparativeRecommendationsPatientId: '',
            comparativeRecommendationsDraftId: '',
        })
    }

    const patientAgents = metadata.patientAgents && typeof metadata.patientAgents === 'object' && !Array.isArray(metadata.patientAgents)
        ? metadata.patientAgents
        : metadata.agents && typeof metadata.agents === 'object' && !Array.isArray(metadata.agents)
            ? metadata.agents
            : {}

    const config = patientAgents.reportingConfig && typeof patientAgents.reportingConfig === 'object' && !Array.isArray(patientAgents.reportingConfig)
        ? patientAgents.reportingConfig
        : {}

    return JSON.stringify({
        outputStyle: normalizeReportingOutputStyle(config.outputStyle || 'functional-capacity-assessment'),
        detailLevel: String(config.detailLevel || 'standard').trim().toLowerCase() || 'standard',
        includeRecommendations: config.includeRecommendations !== false,
        includeTranscriptSnippets: config.includeTranscriptSnippets !== false,
        focusAreas: normalizeStringArray(config.focusAreas && Array.isArray(config.focusAreas) ? config.focusAreas : ['functional-capacity']),
        additionalInstructions: String(config.additionalInstructions || '').trim(),
        comparativeReportFormatPatientId: normalizeOptionalStringId(config.comparativeReportFormatPatientId),
        comparativeReportFormatDraftId: normalizeOptionalStringId(config.comparativeReportFormatDraftId),
        comparativeRecommendationsPatientId: normalizeOptionalStringId(config.comparativeRecommendationsPatientId),
        comparativeRecommendationsDraftId: normalizeOptionalStringId(config.comparativeRecommendationsDraftId),
    })
}

function hasReportingConfigChanged(previousMetadata, nextMetadata) {
    return getReportingConfigSignature(previousMetadata) !== getReportingConfigSignature(nextMetadata)
}

function isBillingAgentEnabled(metadata) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false

    const patientAgents = metadata.patientAgents
    if (patientAgents && typeof patientAgents === 'object' && !Array.isArray(patientAgents)) {
        return patientAgents.billing === true || patientAgents.invoicing === true
    }

    const legacyAgents = metadata.agents
    if (legacyAgents && typeof legacyAgents === 'object' && !Array.isArray(legacyAgents)) {
        return legacyAgents.billing === true || legacyAgents.invoicing === true
    }

    return false
}

function isAnalysisAgentEnabled(metadata) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false

    const patientAgents = metadata.patientAgents
    if (patientAgents && typeof patientAgents === 'object' && !Array.isArray(patientAgents)) {
        return patientAgents.analyst === true || patientAgents.analysis === true
    }

    const legacyAgents = metadata.agents
    if (legacyAgents && typeof legacyAgents === 'object' && !Array.isArray(legacyAgents)) {
        return legacyAgents.analyst === true || legacyAgents.analysis === true
    }

    return false
}

const DEFAULT_ANALYST_WORKER_PROMPT = 'Review the patient notes and transcripts for FCA-relevant evidence. Focus on functional capacity, safety and risk, supports and recommendations, and goals and outcomes. Highlight evidence that would help build a strong, clinically grounded FCA report. When identifying supports or interventions, prefer specific, actionable suggestions such as occupational therapy, assistive technology, home modifications, personal care support, or community access supports. Classify each identified support as either already addressed (currently in place) or recommended (a new or increased support). Return addressed supports only through an addressedInterventions array and new/increased supports only through a recommendedInterventions array, where each item includes intervention and justification. Do not emit any other recommendation list content outside those arrays. Do not copy approved stems verbatim, do not reuse generic template phrases such as "The purpose of this assessment", and prefer fresh section-specific wording grounded in the supplied evidence.'

function normalizeAnalysisRecommendationBounds(config = {}) {
    const rawMin = Number.parseInt(config.minRecommendedInterventions, 10)
    const rawMax = Number.parseInt(config.maxRecommendedInterventions, 10)
    const min = Number.isFinite(rawMin) ? Math.max(0, Math.min(50, rawMin)) : 0
    const maxCandidate = Number.isFinite(rawMax) ? Math.max(min, Math.min(50, rawMax)) : 50

    return {
        minRecommendedInterventions: Math.min(min, maxCandidate),
        maxRecommendedInterventions: Math.max(min, maxCandidate),
    }
}

function getAnalysisConfigSignature(metadata) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        return JSON.stringify({ focus: 'fca-report-builder', includeTranscripts: true })
    }

    const patientAgents = metadata.patientAgents && typeof metadata.patientAgents === 'object' && !Array.isArray(metadata.patientAgents)
        ? metadata.patientAgents
        : metadata.agents && typeof metadata.agents === 'object' && !Array.isArray(metadata.agents)
            ? metadata.agents
            : {}

    const config = patientAgents.analysisConfig && typeof patientAgents.analysisConfig === 'object' && !Array.isArray(patientAgents.analysisConfig)
        ? patientAgents.analysisConfig
        : patientAgents.analystConfig && typeof patientAgents.analystConfig === 'object' && !Array.isArray(patientAgents.analystConfig)
            ? patientAgents.analystConfig
            : {}
    const recommendationBounds = normalizeAnalysisRecommendationBounds(config)

    return JSON.stringify({
        focus: String(config.focus || 'fca-report-builder').trim().toLowerCase() || 'fca-report-builder',
        includeTranscripts: config.includeTranscripts !== false,
        minRecommendedInterventions: recommendationBounds.minRecommendedInterventions,
        maxRecommendedInterventions: recommendationBounds.maxRecommendedInterventions,
        additionalInstructions: String(config.additionalInstructions || '').trim(),
        workerPrompt: String(config.workerPrompt || DEFAULT_ANALYST_WORKER_PROMPT).trim(),
    })
}

function hasAnalysisConfigChanged(previousMetadata, nextMetadata) {
    return getAnalysisConfigSignature(previousMetadata) !== getAnalysisConfigSignature(nextMetadata)
}

function getScribeConfigSignature(metadata) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        return JSON.stringify({ summaryStyle: 'topic-bullets-third-person', includeActionItems: true })
    }

    const patientAgents = metadata.patientAgents && typeof metadata.patientAgents === 'object' && !Array.isArray(metadata.patientAgents)
        ? metadata.patientAgents
        : metadata.agents && typeof metadata.agents === 'object' && !Array.isArray(metadata.agents)
            ? metadata.agents
            : {}

    const config = patientAgents.scribeConfig && typeof patientAgents.scribeConfig === 'object' && !Array.isArray(patientAgents.scribeConfig)
        ? patientAgents.scribeConfig
        : {}

    return JSON.stringify({
        summaryStyle: String(config.summaryStyle || 'topic-bullets-third-person').trim().toLowerCase() || 'topic-bullets-third-person',
        includeActionItems: config.includeActionItems !== false,
        additionalInstructions: String(config.additionalInstructions || '').trim(),
    })
}

function hasScribeConfigChanged(previousMetadata, nextMetadata) {
    return getScribeConfigSignature(previousMetadata) !== getScribeConfigSignature(nextMetadata)
}

async function enqueuePatientReportJob({ connection, patientId, patientName, domain, metadata, eventType = 'reporting_enabled', source = 'one:patient-agent-toggle' }) {
    const reportTypeMetadata = await resolveQueuedReportTypeMetadata(domain, metadata)
    // Reports name the practice, not the domain key the record is stored under.
    const queueMetadata = {
        ...(metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}),
        reportTypeId: reportTypeMetadata.reportTypeId,
        reportType: reportTypeMetadata.reportType,
        practiceName: await readDomainPracticeName(domain),
    }

    const aiUsage = await buildReportAiUsagePayload(domain)
    let upstreamResult = null
    try {
        upstreamResult = await enqueueReportTask({
            domain,
            patientId,
            patientName,
            eventType,
            requestedAction: 'create_or_edit',
            payload: {
                domain,
                patientId,
                patientName,
                metadata: queueMetadata,
                aiUsage,
                source
            }
        })
    } catch (error) {
        upstreamResult = {
            success: false,
            error: error?.message || 'Failed to enqueue report job'
        }
    }

    if (upstreamResult?.success || upstreamResult?.queued === true) {
        return upstreamResult
    }

    const fallbackResult = await enqueuePatientReportJobLocalFallback({
        connection,
        domain,
        patientId,
        patientName,
        metadata: queueMetadata,
        aiUsage,
        eventType,
        source
    })

    if (!fallbackResult?.success && fallbackResult?.queued !== true) {
        throw new Error(upstreamResult?.error || 'Failed to enqueue report job')
    }

    return {
        ...fallbackResult,
        upstreamUnavailable: true,
        upstreamError: upstreamResult?.error || null
    }
}

async function enqueuePatientBillingJob({ connection, patientId, patientName, domain, metadata }) {
    let upstreamResult = null
    try {
        upstreamResult = await enqueueBillingTask({
            domain,
            patientId,
            patientName,
            eventType: 'billing_enabled',
            requestedAction: 'generate_draft_invoice',
            payload: {
                domain,
                patientId,
                patientName,
                metadata,
                source: 'one:patient-agent-toggle'
            }
        })
    } catch (error) {
        upstreamResult = {
            success: false,
            error: error?.message || 'Failed to enqueue billing job'
        }
    }

    if (upstreamResult?.success || upstreamResult?.queued === true) {
        return upstreamResult
    }

    const fallbackResult = await enqueuePatientBillingJobLocalFallback({
        connection,
        patientId,
        patientName,
        domain,
        metadata,
        eventType: 'billing_enabled',
        source: 'one:patient-agent-toggle'
    })

    if (!fallbackResult?.success && fallbackResult?.queued !== true) {
        throw new Error(upstreamResult?.error || 'Failed to enqueue billing job')
    }

    return {
        ...fallbackResult,
        upstreamUnavailable: true,
        upstreamError: upstreamResult?.error || null
    }
}

export async function GET(request, { params }) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    const routeParams = await resolveRouteParams(params)
    const id = validateId(routeParams?.id)
    if (!id) {
        return NextResponse.json({ success: false, error: 'Invalid patient id' }, { status: 400 })
    }

    const scope = await resolveScopedDomain(request)
    if (scope.error) {
        return NextResponse.json({ success: false, error: scope.error }, { status: scope.status })
    }
    const domain = scope.domain

    let connection = null
    try {
        connection = await getDomainBoundConnection(domain)

        const result = await connection.query(
            'SELECT id, patient_name, domain, metadata, created_at, updated_at FROM patients WHERE id = $1 AND domain = $2 LIMIT 1',
            [id, domain]
        )
        const patient = normalizePatientRow(result.rows?.[0] || null)
        if (!patient) {
            return NextResponse.json({ success: false, error: 'Patient not found' }, { status: 404 })
        }
        return NextResponse.json({ success: true, patient })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load patient' }, { status: 500 })
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
    const id = validateId(routeParams?.id)
    if (!id) {
        return NextResponse.json({ success: false, error: 'Invalid patient id' }, { status: 400 })
    }

    const scope = await resolveScopedDomain(request)
    if (scope.error) {
        return NextResponse.json({ success: false, error: scope.error }, { status: scope.status })
    }
    const domain = scope.domain

    let connection = null
    try {
        const payload = await request.json().catch(() => ({}))
        const patientName = String(payload?.patient_name || '').trim()
        const metadata = payload?.metadata === undefined ? null : payload?.metadata

        if (!patientName) {
            return NextResponse.json({ success: false, error: 'patient_name is required' }, { status: 400 })
        }

        const metadataError = validateMetadata(metadata)
        if (metadataError) {
            return NextResponse.json({ success: false, error: metadataError }, { status: 400 })
        }

        connection = await getDomainBoundConnection(domain)
        const serializedMetadata = metadata === null ? null : JSON.stringify(metadata)
        let reportQueue = null
        let billingQueue = null
        let analysisQueue = null
        let equipmentSourcerQueue = null
        let scribeQueue = null
        let quoteWriterQueue = null

        const before = await connection.query(
            'SELECT metadata FROM patients WHERE id = $1 AND domain = $2 LIMIT 1',
            [id, domain]
        )

        const existing = normalizePatientRow(before.rows?.[0] || null)
        if (!existing) {
            return NextResponse.json({ success: false, error: 'Patient not found' }, { status: 404 })
        }

        const result = await connection.query(
            `UPDATE patients
             SET patient_name = $1,
                 metadata = $2::jsonb,
                 updated_at = NOW()
             WHERE id = $3 AND domain = $4
             RETURNING id, patient_name, domain, metadata, created_at, updated_at`,
            [patientName, serializedMetadata, id, domain]
        )
        const patient = normalizePatientRow(result.rows?.[0] || null)
        if (!patient) {
            return NextResponse.json({ success: false, error: 'Patient not found' }, { status: 404 })
        }

        await recordActivity({
            domain,
            action: 'update',
            entityType: 'patient',
            entityId: patient.id,
            entityLabel: patient.patient_name,
            patientId: patient.id,
            patientName: patient.patient_name,
            actor: await resolveActivityActor(request),
        }, { connection })

        // The people named on the form belong in the Contacts directory too. A
        // failure here must not fail the save, which has already committed.
        try {
            await syncPatientFormContacts(connection, {
                domain,
                patientId: patient.id,
                metadata: patient.metadata,
            })
        } catch (error) {
            console.error('Patient form contact sync failed:', error)
        }

        const reportingWasEnabled = isReportingAgentEnabled(existing.metadata)
        const reportingNowEnabled = isReportingAgentEnabled(patient.metadata)
        const reportingConfigChanged = hasReportingConfigChanged(existing.metadata, patient.metadata)
        const shouldQueueReport = (!reportingWasEnabled && reportingNowEnabled)
            || (reportingWasEnabled && reportingNowEnabled && reportingConfigChanged)

        const hsrWasEnabled = isHsrCreatorEnabled(existing.metadata)
        const hsrNowEnabled = isHsrCreatorEnabled(patient.metadata)
        const shouldQueueHsr = !hsrWasEnabled && hsrNowEnabled
        const reportMetadata = shouldQueueHsr
            ? {
                ...patient.metadata,
                patientAgents: {
                    ...(patient.metadata?.patientAgents || {}),
                    reportingConfig: {
                        ...(patient.metadata?.patientAgents?.reportingConfig || {}),
                        reportType: 'TAC - OTF10 Home Services Review',
                    },
                },
            }
            : patient.metadata

        if (shouldQueueReport || shouldQueueHsr) {
            reportQueue = await enqueuePatientReportJob({
                connection,
                patientId: patient.id,
                patientName: patient.patient_name,
                domain,
                metadata: reportMetadata,
                eventType: shouldQueueHsr ? 'hsr_creator_enabled' : (!reportingWasEnabled && reportingNowEnabled ? 'reporting_enabled' : 'reporting_config_changed'),
                source: shouldQueueHsr ? 'one:hsr-creator-toggle' : (!reportingWasEnabled && reportingNowEnabled ? 'one:patient-agent-toggle' : 'one:patient-agent-config-save')
            })
        }

        const billingWasEnabled = isBillingAgentEnabled(existing.metadata)
        const billingNowEnabled = isBillingAgentEnabled(patient.metadata)
        if (!billingWasEnabled && billingNowEnabled) {
            billingQueue = await enqueuePatientBillingJob({
                connection,
                patientId: patient.id,
                patientName: patient.patient_name,
                domain,
                metadata: patient.metadata
            })
        }

        const analysisWasEnabled = isAnalysisAgentEnabled(existing.metadata)
        const analysisNowEnabled = isAnalysisAgentEnabled(patient.metadata)
        const analysisConfigChanged = hasAnalysisConfigChanged(existing.metadata, patient.metadata)
        const shouldQueueAnalysis = (!analysisWasEnabled && analysisNowEnabled)
            || (analysisWasEnabled && analysisNowEnabled && analysisConfigChanged)
        if (shouldQueueAnalysis) {
            analysisQueue = await enqueuePatientAnalysisJob({
                connection,
                patientId: patient.id,
                patientName: patient.patient_name,
                domain,
                metadata: patient.metadata,
                eventType: !analysisWasEnabled && analysisNowEnabled ? 'analyst_enabled' : 'analyst_config_changed',
                source: !analysisWasEnabled && analysisNowEnabled ? 'one:patient-agent-toggle' : 'one:patient-agent-config-save'
            })
        }

        const equipmentSourcerWasEnabled = isEquipmentSourcerEnabled(existing.metadata)
        const equipmentSourcerNowEnabled = isEquipmentSourcerEnabled(patient.metadata)
        if (!equipmentSourcerWasEnabled && equipmentSourcerNowEnabled) {
            equipmentSourcerQueue = await enqueueEquipmentSourcerJob({
                connection,
                dbType,
                patientId: patient.id,
                patientName: patient.patient_name,
                domain,
                metadata: patient.metadata,
            })
        }

        const scribeWasEnabled = isScribeAgentEnabled(existing.metadata)
        const scribeNowEnabled = isScribeAgentEnabled(patient.metadata)
        const scribeConfigChanged = hasScribeConfigChanged(existing.metadata, patient.metadata)
        const shouldQueueScribe = (!scribeWasEnabled && scribeNowEnabled)
            || (scribeWasEnabled && scribeNowEnabled && scribeConfigChanged)
        if (shouldQueueScribe) {
            scribeQueue = await enqueuePatientScribeJob({
                connection,
                dbType,
                patientId: patient.id,
                patientName: patient.patient_name,
                domain,
                metadata: patient.metadata,
                eventType: !scribeWasEnabled && scribeNowEnabled ? 'scribe_enabled' : 'scribe_config_changed',
                requestedAction: 'summarize_pending_transcripts',
                source: !scribeWasEnabled && scribeNowEnabled ? 'one:patient-agent-toggle' : 'one:patient-agent-config-save',
            })
        }

        const quoteWriterWasEnabled = isQuoteWriterEnabled(existing.metadata)
        const quoteWriterNowEnabled = isQuoteWriterEnabled(patient.metadata)
        const quoteWriterConfigChanged = quoteWriterWasEnabled && quoteWriterNowEnabled
            && quoteWriterConfigSignature(existing.metadata) !== quoteWriterConfigSignature(patient.metadata)
        const shouldQueueQuoteWriter = (!quoteWriterWasEnabled && quoteWriterNowEnabled) || quoteWriterConfigChanged
        if (shouldQueueQuoteWriter) {
            quoteWriterQueue = await enqueueQuoteWriterJob({
                connection,
                dbType,
                patientId: patient.id,
                patientName: patient.patient_name,
                domain,
                metadata: patient.metadata,
                eventType: !quoteWriterWasEnabled && quoteWriterNowEnabled ? 'quote_writer_enabled' : 'quote_writer_config_changed',
                source: !quoteWriterWasEnabled && quoteWriterNowEnabled ? 'one:patient-agent-toggle' : 'one:patient-agent-config-save',
            })
        }

        return NextResponse.json({
            success: true,
            patient,
            reportQueue,
            billingQueue,
            analysisQueue,
            equipmentSourcerQueue,
            scribeQueue,
            quoteWriterQueue,
            reportImpact: {
                queued: Boolean(reportQueue?.queued === true || reportQueue?.success === true),
                reason: shouldQueueReport
                    ? (!reportingWasEnabled && reportingNowEnabled ? 'enabled' : 'config_changed')
                    : 'none'
            }
        })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to update patient' }, { status: 500 })
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
    const id = validateId(routeParams?.id)
    if (!id) {
        return NextResponse.json({ success: false, error: 'Invalid patient id' }, { status: 400 })
    }

    const scope = await resolveScopedDomain(request)
    if (scope.error) {
        return NextResponse.json({ success: false, error: scope.error }, { status: scope.status })
    }
    const domain = scope.domain

    let connection = null
    try {
        connection = await getDomainBoundConnection(domain)

        const result = await connection.query(
            'DELETE FROM patients WHERE id = $1 AND domain = $2 RETURNING id, patient_name',
            [id, domain]
        )
        const deletedPatient = result.rows?.[0] || null
        if (!deletedPatient) {
            return NextResponse.json({ success: false, error: 'Patient not found' }, { status: 404 })
        }

        await recordActivity({
            domain,
            action: 'delete',
            entityType: 'patient',
            entityId: deletedPatient.id,
            entityLabel: deletedPatient.patient_name,
            patientId: deletedPatient.id,
            patientName: deletedPatient.patient_name,
            actor: await resolveActivityActor(request),
        }, { connection })

        return NextResponse.json({ success: true })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to delete patient' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
