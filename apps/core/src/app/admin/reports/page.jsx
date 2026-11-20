'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import AdminHeader from '@/admin-ui/components/AdminHeader'
import NDISFCAReportBuilder from '@/admin-ui/components/NDISFCAReportBuilder'
import { splitAttachmentContextFromBuilderFormData } from '@/lib/fcaAttachments'
import { getCurrentUser, getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import { getEffectiveDomainMode } from '@/lib/domainMode'
import ReportViewerPanel from '@/admin-ui/components/ReportViewerPanel'
import { getReportDisplayTimestamp } from '@/lib/reportTimestamp'
import { filterPendingQueuedReports, getReportVersions } from '@/lib/reportListUtils'
import { readStoredDefaultDomain } from '@/lib/defaultDomainPreference'

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
    const controller = new AbortController()
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)

    try {
        return await fetch(url, { ...options, signal: controller.signal })
    } finally {
        clearTimeout(timeoutHandle)
    }
}

function hasExplicitTimezone(value) {
    return /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(String(value || '').trim())
}

function getTimeZoneOffsetMs(timeZone, utcMs) {
    const date = new Date(utcMs)
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    })
    const parts = formatter.formatToParts(date)
    const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    const asUtcMs = Date.UTC(
        Number(lookup.year),
        Number(lookup.month) - 1,
        Number(lookup.day),
        Number(lookup.hour),
        Number(lookup.minute),
        Number(lookup.second)
    )

    return asUtcMs - utcMs
}

function parseTimestampInDomainTimeZone(value, timeZone = 'UTC') {
    const raw = String(value || '').trim()
    if (!raw) return Number.NaN

    if (hasExplicitTimezone(raw)) {
        const parsed = Date.parse(raw)
        return Number.isFinite(parsed) ? parsed : Number.NaN
    }

    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/)
    if (!match) {
        const parsed = Date.parse(raw)
        return Number.isFinite(parsed) ? parsed : Number.NaN
    }

    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    const hour = Number(match[4] || '0')
    const minute = Number(match[5] || '0')
    const second = Number(match[6] || '0')
    const millisecond = Number((match[7] || '0').padEnd(3, '0'))
    const localAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, second, millisecond)

    try {
        // Second pass keeps offsets accurate around DST boundaries.
        const firstOffset = getTimeZoneOffsetMs(timeZone, localAsUtcMs)
        const firstPassMs = localAsUtcMs - firstOffset
        const secondOffset = getTimeZoneOffsetMs(timeZone, firstPassMs)
        return localAsUtcMs - secondOffset
    } catch {
        const parsed = Date.parse(raw)
        return Number.isFinite(parsed) ? parsed : Number.NaN
    }
}

function formatRelativeTime(value, timeZone = 'UTC') {
    if (!value) return 'Unknown time'

    const timestamp = parseTimestampInDomainTimeZone(value, timeZone)
    if (!Number.isFinite(timestamp)) return 'Unknown time'

    const diffMs = Date.now() - timestamp
    const minute = 60 * 1000
    const hour = 60 * minute
    const day = 24 * hour

    if (diffMs < minute) return 'Just now'
    if (diffMs < hour) return `${Math.max(1, Math.floor(diffMs / minute))} minute(s) ago`
    if (diffMs < day) return `${Math.max(1, Math.floor(diffMs / hour))} hour(s) ago`
    return `${Math.max(1, Math.floor(diffMs / day))} day(s) ago`
}

function formatAbsoluteTime(value, timeZone = 'UTC') {
    const timestamp = parseTimestampInDomainTimeZone(value, timeZone)
    if (!Number.isFinite(timestamp)) return ''

    try {
        return new Intl.DateTimeFormat('en-AU', {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone,
        }).format(new Date(timestamp))
    } catch {
        return new Date(timestamp).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })
    }
}

function getReportStatusBadgeClasses(statusLabel) {
    const normalized = String(statusLabel || '').trim().toLowerCase()

    if (normalized === 'ready') {
        return 'border-green-200 bg-green-50 text-green-700'
    }

    if (normalized === 'failed') {
        return 'border-red-200 bg-red-50 text-red-700'
    }

    if (normalized === 'updating' || normalized === 'update pending') {
        return 'border-amber-200 bg-amber-50 text-amber-700'
    }

    return 'border-blue-200 bg-blue-50 text-blue-700'
}

function getReportSortPriority(report) {
    const label = String(report?.statusLabel || '').trim().toLowerCase()
    const status = String(report?.status || '').trim().toLowerCase()
    const value = label || status

    if (value === 'creating' || value === 'queued' || value === 'waiting') return 0
    if (value === 'updating' || value === 'update pending' || value === 'processing') return 1
    if (value === 'failed') return 2
    if (value === 'ready' || value === 'completed') return 3
    return 4
}

function mapStatusValueToLabel(statusValue) {
    const normalized = String(statusValue || '').trim().toLowerCase()

    if (!normalized) return ''
    if (normalized === 'queued') return 'Creating'
    if (normalized === 'processing') return 'Creating'
    if (normalized === 'failed') return 'Failed'
    if (normalized === 'completed' || normalized === 'ready') return 'Ready'
    if (normalized === 'waiting') return 'Waiting'

    return String(statusValue || '').trim()
}

const REPORT_PANEL_SURFACE_CLASS = 'rounded-lg border border-gray-200 bg-white/90 p-6 shadow-sm backdrop-blur-[1px]'
const REPORT_CARD_SURFACE_CLASS = 'rounded-lg border border-gray-200 bg-white/92 p-4 shadow-sm backdrop-blur-[1px] hover:border-gray-300'
const NDIS_FCA_REPORT_TYPE_ID = 'ndis-functional-capacity-assessment'
const OTF6_REPORT_TYPE_ID = 'otf6-initial-occupational-therapy-assessment'
const UNKNOWN_REPORT_TYPE_FILTER_KEY = '__unknown__'

function normalizeReportTypeKey(value) {
    return String(value || '').trim().toLowerCase()
}

function formatReportTypeLabelFromId(reportTypeId) {
    const raw = String(reportTypeId || '').trim()
    if (!raw) return 'Unknown'
    if (normalizeReportTypeKey(raw) === OTF6_REPORT_TYPE_ID) return 'IOTA'

    return raw
        .split(/[-_]+/)
        .filter(Boolean)
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join(' ')
}

function resolveReportTypeDescriptor(report, configuredTypes = []) {
    const configured = Array.isArray(configuredTypes) ? configuredTypes : []
    const resolvedId = normalizeReportTypeKey(resolveReportTypeIdFromReport(report))
    const typeDebug = resolveReportTypeDebug(report)
    const debugName = String(typeDebug?.reportTypeName || '').trim()
    const matchedType = configured.find((item) => normalizeReportTypeKey(item?.id) === resolvedId)
    const resolvedLabel = String(matchedType?.name || debugName || formatReportTypeLabelFromId(resolvedId)).trim() || 'Unknown'
    const label = resolvedId === NDIS_FCA_REPORT_TYPE_ID
        ? 'FCA'
        : resolvedId === OTF6_REPORT_TYPE_ID
            ? 'IOTA'
            : resolvedLabel

    return {
        id: resolvedId,
        label,
        isUnknown: !resolvedId,
        isNDISFCA: resolvedId === NDIS_FCA_REPORT_TYPE_ID,
    }
}

function getReportTypeBadgeClasses(reportTypeId) {
    const normalized = normalizeReportTypeKey(reportTypeId)

    if (!normalized) return 'border-gray-200 bg-gray-50 text-gray-700'
    if (normalized === NDIS_FCA_REPORT_TYPE_ID) return 'border-teal-200 bg-teal-50 text-teal-700'
    if (normalized.includes('otf6')) return 'border-sky-200 bg-sky-50 text-sky-700'
    if (normalized.includes('general')) return 'border-indigo-200 bg-indigo-50 text-indigo-700'
    return 'border-amber-200 bg-amber-50 text-amber-700'
}

function normalizeBuilderFormData(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    return value
}

function normalizeQueueNarrativeText(value) {
    const source = String(value || '')
    if (!source.trim()) return ''

    return source
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => line.replace(/^\s*[-*]\s+/, '').trimEnd())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

function normalizeFcaBuilderFormDataForQueue(builderFormData) {
    const normalized = normalizeBuilderFormData(builderFormData)
    if (!normalized) return null

    if (typeof normalized.diagnosisSummary !== 'string') {
        return { ...normalized }
    }

    return {
        ...normalized,
        diagnosisSummary: normalizeQueueNarrativeText(normalized.diagnosisSummary),
    }
}

function extractNDISBuilderFormDataFromReport(report) {
    const source = report?.sourceMetadata && typeof report.sourceMetadata === 'object' ? report.sourceMetadata : {}
    const metadata = source?.metadata && typeof source.metadata === 'object' ? source.metadata : {}

    const candidates = [
        source?.builderState?.ndisFca?.formData,
        metadata?.builderState?.ndisFca?.formData,
    ]

    for (const candidate of candidates) {
        const normalized = normalizeBuilderFormData(candidate)
        if (normalized) return normalized
    }

    return null
}

function buildNDISBuilderSourceMetadata(builderFormData) {
    const formData = normalizeBuilderFormData(builderFormData)

    return {
        reportTypeId: NDIS_FCA_REPORT_TYPE_ID,
        reportType: 'NDIS - Functional Capacity Assessment',
        builderState: {
            ndisFca: {
                formData,
            },
        },
    }
}

function normalizeAddressText(value) {
    if (!value) return ''

    if (typeof value === 'string') {
        return String(value || '').trim()
    }

    if (typeof value !== 'object' || Array.isArray(value)) {
        return ''
    }

    const parts = [
        value.addressLine1 || value.line1 || value.street,
        value.city || value.suburb || value.town,
        value.state || value.region,
        value.postalCode || value.postcode || value.zip,
        value.country,
    ]
        .map((part) => String(part || '').trim())
        .filter(Boolean)

    if (parts.length === 0) return ''
    return parts.join(', ')
}

function normalizePatientContextSource(patient) {
    if (!patient || typeof patient !== 'object' || Array.isArray(patient)) return null

    const metadata = patient?.metadata && typeof patient.metadata === 'object' && !Array.isArray(patient.metadata)
        ? patient.metadata
        : {}
    const answers = metadata?.sploseAnswers && typeof metadata.sploseAnswers === 'object' && !Array.isArray(metadata.sploseAnswers)
        ? metadata.sploseAnswers
        : {}
    const labels = metadata?.sploseLabelledAnswers && typeof metadata.sploseLabelledAnswers === 'object' && !Array.isArray(metadata.sploseLabelledAnswers)
        ? metadata.sploseLabelledAnswers
        : {}

    return {
        patientName: String(patient?.patient_name || patient?.patientName || '').trim(),
        ndisNumber: String(metadata.ndisNumber || metadata.ndis_number || labels['NDIS number'] || answers.claim_or_reference_number || answers.ndis_number || '').trim(),
        dateOfBirth: String(metadata.dateOfBirth || metadata.date_of_birth || labels['Date of birth'] || answers.date_of_birth || '').trim(),
        address: normalizeAddressText(metadata.address || labels['Address'] || answers.address || answers.addressLine1),
        planNominee: String(metadata.planNominee || metadata.plan_nominee || labels['Plan Nominee'] || answers.plan_nominee || '').trim(),
        planManager: String(metadata.planManager || metadata.plan_manager || labels['Plan Manager'] || answers.plan_manager || '').trim(),
    }
}

function buildNDISBuilderInitialFormDataFromPatient(patient) {
    const context = normalizePatientContextSource(patient)
    if (!context) return null

    const hasAnyValue = Boolean(
        context.patientName
        || context.ndisNumber
        || context.dateOfBirth
        || context.address
        || context.planNominee
        || context.planManager
    )

    if (!hasAnyValue) return null

    return {
        participantName: context.patientName || '',
        ndisNumber: context.ndisNumber || '',
        dateOfBirth: context.dateOfBirth || '',
        address: context.address || '',
        planNominee: context.planNominee || '',
        planManager: context.planManager || '',
    }
}

function resolveReportTypeIdFromReport(report) {
    const source = report?.sourceMetadata && typeof report.sourceMetadata === 'object' ? report.sourceMetadata : {}
    const metadata = source?.metadata && typeof source.metadata === 'object' ? source.metadata : {}

    const candidates = [
        metadata.reportTypeId,
        source.reportTypeId,
        metadata.reportType,
        source.reportType,
    ]

    for (const candidate of candidates) {
        const value = String(candidate || '').trim()
        if (value) return value
    }

    return ''
}

function resolveReportTypeDebug(report) {
    const source = report?.sourceMetadata && typeof report.sourceMetadata === 'object' ? report.sourceMetadata : {}
    const metadata = source?.metadata && typeof source.metadata === 'object' ? source.metadata : {}

    const reportTypeId = String(
        metadata.reportTypeId
        || source.reportTypeId
        || ''
    ).trim()
    const reportTypeName = String(
        metadata.reportType
        || source.reportType
        || ''
    ).trim()

    return {
        reportTypeId,
        reportTypeName,
    }
}

function resolveSourceJobIdDebug(report) {
    const source = report?.sourceMetadata && typeof report.sourceMetadata === 'object' ? report.sourceMetadata : {}
    const metadata = source?.metadata && typeof source.metadata === 'object' ? source.metadata : {}

    const sourceJobId = String(
        source.jobId
        || source.queueId
        || metadata.queueId
        || report?.lastJobId
        || ''
    ).trim()

    return sourceJobId
}

function hasTemplateWrapperMarkers(markdown) {
    const source = String(markdown || '').trim()
    if (!source) return false

    return /\{\{\s*(?:generated_report_body|report_body)\s*\}\}/i.test(source)
        || /##\s+Generated\s+Report\s+Body\b/i.test(source)
}

function wasTemplateAppliedDuringCreation(report) {
    const sourceMetadata = report?.sourceMetadata && typeof report.sourceMetadata === 'object' && !Array.isArray(report.sourceMetadata)
        ? report.sourceMetadata
        : {}

    if (sourceMetadata.templateApplied === true) {
        return true
    }

    const generator = String(sourceMetadata.generator || '').trim().toLowerCase()
    if (generator.includes('-template-')) {
        return true
    }

    return false
}

export default function ReportsPage() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const [loading, setLoading] = useState(true)
    const [reportsLoading, setReportsLoading] = useState(false)
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [activeDomain, setActiveDomain] = useState('')
    const [domainTimeZone, setDomainTimeZone] = useState('UTC')
    const [searchInput, setSearchInput] = useState('')
    const [searchText, setSearchText] = useState('')
    const [selectedWindow, setSelectedWindow] = useState('30')
    const [reports, setReports] = useState([])
    const [pendingQueuedReports, setPendingQueuedReports] = useState([])
    const [statusMessage, setStatusMessage] = useState('')
    const [selectedReport, setSelectedReport] = useState(null)
    const [selectedReportMarkdown, setSelectedReportMarkdown] = useState('')
    const [selectedReportApplyingTemplate, setSelectedReportApplyingTemplate] = useState(false)
    const [reportSaving, setReportSaving] = useState(false)
    const [reportDeleting, setReportDeleting] = useState(false)
    const [reportViewerMessage, setReportViewerMessage] = useState('')
    const [reportViewerTone, setReportViewerTone] = useState('info')
    const [selectedReportExportingDocx, setSelectedReportExportingDocx] = useState(false)
    const [statusTone, setStatusTone] = useState('info')
    const [isNewReportOpen, setIsNewReportOpen] = useState(false)
    const [newReportPatientName, setNewReportPatientName] = useState('')
    const [newReportPatientId, setNewReportPatientId] = useState('')
    const [newReportPatientSuggestions, setNewReportPatientSuggestions] = useState([])
    const [newReportType, setNewReportType] = useState('')
    const [newReportOptions, setNewReportOptions] = useState('{}')
    const [newReportContext, setNewReportContext] = useState('')
    const [newReportSubmitting, setNewReportSubmitting] = useState(false)
    const [reportTypeOptions, setReportTypeOptions] = useState([])
    const [reportAiQueueOptions, setReportAiQueueOptions] = useState({})
    const [reportTypeFilter, setReportTypeFilter] = useState('all')
    const [isNDISFCABuilderOpen, setIsNDISFCABuilderOpen] = useState(false)
    const [ndisBuilderInitialFormData, setNdisBuilderInitialFormData] = useState(null)
    const [ndisBuilderDraftId, setNdisBuilderDraftId] = useState(null)
    const ndisBuilderDraftIdRef = useRef(null)
    const autoTemplateAppliedReportKeysRef = useRef(new Set())
    const liveRefreshInFlightRef = useRef(false)
    const launchFcaFromQueryRef = useRef('')

    const applyTemplateToReportMarkdown = useCallback(async (report, reportMarkdown) => {
        const patientId = Number.parseInt(String(report?.patientId || ''), 10)
        const patientName = String(report?.patientName || '').trim()
        const reportTypeId = resolveReportTypeIdFromReport(report)

        if (!activeDomain || !Number.isFinite(patientId) || patientId <= 0) return null
        if (!reportTypeId) return null

        const token = await getOrCreateAdminTokenForLocalhost()
        if (!token) return null

        const response = await fetchWithTimeout('/api/database/patients/formal-report/export', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                format: 'template-markdown',
                domain: activeDomain,
                patient_id: String(patientId),
                patient_name: patientName || null,
                report_markdown: String(reportMarkdown || ''),
                report_type_id: reportTypeId,
            }),
        })

        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
            throw new Error(data?.error || 'Failed to apply selected template')
        }

        const mergedMarkdown = String(data?.mergedMarkdown || '')
        return mergedMarkdown.trim() ? mergedMarkdown : null
    }, [activeDomain])

    const refreshReports = useCallback(async ({ domain, search, days, silent = false } = {}) => {
        const scopedDomain = String(domain || activeDomain || '').trim().toLowerCase()
        if (!scopedDomain) {
            setReports([])
            return
        }

        if (!silent) {
            setReportsLoading(true)
            setStatusMessage('')
        }

        try {
            const token = await getOrCreateAdminTokenForLocalhost()
            if (!token) {
                throw new Error('Missing admin session token')
            }

            const query = new URLSearchParams({
                domain: scopedDomain,
                limit: '100',
            })

            if (String(search || '').trim()) {
                query.set('search', String(search || '').trim())
            }

            if (String(days || '').trim() && String(days || '').trim() !== 'all') {
                query.set('days', String(days || '').trim())
            }

            const response = await fetchWithTimeout(`/api/database/reports?${query.toString()}`, {
                cache: 'no-store',
                headers: { Authorization: `Bearer ${token}` },
            })
            const data = await response.json().catch(() => ({}))

            if (!response.ok) {
                throw new Error(data?.error || 'Failed to load reports')
            }

            const rows = Array.isArray(data?.data) ? data.data : []
            setReports(rows)
            setPendingQueuedReports((prev) => filterPendingQueuedReports(prev, rows))
        } catch (error) {
            if (!silent) {
                setReports([])
                setStatusMessage(error?.message || 'Failed to load reports')
                setStatusTone('error')
            }
        } finally {
            if (!silent) {
                setReportsLoading(false)
            }
        }
    }, [activeDomain])

    const loadReportTypeOptions = useCallback(async (domain) => {
        const scopedDomain = String(domain || '').trim().toLowerCase()
        if (!scopedDomain) {
            setReportTypeOptions([])
            setReportAiQueueOptions({})
            return
        }

        try {
            const token = await getOrCreateAdminTokenForLocalhost()
            if (!token) return

            const response = await fetchWithTimeout(`/api/settings/reports?domain=${encodeURIComponent(scopedDomain)}`, {
                cache: 'no-store',
                headers: { Authorization: `Bearer ${token}` },
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data?.error || 'Failed to load report settings')

            const configuredTypes = Array.isArray(data?.settings?.reportTypes) ? data.settings.reportTypes : []
            setReportTypeOptions(configuredTypes.map((item) => ({
                id: String(item?.id || '').trim(),
                name: String(item?.name || '').trim() || 'Untitled report type',
            })).filter((item) => item.id))

            const config = data?.settings?.config && typeof data.settings.config === 'object' && !Array.isArray(data.settings.config)
                ? data.settings.config
                : {}

            const provider = String(config.aiProvider || '').trim().toLowerCase() || undefined
            const selectedModel = String(config.selectedProviderModel || config.aimlModel || config.openAiModel || '').trim() || undefined
            const queueOptions = {}

            if (provider) {
                queueOptions.provider = provider
            }
            if (selectedModel) {
                queueOptions.model = selectedModel
            }
            if (config.hasProviderApiKey === true) {
                queueOptions.hasApiKey = true
            }

            setReportAiQueueOptions(queueOptions)
        } catch {
            setReportTypeOptions([])
            setReportAiQueueOptions({})
        }
    }, [])

    useEffect(() => {
        let cancelled = false

        async function bootstrap() {
            try {
                const token = await getOrCreateAdminTokenForLocalhost()
                if (cancelled) return

                if (!token) {
                    router.push('/login')
                    return
                }

                const user = getCurrentUser()
                if (!user) {
                    router.push('/login')
                    return
                }

                const hostname = typeof window !== 'undefined' ? window.location.hostname : ''
                const storedDomain = readStoredDefaultDomain()
                const { mode } = getEffectiveDomainMode(hostname, storedDomain)
                const userDomain = String(user?.domain || '').trim().toLowerCase()
                const effectiveDomain = userDomain || mode

                setActiveDomain(effectiveDomain)
                setIsAuthenticated(true)
                await Promise.all([
                    refreshReports({ domain: effectiveDomain, search: '', days: selectedWindow }),
                    loadReportTypeOptions(effectiveDomain),
                ])
            } catch (error) {
                if (cancelled) return
                setStatusMessage(error?.message || 'Failed to initialize reports page')
                setStatusTone('error')
            } finally {
                if (!cancelled) {
                    setLoading(false)
                }
            }
        }

        bootstrap()
        return () => {
            cancelled = true
        }
    }, [router, refreshReports, loadReportTypeOptions, selectedWindow])

    const handleApplyFilters = useCallback(async () => {
        setSearchText(searchInput)
        await refreshReports({ domain: activeDomain, search: searchInput, days: selectedWindow })
    }, [activeDomain, refreshReports, searchInput, selectedWindow])

    const handleResetFilters = useCallback(async () => {
        setSearchInput('')
        setSearchText('')
        setSelectedWindow('30')
        setReportTypeFilter('all')
        await refreshReports({ domain: activeDomain, search: '', days: '30' })
    }, [activeDomain, refreshReports])

    const visibleReports = useMemo(() => {
        const reportRows = Array.isArray(reports) ? reports : []
        const pendingRows = Array.isArray(pendingQueuedReports) ? pendingQueuedReports : []
        const combined = [...pendingRows, ...reportRows]

        if (combined.length <= 1) {
            return combined
        }

        const toTimestamp = (report) => {
            const value = getReportDisplayTimestamp(report)
            const parsed = parseTimestampInDomainTimeZone(value, domainTimeZone)
            return Number.isFinite(parsed) ? parsed : 0
        }

        return [...combined].sort((a, b) => {
            const priorityDiff = getReportSortPriority(a) - getReportSortPriority(b)
            if (priorityDiff !== 0) return priorityDiff

            const diff = toTimestamp(b) - toTimestamp(a)
            if (diff !== 0) return diff

            const aKey = String(a?.listKey || a?.id || '')
            const bKey = String(b?.listKey || b?.id || '')
            return bKey.localeCompare(aKey)
        })
    }, [domainTimeZone, pendingQueuedReports, reports])

    // One row per patient: the list is a patient index, and older versions live behind
    // the report editor's kebab menu instead of repeating the same patient. Pick by
    // recency rather than status priority so an older failed run cannot hide the latest report.
    const latestReports = useMemo(() => {
        if (visibleReports.length <= 1) return visibleReports

        const toTimestamp = (report) => {
            const value = getReportDisplayTimestamp(report)
            const parsed = parseTimestampInDomainTimeZone(value, domainTimeZone)
            return Number.isFinite(parsed) ? parsed : 0
        }

        const latestByPatient = new Map()
        const keep = new Set()

        for (const report of visibleReports) {
            const patientId = String(report?.patientId || report?.patient_id || '').trim()
            if (!patientId) {
                keep.add(report)
                continue
            }

            const current = latestByPatient.get(patientId)
            if (!current || toTimestamp(report) > toTimestamp(current)) {
                latestByPatient.set(patientId, report)
            }
        }

        for (const report of latestByPatient.values()) {
            keep.add(report)
        }

        return visibleReports.filter((report) => keep.has(report))
    }, [domainTimeZone, visibleReports])

    const hasInProgressReports = useMemo(() => {
        if (!Array.isArray(visibleReports) || visibleReports.length === 0) {
            return false
        }

        return visibleReports.some((report) => {
            const label = String(report?.statusLabel || '').trim().toLowerCase()
            const status = String(report?.status || '').trim().toLowerCase()
            const value = label || status

            return value === 'creating'
                || value === 'queued'
                || value === 'processing'
                || value === 'waiting'
                || value === 'updating'
                || value === 'update pending'
        })
    }, [visibleReports])

    const reportTypeFilterOptions = useMemo(() => {
        const configured = Array.isArray(reportTypeOptions) ? reportTypeOptions : []
        const options = [{ key: 'all', label: 'All Types' }]
        const seen = new Set(['all'])

        for (const type of configured) {
            const key = normalizeReportTypeKey(type?.id)
            if (!key || seen.has(key)) continue
            seen.add(key)
            const configuredLabel = String(type?.name || formatReportTypeLabelFromId(key)).trim() || formatReportTypeLabelFromId(key)
            options.push({ key, label: key === NDIS_FCA_REPORT_TYPE_ID ? 'FCA' : key === OTF6_REPORT_TYPE_ID ? 'IOTA' : configuredLabel })
        }

        for (const report of latestReports) {
            const descriptor = resolveReportTypeDescriptor(report, configured)
            const key = descriptor.isUnknown ? UNKNOWN_REPORT_TYPE_FILTER_KEY : descriptor.id
            if (!key || seen.has(key)) continue
            seen.add(key)
            options.push({ key, label: descriptor.label })
        }

        if (!seen.has(UNKNOWN_REPORT_TYPE_FILTER_KEY)) {
            options.push({ key: UNKNOWN_REPORT_TYPE_FILTER_KEY, label: 'Unknown' })
        }

        return options
    }, [latestReports, reportTypeOptions])

    const filteredReports = useMemo(() => {
        if (reportTypeFilter === 'all') return latestReports

        return latestReports.filter((report) => {
            const descriptor = resolveReportTypeDescriptor(report, reportTypeOptions)
            if (reportTypeFilter === UNKNOWN_REPORT_TYPE_FILTER_KEY) {
                return descriptor.isUnknown
            }
            return descriptor.id === reportTypeFilter
        })
    }, [latestReports, reportTypeFilter, reportTypeOptions])

    useEffect(() => {
        if (!activeDomain || !hasInProgressReports) {
            return
        }

        let cancelled = false

        const runRefresh = async () => {
            if (cancelled || liveRefreshInFlightRef.current) {
                return
            }

            liveRefreshInFlightRef.current = true
            try {
                await refreshReports({
                    domain: activeDomain,
                    search: searchText,
                    days: selectedWindow,
                    silent: true,
                })
            } finally {
                liveRefreshInFlightRef.current = false
            }
        }

        const intervalHandle = setInterval(() => {
            runRefresh().catch(() => { })
        }, 5000)

        runRefresh().catch(() => { })

        return () => {
            cancelled = true
            clearInterval(intervalHandle)
        }
    }, [activeDomain, hasInProgressReports, refreshReports, searchText, selectedWindow])

    useEffect(() => {
        let cancelled = false

        async function loadDomainTimeZone() {
            if (!activeDomain) return

            try {
                const token = await getOrCreateAdminTokenForLocalhost()
                if (!token || cancelled) return

                const response = await fetchWithTimeout('/api/settings/domains', {
                    cache: 'no-store',
                    headers: { Authorization: `Bearer ${token}` },
                })
                const data = await response.json().catch(() => ({}))
                const resolved = String(
                    data?.domains?.[activeDomain]?.timezone
                    || data?.domains?.[activeDomain]?.timeZone
                    || 'UTC'
                ).trim() || 'UTC'

                if (!cancelled) {
                    setDomainTimeZone(resolved)
                }
            } catch {
                if (!cancelled) {
                    setDomainTimeZone('UTC')
                }
            }
        }

        loadDomainTimeZone()
        return () => {
            cancelled = true
        }
    }, [activeDomain])

    const relativeTimes = useMemo(() => {
        if (!Array.isArray(visibleReports) || visibleReports.length === 0) {
            return {}
        }

        const nextRelativeTimes = {}
        for (const report of visibleReports) {
            const timestamp = getReportDisplayTimestamp(report)
            if (timestamp) {
                const rowKey = report?.listKey || report?.id
                nextRelativeTimes[String(rowKey)] = formatRelativeTime(timestamp, domainTimeZone)
            }
        }

        return nextRelativeTimes
    }, [domainTimeZone, visibleReports])

    const handlePatientNameChange = useCallback(async (value) => {
        setNewReportPatientName(value)
        setNewReportPatientId('')

        const trimmed = String(value || '').trim().toLowerCase()
        if (trimmed.length < 2 || !activeDomain) {
            setNewReportPatientSuggestions([])
            return
        }

        try {
            const token = await getOrCreateAdminTokenForLocalhost()
            if (!token) {
                setNewReportPatientSuggestions([])
                return
            }

            const response = await fetchWithTimeout(`/api/database/patients?domain=${encodeURIComponent(activeDomain)}&limit=20`, {
                cache: 'no-store',
                headers: { Authorization: `Bearer ${token}` },
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data?.error || 'Failed to load patients')

            const options = Array.isArray(data?.data) ? data.data : []
            const filtered = options.filter((patient) => {
                const name = String(patient?.patient_name || patient?.patientName || '').trim().toLowerCase()
                return name.includes(trimmed)
            }).slice(0, 8)

            setNewReportPatientSuggestions(filtered.map((patient) => ({
                id: String(patient?.id || ''),
                name: String(patient?.patient_name || patient?.patientName || '').trim(),
                patientName: String(patient?.patient_name || patient?.patientName || '').trim(),
                metadata: patient?.metadata && typeof patient.metadata === 'object' && !Array.isArray(patient.metadata)
                    ? patient.metadata
                    : null,
            })).filter((item) => item.id && item.name))
        } catch {
            setNewReportPatientSuggestions([])
        }
    }, [activeDomain])

    const handleSelectPatientSuggestion = useCallback((patient) => {
        if (!patient?.id || !patient?.name) return
        setNewReportPatientName(patient.name)
        setNewReportPatientId(String(patient.id))
        setNdisBuilderInitialFormData(buildNDISBuilderInitialFormDataFromPatient(patient))
        setNewReportPatientSuggestions([])
    }, [])

    const closeReportViewer = useCallback(() => {
        setSelectedReport(null)
        setSelectedReportMarkdown('')
        setSelectedReportApplyingTemplate(false)
        setReportDeleting(false)
        setReportViewerMessage('')
        setReportViewerTone('info')
    }, [])

    const handleOpenReport = useCallback((report) => {
        setSelectedReport(report || null)
        setSelectedReportMarkdown(String(report?.reportMarkdown || ''))
        setReportViewerMessage('')
        setReportViewerTone('info')
    }, [])

    const handleLoadReportVersions = useCallback(async (report) => {
        const patientId = Number.parseInt(String(report?.patientId || ''), 10)
        if (!activeDomain || !Number.isFinite(patientId) || patientId <= 0) {
            throw new Error('Missing patient context for report versions.')
        }

        const token = await getOrCreateAdminTokenForLocalhost()
        if (!token) {
            throw new Error('Missing admin session token')
        }

        const query = new URLSearchParams({
            domain: activeDomain,
            patient_id: String(patientId),
            limit: '100',
            days: 'all',
        })

        const response = await fetchWithTimeout(`/api/database/reports?${query.toString()}`, {
            cache: 'no-store',
            headers: { Authorization: `Bearer ${token}` },
        })
        const data = await response.json().catch(() => ({}))

        if (!response.ok) {
            throw new Error(data?.error || 'Failed to load report versions')
        }

        const rows = Array.isArray(data?.data) ? data.data : []
        return getReportVersions(rows).map((row) => ({
            ...row,
            timestampLabel: formatAbsoluteTime(row.updatedAt || row.createdAt, domainTimeZone),
            typeLabel: resolveReportTypeDescriptor(row, reportTypeOptions).label,
        }))
    }, [activeDomain, domainTimeZone, reportTypeOptions])

    const handleSelectReportVersion = useCallback((version, { isCurrent = false } = {}) => {
        handleOpenReport({
            ...version,
            isHistoricalVersion: !isCurrent,
        })
    }, [handleOpenReport])

    useEffect(() => {
        if (!selectedReport) return
        if (selectedReport?.isHistoricalVersion) return

        const sourceMarkdown = String(selectedReport?.reportMarkdown || '').trim()
        if (!sourceMarkdown) return
        if (hasTemplateWrapperMarkers(sourceMarkdown)) return
        if (wasTemplateAppliedDuringCreation(selectedReport)) return

        const reportKey = `${String(selectedReport?.listKey || selectedReport?.id || '')}::${String(selectedReport?.updatedAt || selectedReport?.createdAt || '')}`
        if (!reportKey) return
        if (autoTemplateAppliedReportKeysRef.current.has(reportKey)) return

        autoTemplateAppliedReportKeysRef.current.add(reportKey)

        let cancelled = false

        const run = async () => {
            setSelectedReportApplyingTemplate(true)
            try {
                const merged = await applyTemplateToReportMarkdown(selectedReport, sourceMarkdown)
                if (!merged || cancelled) return
                if (merged === sourceMarkdown) return

                setSelectedReportMarkdown(merged)
                setSelectedReport((current) => current ? { ...current, reportMarkdown: merged } : current)
                setReportViewerMessage('Linked template auto-applied. You can keep editing before save.')
                setReportViewerTone('success')
            } catch {
                // Keep original report text when auto-apply is unavailable.
            } finally {
                if (!cancelled) {
                    setSelectedReportApplyingTemplate(false)
                }
            }
        }

        run().catch(() => {
            if (!cancelled) {
                setSelectedReportApplyingTemplate(false)
            }
        })

        return () => {
            cancelled = true
        }
    }, [applyTemplateToReportMarkdown, selectedReport])

    useEffect(() => {
        if (!selectedReport) return

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                closeReportViewer()
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [closeReportViewer, selectedReport])

    const handleSaveSelectedReport = useCallback(async (nextMarkdown) => {
        if (!selectedReport?.patientId || !activeDomain) return

        const restoringPreviousVersion = selectedReport?.isHistoricalVersion === true

        setReportSaving(true)
        setReportViewerMessage('')

        try {
            const token = await getOrCreateAdminTokenForLocalhost()
            if (!token) {
                throw new Error('Missing admin session token')
            }

            const response = await fetchWithTimeout('/api/database/patients/formal-report', {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    domain: activeDomain,
                    patient_id: String(selectedReport.patientId),
                    patient_name: selectedReport.patientName || '',
                    report_markdown: nextMarkdown,
                    source_notes: String(selectedReport.sourceNotes || '').trim() || null,
                    source_metadata: selectedReport.sourceMetadata && typeof selectedReport.sourceMetadata === 'object'
                        ? selectedReport.sourceMetadata
                        : {},
                }),
            })
            const data = await response.json().catch(() => ({}))

            if (!response.ok) {
                throw new Error(data?.error || 'Failed to save report')
            }

            setSelectedReportMarkdown(nextMarkdown)
            setSelectedReport((current) => current
                ? ({
                    ...current,
                    reportMarkdown: nextMarkdown,
                    updatedAt: data?.report?.updatedAt || current.updatedAt,
                    isHistoricalVersion: false,
                })
                : current)
            setReportViewerMessage(restoringPreviousVersion
                ? 'Previous version saved as the current report.'
                : 'Report draft saved.')
            setReportViewerTone('success')
            await refreshReports({ domain: activeDomain, search: searchText, days: selectedWindow })
        } catch (error) {
            setReportViewerMessage(error?.message || 'Failed to save report')
            setReportViewerTone('error')
        } finally {
            setReportSaving(false)
        }
    }, [activeDomain, refreshReports, searchText, selectedReport, selectedWindow])

    const parseDownloadFileName = useCallback((contentDisposition, fallbackName) => {
        const raw = String(contentDisposition || '').trim()
        if (!raw) return fallbackName

        const utf8Match = raw.match(/filename\*=UTF-8''([^;]+)/i)
        if (utf8Match?.[1]) {
            try {
                return decodeURIComponent(utf8Match[1]).replace(/[\\/]+/g, '-').trim() || fallbackName
            } catch {
                return fallbackName
            }
        }

        const plainMatch = raw.match(/filename="?([^";]+)"?/i)
        if (plainMatch?.[1]) {
            return String(plainMatch[1]).replace(/[\\/]+/g, '-').trim() || fallbackName
        }

        return fallbackName
    }, [])

    const handleExportSelectedReportDocx = useCallback(async (reportMarkdown) => {
        if (!selectedReport?.patientId || !activeDomain) {
            setReportViewerMessage('Missing patient context for DOCX export.')
            setReportViewerTone('error')
            return
        }

        setSelectedReportExportingDocx(true)
        try {
            const token = await getOrCreateAdminTokenForLocalhost()
            if (!token) {
                throw new Error('Missing admin session token')
            }

            const response = await fetchWithTimeout('/api/database/patients/formal-report/export', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    format: 'word-docx',
                    domain: activeDomain,
                    patient_id: String(selectedReport.patientId),
                    patient_name: String(selectedReport.patientName || '').trim() || null,
                    report_markdown: String(reportMarkdown || ''),
                }),
            })

            if (!response.ok) {
                const data = await response.json().catch(() => ({}))
                throw new Error(data?.error || 'Failed to export report as DOCX')
            }

            const blob = await response.blob()
            const fallbackName = `${String(selectedReport.patientName || '').trim() || `patient-${String(selectedReport.patientId || '')}`}-formal-report.docx`
            const fileName = parseDownloadFileName(response.headers.get('content-disposition'), fallbackName)

            if (typeof window !== 'undefined') {
                const objectUrl = window.URL.createObjectURL(blob)
                const link = document.createElement('a')
                link.href = objectUrl
                link.download = fileName
                document.body.appendChild(link)
                link.click()
                link.remove()
                window.URL.revokeObjectURL(objectUrl)
            }

            setReportViewerMessage('DOCX download started.')
            setReportViewerTone('success')
        } catch (error) {
            setReportViewerMessage(error?.message || 'Failed to export report as DOCX')
            setReportViewerTone('error')
        } finally {
            setSelectedReportExportingDocx(false)
        }
    }, [activeDomain, parseDownloadFileName, selectedReport])

    const handleDeleteSelectedReport = useCallback(async () => {
        const sourceTable = String(selectedReport?.sourceTable || '').trim().toLowerCase()
        const reportId = Number.parseInt(String(selectedReport?.id || ''), 10)

        if (!activeDomain || !Number.isFinite(reportId) || reportId <= 0) {
            return
        }

        if (!sourceTable || sourceTable === 'pending-ui') {
            setReportViewerMessage('Only saved report drafts can be deleted from this view.')
            setReportViewerTone('error')
            return
        }

        const confirmed = window.confirm('Move this report to Recently Deleted? You can restore it from Recycling.')
        if (!confirmed) return

        setReportDeleting(true)
        setReportViewerMessage('')

        try {
            const token = await getOrCreateAdminTokenForLocalhost()
            if (!token) {
                throw new Error('Missing admin session token')
            }

            const response = await fetchWithTimeout('/api/database/reports', {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    domain: activeDomain,
                    id: reportId,
                    sourceTable,
                }),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to mark report as pending delete')
            }

            closeReportViewer()
            setStatusMessage('Report marked as pending delete. You can restore it from Recycling.')
            setStatusTone('success')
            await refreshReports({ domain: activeDomain, search: searchText, days: selectedWindow })
        } catch (error) {
            setReportViewerMessage(error?.message || 'Failed to mark report as pending delete')
            setReportViewerTone('error')
        } finally {
            setReportDeleting(false)
        }
    }, [activeDomain, closeReportViewer, refreshReports, searchText, selectedReport, selectedWindow])

    const handleReturnToNDISBuilder = useCallback((report) => {
        const descriptor = resolveReportTypeDescriptor(report, reportTypeOptions)
        if (!descriptor.isNDISFCA) {
            setStatusMessage('Only NDIS-FCA reports can be reopened in the builder.')
            setStatusTone('error')
            return
        }

        setNdisBuilderInitialFormData(extractNDISBuilderFormDataFromReport(report))
        const existingDraftId = String(report?.id || '').trim() || null
        setNdisBuilderDraftId(existingDraftId)
        ndisBuilderDraftIdRef.current = existingDraftId
        setNewReportPatientName(String(report?.patientName || '').trim())
        setNewReportPatientId(String(report?.patientId || '').trim())
        setIsNDISFCABuilderOpen(true)
    }, [reportTypeOptions])

    const handleSubmitNewReport = useCallback(async (event) => {
        event.preventDefault()
        if (!activeDomain) return

        const patientName = String(newReportPatientName || '').trim()
        if (!patientName) {
            setStatusMessage('Please enter the patient name.')
            setStatusTone('error')
            return
        }

        // Check if NDIS-FCA is selected
        const reportTypeId = String(newReportType || '').trim()
        if (reportTypeId === 'ndis-functional-capacity-assessment') {
            // Open the special NDIS-FCA builder instead of queuing
            setNdisBuilderInitialFormData((prev) => prev || buildNDISBuilderInitialFormDataFromPatient({
                patient_name: newReportPatientName,
                metadata: {},
            }))
            setNdisBuilderDraftId(null)
            ndisBuilderDraftIdRef.current = null
            setIsNewReportOpen(false)
            setIsNDISFCABuilderOpen(true)
            return
        }

        setNewReportSubmitting(true)
        setStatusMessage('')

        try {
            const token = await getOrCreateAdminTokenForLocalhost()
            if (!token) {
                throw new Error('Missing admin session token')
            }

            let optionsObject = {}
            try {
                optionsObject = JSON.parse(newReportOptions)
            } catch {
                throw new Error('Options must be valid JSON.')
            }

            const response = await fetchWithTimeout('/api/database/reports', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    domain: activeDomain,
                    patientName,
                    patientId: newReportPatientId || undefined,
                    reportType: newReportType || undefined,
                    options: optionsObject,
                    context: newReportContext || undefined,
                }),
            })
            const data = await response.json().catch(() => ({}))

            if (!response.ok) {
                throw new Error(data?.error || 'Failed to queue report')
            }

            const nowIso = new Date().toISOString()
            const queuedId = String(data?.queue?.id || data?.queueMirror?.id || '').trim()
            const contextPreview = String(newReportContext || '').trim()
            const pendingListKey = queuedId
                ? `pending-queue:${queuedId}`
                : `pending-queue:${nowIso}:${patientName}`

            setPendingQueuedReports((prev) => {
                const next = [
                    {
                        id: queuedId || pendingListKey,
                        listKey: pendingListKey,
                        domain: activeDomain,
                        patientId: String(newReportPatientId || '').trim() || null,
                        patientName,
                        preview: contextPreview || 'Report job queued',
                        sourceNotes: contextPreview,
                        reportMarkdown: '',
                        status: 'queued',
                        statusLabel: 'Creating',
                        sourceTable: 'pending-ui',
                        sourceMetadata: {
                            reportTypeId: String(newReportType || '').trim() || null,
                            reportType: String(newReportType || '').trim() || null,
                            queueId: queuedId || null,
                        },
                        createdAt: nowIso,
                        updatedAt: nowIso,
                        timestamp: nowIso,
                    },
                    ...(Array.isArray(prev) ? prev : []),
                ]

                const deduped = []
                const seen = new Set()
                for (const row of next) {
                    const key = String(row?.listKey || row?.id || '')
                    if (!key || seen.has(key)) continue
                    seen.add(key)
                    deduped.push(row)
                }

                return deduped.slice(0, 50)
            })

            setStatusMessage(`Report queued for ${patientName}.`)
            setStatusTone('success')
            setIsNewReportOpen(false)
            setNewReportPatientName('')
            setNewReportPatientId('')
            setNewReportPatientSuggestions([])
            setNewReportType('')
            setNewReportOptions('{}')
            setNewReportContext('')
            await refreshReports({ domain: activeDomain, search: searchText, days: selectedWindow })
        } catch (error) {
            setStatusMessage(error?.message || 'Failed to queue report')
            setStatusTone('error')
        } finally {
            setNewReportSubmitting(false)
        }
    }, [activeDomain, newReportContext, newReportOptions, newReportPatientId, newReportPatientName, newReportType, refreshReports, searchText, selectedWindow])

    const handleNDISFCASaveDraft = useCallback(async (reportMarkdown, builderFormData) => {
        const patientName = String(newReportPatientName || '').trim()
        const patientId = String(newReportPatientId || '').trim()

        if (!activeDomain || !patientName) {
            setStatusMessage('Missing patient information.')
            setStatusTone('error')
            return
        }

        try {
            const token = await getOrCreateAdminTokenForLocalhost()
            if (!token) {
                throw new Error('Missing admin session token')
            }

            // Save draft without closing the modal
            const response = await fetchWithTimeout('/api/database/patients/formal-report', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    domain: activeDomain,
                    draft_id: String(ndisBuilderDraftIdRef.current || '').trim() || undefined,
                    patient_id: patientId || null,
                    patient_name: patientName,
                    report_markdown: reportMarkdown,
                    report_type_id: 'ndis-functional-capacity-assessment',
                    report_type: 'NDIS - Functional Capacity Assessment',
                    source_metadata: buildNDISBuilderSourceMetadata(builderFormData),
                }),
            })
            const data = await response.json().catch(() => ({}))

            if (!response.ok) {
                throw new Error(data?.error || 'Failed to save report')
            }

            const savedDraftId = String(data?.report?.id || '').trim()
            if (savedDraftId) {
                setNdisBuilderDraftId(savedDraftId)
                ndisBuilderDraftIdRef.current = savedDraftId
            }

            setStatusMessage(`✓ Draft saved for ${patientName}. Close the builder to view and continue editing the draft in the reports list.`)
            setStatusTone('success')
            // Refresh the reports list to show the newly saved draft (not silent so user sees any errors)
            await refreshReports({ domain: activeDomain, search: searchText, days: selectedWindow })
            // Note: Do NOT close the modal - let the user continue editing
        } catch (error) {
            setStatusMessage(error?.message || 'Failed to save FCA report draft')
            setStatusTone('error')
        }
    }, [activeDomain, newReportPatientId, newReportPatientName, refreshReports, searchText, selectedWindow])

    const handleNDISFCASave = useCallback(async (reportMarkdown, builderFormData) => {
        const patientName = String(newReportPatientName || '').trim()
        const patientId = String(newReportPatientId || '').trim()
        const queuedBuilderFormData = normalizeFcaBuilderFormDataForQueue(builderFormData)

        // Step 8 reference-file text travels as queue context (the worker reads it
        // as `additionalContext`), so it is not duplicated into the builder state.
        const { formData: builderFormDataForQueue, attachmentContext: attachmentContextBlock } =
            splitAttachmentContextFromBuilderFormData(queuedBuilderFormData)
        const queueContext = [String(newReportContext || '').trim(), attachmentContextBlock].filter(Boolean).join('\n\n')

        if (!activeDomain || !patientName) {
            setStatusMessage('Missing patient information.')
            setStatusTone('error')
            return
        }

        try {
            const token = await getOrCreateAdminTokenForLocalhost()
            if (!token) {
                throw new Error('Missing admin session token')
            }

            const response = await fetchWithTimeout('/api/database/reports', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    domain: activeDomain,
                    patient_id: patientId || null,
                    patientName,
                    reportType: 'ndis-functional-capacity-assessment',
                    context: queueContext,
                    options: reportAiQueueOptions,
                    builderState: {
                        ndisFca: {
                            formData: builderFormDataForQueue,
                            draftMarkdown: String(reportMarkdown || ''),
                            sourceMetadata: buildNDISBuilderSourceMetadata(builderFormDataForQueue),
                        },
                    },
                }),
            })
            const data = await response.json().catch(() => ({}))

            if (!response.ok) {
                throw new Error(data?.error || 'Failed to queue report')
            }

            setStatusMessage(`FCA report queued for ${patientName}. The worker will generate the report using the configured AI settings.`)
            setStatusTone('success')
            setIsNDISFCABuilderOpen(false)
            setNdisBuilderInitialFormData(null)
            setNdisBuilderDraftId(null)
            ndisBuilderDraftIdRef.current = null
            setNewReportPatientName('')
            setNewReportPatientId('')
            setNewReportType('')
            setNewReportOptions('{}')
            setNewReportContext('')
            await refreshReports({ domain: activeDomain, search: searchText, days: selectedWindow })
        } catch (error) {
            setStatusMessage(error?.message || 'Failed to queue FCA report')
            setStatusTone('error')
        }
    }, [activeDomain, newReportContext, newReportPatientId, newReportPatientName, refreshReports, reportAiQueueOptions, searchText, selectedWindow])

    const canDeleteSelectedReport = useMemo(() => {
        const sourceTable = String(selectedReport?.sourceTable || '').trim().toLowerCase()
        const reportId = Number.parseInt(String(selectedReport?.id || ''), 10)
        return Number.isFinite(reportId)
            && reportId > 0
            && Boolean(sourceTable)
            && sourceTable !== 'pending-ui'
    }, [selectedReport])

    useEffect(() => {
        if (loading || !isAuthenticated) return

        const launchFca = String(searchParams.get('newFca') || '').trim()
        if (launchFca !== '1') return

        const patientId = String(searchParams.get('patientId') || '').trim()
        const patientName = String(searchParams.get('patientName') || '').trim()
        const launchKey = `${launchFca}:${patientId}:${patientName}`

        if (!launchKey || launchFcaFromQueryRef.current === launchKey) {
            return
        }
        launchFcaFromQueryRef.current = launchKey

        if (!patientName) {
            const timeoutId = window.setTimeout(() => {
                setStatusMessage('Unable to launch FCA builder: missing patient name.')
                setStatusTone('error')
            }, 0)
            return () => window.clearTimeout(timeoutId)
        }

        const timeoutId = window.setTimeout(() => {
            setNdisBuilderInitialFormData(null)
            setNdisBuilderDraftId(null)
            ndisBuilderDraftIdRef.current = null
            setNewReportPatientId(patientId)
            setNewReportPatientName(patientName)
            setNewReportType('ndis-functional-capacity-assessment')
            setIsNewReportOpen(false)
            setIsNDISFCABuilderOpen(true)
        }, 0)
        return () => window.clearTimeout(timeoutId)
    }, [isAuthenticated, loading, searchParams])

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <p className="text-sm text-gray-600">Loading reports...</p>
            </div>
        )
    }

    if (!isAuthenticated) {
        return null
    }

    return (
        <div className="min-h-screen">
            <AdminHeader title="Reports" brandingDomainKey={activeDomain} />

            <main className="mx-auto max-w-7xl px-4 py-8 space-y-6">
                <section className={REPORT_PANEL_SURFACE_CLASS}>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
                            <p className="mt-1 text-sm text-gray-600">Browse recent formal patient reports.</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setIsNewReportOpen(true)}
                                className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700"
                            >
                                New Report
                            </button>
                            <button
                                type="button"
                                onClick={() => router.push('/admin/reports/settings')}
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                            >
                                Report Settings
                            </button>
                            <button
                                type="button"
                                onClick={() => refreshReports({ domain: activeDomain, search: searchText, days: selectedWindow })}
                                disabled={reportsLoading}
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {reportsLoading ? 'Refreshing...' : 'Refresh'}
                            </button>
                        </div>
                    </div>

                    {statusMessage && (
                        <div className={`mt-4 rounded-md border px-3 py-2 text-sm ${statusTone === 'error'
                            ? 'border-red-200 bg-red-50 text-red-700'
                            : 'border-green-200 bg-green-50 text-green-700'
                            }`}>
                            {statusMessage}
                        </div>
                    )}
                </section>

                {isNewReportOpen && (
                    <section className={REPORT_PANEL_SURFACE_CLASS}>
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h2 className="text-lg font-semibold text-gray-900">Queue a new report</h2>
                                <p className="mt-1 text-sm text-gray-600">Enter the patient, choose the report type, and send the request to the existing backend engine.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsNewReportOpen(false)}
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                            >
                                Close
                            </button>
                        </div>

                        <form className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={handleSubmitNewReport}>
                            <label className="md:col-span-2">
                                <span className="text-xs font-medium text-gray-700">Patient name</span>
                                <input
                                    type="text"
                                    value={newReportPatientName}
                                    onChange={(event) => handlePatientNameChange(event.target.value)}
                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                    placeholder="Start typing a patient name"
                                    autoComplete="off"
                                />
                                {newReportPatientSuggestions.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {newReportPatientSuggestions.map((patient) => (
                                            <button
                                                key={patient.id}
                                                type="button"
                                                onClick={() => handleSelectPatientSuggestion(patient)}
                                                className="rounded-full border border-gray-300 bg-gray-50 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-100"
                                            >
                                                {patient.name}
                                            </button>
                                        ))}
                                    </div>
                                )}
                                <p className="mt-1 text-xs text-gray-500">Autocomplete uses the patients already stored.</p>
                            </label>

                            <label>
                                <span className="text-xs font-medium text-gray-700">Report type</span>
                                <select
                                    value={newReportType}
                                    onChange={(event) => setNewReportType(event.target.value)}
                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                >
                                    <option value="">Use configured default</option>
                                    {reportTypeOptions.map((type) => (
                                        <option key={type.id} value={type.id}>{type.name}</option>
                                    ))}
                                </select>
                            </label>

                            <label>
                                <span className="text-xs font-medium text-gray-700">Options (JSON)</span>
                                <input
                                    type="text"
                                    value={newReportOptions}
                                    onChange={(event) => setNewReportOptions(event.target.value)}
                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono"
                                    placeholder='{"includeRecommendations": true}'
                                />
                            </label>

                            <label className="md:col-span-2">
                                <span className="text-xs font-medium text-gray-700">Additional context</span>
                                <textarea
                                    value={newReportContext}
                                    onChange={(event) => setNewReportContext(event.target.value)}
                                    className="mt-1 min-h-24 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                    placeholder="Add any special instructions, referral details, or context for this report"
                                />
                            </label>

                            <div className="md:col-span-2 flex flex-wrap items-center justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => setIsNewReportOpen(false)}
                                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={newReportSubmitting}
                                    className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {newReportSubmitting ? 'Queueing...' : 'Queue report'}
                                </button>
                            </div>
                        </form>
                    </section>
                )}

                <section className={REPORT_PANEL_SURFACE_CLASS}>
                    <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
                        <label className="md:col-span-2">
                            <span className="text-xs font-medium text-gray-700">Search</span>
                            <input
                                type="text"
                                value={searchInput}
                                onChange={(event) => setSearchInput(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                        event.preventDefault()
                                        handleApplyFilters()
                                    }
                                }}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                placeholder="Search by patient name, report text, or source notes"
                            />
                        </label>

                        <label>
                            <span className="text-xs font-medium text-gray-700">Updated in</span>
                            <select
                                value={selectedWindow}
                                onChange={(event) => setSelectedWindow(event.target.value)}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            >
                                <option value="7">Last 7 days</option>
                                <option value="30">Last 30 days</option>
                                <option value="90">Last 90 days</option>
                                <option value="all">All time</option>
                            </select>
                        </label>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={handleApplyFilters}
                            disabled={reportsLoading}
                            className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            Apply Filters
                        </button>
                        <button
                            type="button"
                            onClick={handleResetFilters}
                            disabled={reportsLoading}
                            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            Reset
                        </button>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-gray-700">Report type</span>
                        {reportTypeFilterOptions.map((option) => {
                            const isActive = reportTypeFilter === option.key
                            return (
                                <button
                                    key={option.key}
                                    type="button"
                                    onClick={() => setReportTypeFilter(option.key)}
                                    className={`rounded-full border px-2.5 py-1 text-xs font-medium ${isActive
                                        ? 'border-gray-900 bg-gray-900 text-white'
                                        : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                                        }`}
                                >
                                    {option.label}
                                </button>
                            )
                        })}
                    </div>
                </section>

                {selectedReport ? (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6">
                        <div className="w-full max-w-6xl max-h-[90vh] overflow-auto rounded-xl border border-gray-200 bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
                            <div className="p-6">
                                <ReportViewerPanel
                                    title={selectedReport?.patientName ? `${selectedReport.patientName} Report` : 'Report'}
                                    patientName={selectedReport?.patientName || ''}
                                    patientId={selectedReport?.patientId}
                                    domain={activeDomain}
                                    report={selectedReport}
                                    initialMarkdown={selectedReportMarkdown}
                                    loading={reportSaving || selectedReportApplyingTemplate || reportDeleting}
                                    saving={reportSaving}
                                    deleting={reportDeleting}
                                    onSave={handleSaveSelectedReport}
                                    onDelete={canDeleteSelectedReport ? handleDeleteSelectedReport : null}
                                    onLoadVersions={handleLoadReportVersions}
                                    onSelectVersion={handleSelectReportVersion}
                                    onRefresh={() => handleOpenReport({ ...selectedReport, reportMarkdown: selectedReportMarkdown })}
                                    onClose={closeReportViewer}
                                    onExportDocx={handleExportSelectedReportDocx}
                                    exportingDocx={selectedReportExportingDocx}
                                    statusMessage={reportViewerMessage}
                                    statusTone={reportViewerTone}
                                />
                            </div>
                        </div>
                    </div>
                ) : null}

                <section className={REPORT_PANEL_SURFACE_CLASS}>
                    <div className="flex items-center justify-between gap-2">
                        <h2 className="text-lg font-semibold text-gray-900">Reports</h2>
                        <span className="text-xs text-gray-500">{filteredReports.length} result(s)</span>
                    </div>

                    <div className="mt-4 space-y-3">
                        {reportsLoading && (
                            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                                Loading reports...
                            </div>
                        )}

                        {!reportsLoading && filteredReports.length === 0 && (
                            <div className="rounded-md border border-dashed border-gray-200 px-3 py-4 text-sm text-gray-500">
                                No reports matched your current filters.
                            </div>
                        )}

                        {!reportsLoading && filteredReports.map((report) => {
                            const displayStatus = report.statusLabel
                                || mapStatusValueToLabel(report.status)
                                || 'Ready'
                            const typeDebug = resolveReportTypeDebug(report)
                            const sourceJobIdDebug = resolveSourceJobIdDebug(report)
                            const typeDescriptor = resolveReportTypeDescriptor(report, reportTypeOptions)

                            return (
                                <article
                                    key={report.listKey || report.id}
                                    className={REPORT_CARD_SURFACE_CLASS}
                                >
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-semibold text-gray-900">{report.patientName || 'Queued report'}</p>
                                            <p className="mt-1 text-sm text-gray-600 whitespace-pre-wrap">{report.preview || 'No preview available'}</p>
                                        </div>
                                        <div className="flex flex-col items-end gap-2">
                                            <div className="flex items-center gap-2">
                                                {typeDescriptor.isNDISFCA && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleReturnToNDISBuilder(report)}
                                                        className="rounded-md border border-teal-300 bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-700 hover:bg-teal-100"
                                                    >
                                                        Return to Builder
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => handleOpenReport(report)}
                                                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                                >
                                                    Open
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-gray-600 md:grid-cols-3">
                                        <div>
                                            <p className="font-medium text-gray-500">Patient ID</p>
                                            <p className="mt-0.5 text-gray-800">{report.patientId || 'Not set'}</p>
                                        </div>
                                        <div>
                                            <p className="font-medium text-gray-500">Status</p>
                                            <div className="mt-1 flex flex-col items-start gap-1">
                                                <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getReportStatusBadgeClasses(displayStatus)}`}>
                                                    {displayStatus}
                                                </span>
                                                <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getReportTypeBadgeClasses(typeDescriptor.id)}`}>
                                                    {typeDescriptor.label}
                                                </span>
                                                {(String(displayStatus).toLowerCase() === 'ready') && (report.updatedAt || report.createdAt) ? (
                                                    <span className="text-[11px] text-gray-500">
                                                        {relativeTimes[String(report.listKey || report.id)] || ''}
                                                    </span>
                                                ) : null}
                                            </div>
                                        </div>
                                        <div>
                                            <p className="font-medium text-gray-500">Source notes</p>
                                            <p className="mt-0.5 text-gray-800 line-clamp-2 whitespace-pre-wrap">{report.sourceNotes || 'None'}</p>
                                        </div>
                                    </div>

                                    <div className="mt-2 rounded border border-dashed border-gray-200 bg-gray-50 px-2 py-1.5 text-[11px] text-gray-600">
                                        <span className="font-semibold text-gray-700">Debug:</span>{' '}
                                        Report Type ID: {typeDebug.reportTypeId || 'n/a'}{' | '}
                                        Report Type: {typeDebug.reportTypeName || 'n/a'}{' | '}
                                        Source Job ID: {sourceJobIdDebug || 'n/a'}
                                    </div>
                                </article>
                            )
                        })}
                    </div>
                </section>

                {isNDISFCABuilderOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45">
                        <div className="w-full h-full max-w-5xl rounded-xl overflow-hidden shadow-2xl">
                            <NDISFCAReportBuilder
                                patientName={newReportPatientName}
                                patientId={newReportPatientId || undefined}
                                initialFormData={ndisBuilderInitialFormData}
                                queueContext={{
                                    domain: activeDomain,
                                    reportType: 'ndis-functional-capacity-assessment',
                                    additionalContext: newReportContext,
                                    options: reportAiQueueOptions,
                                }}
                                onSaveDraft={handleNDISFCASaveDraft}
                                onSave={handleNDISFCASave}
                                onClose={() => {
                                    setIsNDISFCABuilderOpen(false)
                                    setNdisBuilderInitialFormData(null)
                                    setNdisBuilderDraftId(null)
                                    ndisBuilderDraftIdRef.current = null
                                }}
                            />
                        </div>
                    </div>
                )}
            </main>
        </div>
    )
}
