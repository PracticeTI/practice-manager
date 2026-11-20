'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowUpRight, ChevronDown, LayoutGrid, RefreshCw } from 'lucide-react'
import AdminHeader from '@/admin-ui/components/AdminHeader'
import { PATIENT_DOCUMENT_TYPE_ICONS } from '@/admin-ui/components/patientDocumentTheme'
import { getCurrentUser, getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import { DEFAULT_DOMAIN_MODE, getEffectiveDomainMode } from '@/lib/domainMode'
import {
    FUNDING_TYPE_OPTIONS,
    STATUS_LABELS as QUOTE_STATUS_LABELS,
    STATUS_PILL_STYLES as QUOTE_STATUS_PILL_STYLES,
    buildQuoteMetrics,
    deriveQuoteStatus,
    formatCurrency,
} from '@/lib/patientQuoteDisplay'
import {
    STATUS_LABELS as CASE_STATUS_LABELS,
    STATUS_PILL_STYLES as CASE_STATUS_PILL_STYLES,
    buildCaseMetrics,
    deriveCaseStatus,
    formatAllocation,
    formatDisplayDate,
    getTypeConfig,
} from '@/lib/patientCaseDisplay'
import {
    AGREEMENT_STATUS_LABELS,
    AGREEMENT_STATUS_PILL_STYLES,
    buildServiceAgreementMetrics,
    deriveServiceAgreementStatus,
} from '@/lib/patientServiceAgreementDisplay'
import { describeSummaryStyleLabel } from '@/lib/scribeSummaryDisplay'
import { countFormAnswers, formatFormDateTime } from '@/lib/formDisplay'
import { PATIENT_DOCUMENT_TYPE_BY_KEY } from '@/lib/patientDocumentTypes'
import { readStoredDefaultDomain } from '@/lib/defaultDomainPreference'


// The All tab opens the page: one module per document type, which is the whole-index
// view the dashboard card links to. Each type keeps its own deep link as well.
const ALL_TYPES_KEY = 'all'
const ALL_TYPES_TAB = { key: ALL_TYPES_KEY, label: 'All', icon: LayoutGrid }
// Rows a module shows before the expand toggle reveals the rest.
const MODULE_PREVIEW_LIMIT = 3

const FUNDING_TYPE_LABELS = Object.fromEntries(FUNDING_TYPE_OPTIONS.map((option) => [option.value, option.label]))

function formatRelativeTime(value) {
    if (!value) return 'Unknown'

    const timestamp = new Date(value).getTime()
    if (!Number.isFinite(timestamp)) return 'Unknown'

    const diffMs = Date.now() - timestamp
    const minute = 60 * 1000
    const hour = 60 * minute
    const day = 24 * hour

    if (diffMs < minute) return 'Just now'
    if (diffMs < hour) return `${Math.max(1, Math.floor(diffMs / minute))}m ago`
    if (diffMs < day) return `${Math.max(1, Math.floor(diffMs / hour))}h ago`
    return `${Math.max(1, Math.floor(diffMs / day))}d ago`
}

function titleCaseStatus(value) {
    const status = String(value || '').trim()
    if (!status) return '—'
    return status.replace(/[-_]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

function truncate(value, limit = 110) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    if (text.length <= limit) return text
    return `${text.slice(0, limit - 1).trimEnd()}…`
}

function StatusPill({ label, className }) {
    return (
        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${className || 'border-gray-200 bg-gray-100 text-gray-600'}`}>
            {label}
        </span>
    )
}

/** The attention vocabulary the patient panels and dashboard cards already use. */
function FlagPill({ attention }) {
    if (!attention) return <span className="text-gray-300">—</span>

    const toneClasses = attention.tone === 'danger'
        ? 'border-red-200 bg-red-50 text-red-700'
        : 'border-amber-200 bg-amber-50 text-amber-800'

    return <StatusPill label={attention.label} className={toneClasses} />
}

/** Launches the patient record with the matching panel already selected. */
function PatientLaunchLink({ row, tab }) {
    const patientId = String(row?.patient_id ?? row?.patientId ?? '').trim()
    const patientName = String(row?.patient_name ?? row?.patientName ?? '').trim()
    const label = patientName || (patientId ? `Patient #${patientId}` : 'Unassigned patient')

    if (!patientId) {
        return <span className="text-gray-500">{label}</span>
    }

    return (
        <Link
            href={`/admin/patients?patientId=${encodeURIComponent(patientId)}&tab=${encodeURIComponent(tab)}`}
            className="inline-flex items-center gap-1 font-medium text-gray-900 hover:text-blue-700 hover:underline"
            title={`Open ${patientName || 'this patient'} on the ${tab} panel`}
        >
            <span className="truncate">{label}</span>
            <ArrowUpRight className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
        </Link>
    )
}

const CELL_CLASS = 'px-4 py-3 align-middle text-sm text-gray-700'
const HEADER_CELL_CLASS = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500'

// One entry per document type the patient record holds. The key, label, blurb and list
// endpoint come from the shared registry (the Docs dashboard card reads the same types),
// and `tab` is both the patient panel a row launches into and the sub-tab key here, so
// the two never drift apart.
const DOCUMENT_TYPES = [
    {
        ...PATIENT_DOCUMENT_TYPE_BY_KEY.quotes,
        tab: 'quotes',
        icon: PATIENT_DOCUMENT_TYPE_ICONS.quotes,
        emptyLabel: 'No quotes found yet.',
        searchPlaceholder: 'Search by patient, quote number or plan manager',
        searchValues: (row) => [row?.patient_name, row?.quote_number, row?.plan_manager, row?.prepared_by],
        columns: (now) => [
            { key: 'patient', header: 'Patient', render: (row) => <PatientLaunchLink row={row} tab="quotes" /> },
            { key: 'quote', header: 'Quote', render: (row) => row.quote_number || '—' },
            {
                key: 'status',
                header: 'Status',
                render: (row) => {
                    const status = deriveQuoteStatus(row)
                    return <StatusPill label={QUOTE_STATUS_LABELS[status] || titleCaseStatus(status)} className={QUOTE_STATUS_PILL_STYLES[status]} />
                },
            },
            { key: 'flag', header: 'Flag', render: (row) => <FlagPill attention={buildQuoteMetrics(row, now).attention} /> },
            { key: 'funding', header: 'Funding', render: (row) => FUNDING_TYPE_LABELS[row.funding_type] || titleCaseStatus(row.funding_type) },
            { key: 'total', header: 'Total', render: (row) => formatCurrency(row.total) },
            { key: 'valid', header: 'Valid until', render: (row) => formatDisplayDate(row.valid_until) },
            { key: 'updated', header: 'Updated', render: (row) => formatRelativeTime(row.updated_at) },
        ],
    },
    {
        ...PATIENT_DOCUMENT_TYPE_BY_KEY.cases,
        tab: 'cases',
        icon: PATIENT_DOCUMENT_TYPE_ICONS.cases,
        emptyLabel: 'No cases found yet.',
        searchPlaceholder: 'Search by patient, case number or practitioner',
        searchValues: (row) => [row?.patient_name, row?.case_number, row?.practitioner],
        columns: (now) => [
            { key: 'patient', header: 'Patient', render: (row) => <PatientLaunchLink row={row} tab="cases" /> },
            { key: 'case', header: 'Case', render: (row) => row.case_number || '—' },
            { key: 'type', header: 'Type', render: (row) => getTypeConfig(row.case_type).label },
            {
                key: 'remaining',
                header: 'Remaining',
                render: (row) => {
                    const metrics = buildCaseMetrics(row, now)
                    if (metrics.total <= 0) return '—'
                    return `${formatAllocation(row.case_type, metrics.remaining)} of ${formatAllocation(row.case_type, metrics.total)}`
                },
            },
            {
                key: 'status',
                header: 'Status',
                render: (row) => {
                    const status = deriveCaseStatus(row)
                    return <StatusPill label={CASE_STATUS_LABELS[status] || titleCaseStatus(status)} className={CASE_STATUS_PILL_STYLES[status]} />
                },
            },
            { key: 'flag', header: 'Flag', render: (row) => <FlagPill attention={buildCaseMetrics(row, now).attention} /> },
            { key: 'expiry', header: 'Expiry', render: (row) => formatDisplayDate(row.expiry_date) },
        ],
    },
    {
        ...PATIENT_DOCUMENT_TYPE_BY_KEY.agreements,
        tab: 'agreements',
        icon: PATIENT_DOCUMENT_TYPE_ICONS.agreements,
        emptyLabel: 'No service agreements found yet.',
        searchPlaceholder: 'Search by patient, agreement number or plan manager',
        searchValues: (row) => [row?.patient_name, row?.agreement_number, row?.plan_manager, row?.prepared_by],
        columns: (now) => [
            { key: 'patient', header: 'Patient', render: (row) => <PatientLaunchLink row={row} tab="agreements" /> },
            { key: 'agreement', header: 'Agreement', render: (row) => row.agreement_number || '—' },
            {
                key: 'status',
                header: 'Status',
                render: (row) => {
                    const status = deriveServiceAgreementStatus(row)
                    return <StatusPill label={AGREEMENT_STATUS_LABELS[status] || titleCaseStatus(status)} className={AGREEMENT_STATUS_PILL_STYLES[status]} />
                },
            },
            { key: 'flag', header: 'Flag', render: (row) => <FlagPill attention={buildServiceAgreementMetrics(row, now).attention} /> },
            { key: 'start', header: 'Start', render: (row) => formatDisplayDate(row.start_date) },
            { key: 'end', header: 'End', render: (row) => formatDisplayDate(row.end_date) },
            { key: 'updated', header: 'Updated', render: (row) => formatRelativeTime(row.updated_at) },
        ],
    },
    {
        ...PATIENT_DOCUMENT_TYPE_BY_KEY.forms,
        tab: 'forms',
        icon: PATIENT_DOCUMENT_TYPE_ICONS.forms,
        emptyLabel: 'No forms found yet.',
        searchPlaceholder: 'Search by patient, form title or ID',
        searchValues: (row) => [
            row?.patient_name,
            row?.linked_patient_name,
            row?.title,
            row?.external_id,
            row?.external_patient_id,
            row?.external_source,
        ],
        columns: () => [
            { key: 'patient', header: 'Patient', render: (row) => <PatientLaunchLink row={row} tab="forms" /> },
            { key: 'form', header: 'Form', render: (row) => row.title || '—' },
            { key: 'submitted', header: 'Submitted', render: (row) => formatFormDateTime(row.submitted_at) || '—' },
            {
                key: 'answers',
                header: 'Answers',
                render: (row) => {
                    const answers = countFormAnswers(row)
                    return `${answers} answer${answers === 1 ? '' : 's'}`
                },
            },
            { key: 'source', header: 'Source', render: (row) => row.external_source || '—' },
            { key: 'updated', header: 'Updated', render: (row) => formatRelativeTime(row.updated_at || row.submitted_at) },
        ],
    },
    {
        ...PATIENT_DOCUMENT_TYPE_BY_KEY.analyses,
        tab: 'analysis',
        icon: PATIENT_DOCUMENT_TYPE_ICONS.analyses,
        emptyLabel: 'No analyses found yet.',
        searchPlaceholder: 'Search by patient',
        searchValues: (row) => [row?.patientName],
        columns: () => [
            { key: 'patient', header: 'Patient', render: (row) => <PatientLaunchLink row={row} tab="analysis" /> },
            {
                key: 'status',
                header: 'Status',
                render: (row) => (
                    <StatusPill
                        label={titleCaseStatus(row.status)}
                        className={String(row.status).toLowerCase() === 'failed'
                            ? 'border-red-200 bg-red-50 text-red-700'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-700'}
                    />
                ),
            },
            {
                key: 'sources',
                header: 'Built from',
                render: (row) => {
                    const transcripts = Number(row.transcriptCount || 0)
                    const noteChars = Number(row.sourceNotesLength || 0)
                    return `${transcripts} transcript${transcripts === 1 ? '' : 's'} · ${noteChars.toLocaleString()} note chars`
                },
            },
            { key: 'updated', header: 'Updated', render: (row) => formatRelativeTime(row.updatedAt || row.createdAt) },
        ],
    },
    {
        ...PATIENT_DOCUMENT_TYPE_BY_KEY.summaries,
        tab: 'summary',
        icon: PATIENT_DOCUMENT_TYPE_ICONS.summaries,
        emptyLabel: 'No summaries found yet.',
        searchPlaceholder: 'Search by patient or style',
        searchValues: (row) => [row?.patientName, describeSummaryStyleLabel(row?.summaryStyle)],
        columns: () => [
            { key: 'patient', header: 'Patient', render: (row) => <PatientLaunchLink row={row} tab="summary" /> },
            { key: 'style', header: 'Style', render: (row) => describeSummaryStyleLabel(row.summaryStyle) },
            { key: 'excerpt', header: 'Excerpt', render: (row) => <span className="text-gray-600">{truncate(row.summaryText) || '—'}</span> },
            { key: 'updated', header: 'Updated', render: (row) => formatRelativeTime(row.updatedAt || row.createdAt) },
        ],
    },
]

/**
 * One document type on the All tab: its latest records, with the rest behind an expand
 * toggle so a busy type cannot push the others off the page. Mirrors the single-type
 * panel's table and empty states, minus the page-level search and count line.
 */
function DocumentTypeModule({ type, rows, columns, error, expanded, onToggleExpanded, searchActive }) {
    const Icon = type.icon
    const previewRows = expanded ? rows : rows.slice(0, MODULE_PREVIEW_LIMIT)
    const hasMore = rows.length > MODULE_PREVIEW_LIMIT

    return (
        <div className="rounded-lg border border-gray-200">
            <div className="flex items-start gap-3 border-b border-gray-200 px-4 py-3">
                <span className="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-gray-100 text-gray-600">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                    <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                        {type.label}
                        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold text-gray-600">
                            {rows.length}
                        </span>
                    </h2>
                    <p className="mt-0.5 max-w-2xl text-sm text-gray-600">{type.blurb}</p>
                </div>
            </div>

            <div className="px-4 py-3">
                {error && (
                    <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
                )}

                {previewRows.length === 0 ? (
                    <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-4 text-center text-sm text-gray-600">
                        {searchActive ? 'No records match that search.' : type.emptyLabel}
                    </p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    {columns.map((column) => (
                                        <th key={column.key} scope="col" className={HEADER_CELL_CLASS}>{column.header}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {previewRows.map((row, index) => (
                                    <tr key={row.id ?? row.key ?? `${type.key}-${index}`} className="hover:bg-gray-50">
                                        {columns.map((column) => (
                                            <td key={column.key} className={CELL_CLASS}>{column.render(row)}</td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {hasMore && (
                    <button
                        type="button"
                        onClick={onToggleExpanded}
                        aria-expanded={expanded}
                        className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-gray-700 hover:text-blue-700 hover:underline"
                    >
                        {expanded ? 'Show less' : `Show ${rows.length - MODULE_PREVIEW_LIMIT} more`}
                        <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
                    </button>
                )}
            </div>
        </div>
    )
}

export default function AdminDocsPage() {
    const router = useRouter()

    const [loading, setLoading] = useState(true)
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [activeDomain, setActiveDomain] = useState(DEFAULT_DOMAIN_MODE)
    const [adminToken, setAdminToken] = useState('')
    const [documentsEnabled, setDocumentsEnabled] = useState(false)

    const [activeTypeKey, setActiveTypeKey] = useState(ALL_TYPES_KEY)
    const [searchQuery, setSearchQuery] = useState('')
    const [rowsByType, setRowsByType] = useState(() => Object.fromEntries(DOCUMENT_TYPES.map((type) => [type.key, []])))
    const [errorsByType, setErrorsByType] = useState({})
    const [refreshing, setRefreshing] = useState(false)
    // Which All-tab modules are expanded past the preview cap, keyed by document type.
    const [expandedTypes, setExpandedTypes] = useState({})

    // Expiry and utilisation are relative to the day the page was opened.
    const [now] = useState(() => new Date())

    const isAllTypes = activeTypeKey === ALL_TYPES_KEY
    // Null on the All tab, which renders one module per type instead of a single panel.
    const activeType = useMemo(
        () => DOCUMENT_TYPES.find((type) => type.key === activeTypeKey) || null,
        [activeTypeKey]
    )

    // Fetch every list in one pass: the sub-tab counts are then known up front, and switching
    // tabs never shows a second loading state. One failing type does not blank the page.
    const loadDocuments = useCallback(async (token, domain) => {
        const headers = { Authorization: `Bearer ${token}` }

        const results = await Promise.all(DOCUMENT_TYPES.map(async (type) => {
            try {
                const response = await fetch(type.endpoint(domain), { headers, cache: 'no-store' })
                const data = await response.json().catch(() => ({}))
                if (!response.ok) {
                    throw new Error(data?.error || `Failed to load ${type.label.toLowerCase()}`)
                }
                return { key: type.key, rows: Array.isArray(data?.data) ? data.data : [], error: '' }
            } catch (error) {
                return { key: type.key, rows: [], error: error?.message || `Failed to load ${type.label.toLowerCase()}` }
            }
        }))

        return {
            rows: Object.fromEntries(results.map((result) => [result.key, result.rows])),
            errors: Object.fromEntries(results.filter((result) => result.error).map((result) => [result.key, result.error])),
        }
    }, [])

    const loadDocumentsEnabled = useCallback(async (token, domain) => {
        if (!token || !domain) return false

        try {
            const response = await fetch('/api/settings/domains', {
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store',
            })
            if (!response.ok) return false

            const data = await response.json().catch(() => ({}))
            // The Docs card carries its own per-domain toggle, so a domain can keep
            // Patients on and still retire the document index.
            const domainSettings = data?.domains?.[domain] || {}
            return domainSettings.patientsEnabled === true && domainSettings.docsCardEnabled !== false
        } catch {
            return false
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

                const documentsAvailable = await loadDocumentsEnabled(token, effectiveDomain)
                if (cancelled) return

                // The Docs dashboard card links straight to one type, e.g. /admin/docs?type=cases.
                // Read the deep link once during bootstrap instead of with useSearchParams so the
                // page renders without a Suspense boundary.
                const requestedType = typeof window !== 'undefined'
                    ? String(new URLSearchParams(window.location.search).get('type') || '').trim()
                    : ''
                if (PATIENT_DOCUMENT_TYPE_BY_KEY[requestedType]) {
                    setActiveTypeKey(requestedType)
                }

                setActiveDomain(effectiveDomain)
                setAdminToken(token)
                setDocumentsEnabled(documentsAvailable)
                setIsAuthenticated(true)

                // A domain without Patients — or with the Docs card switched off — has none
                // of these tables in scope, so there is nothing to read.
                if (documentsAvailable) {
                    const { rows, errors } = await loadDocuments(token, effectiveDomain)
                    if (cancelled) return

                    setRowsByType(rows)
                    setErrorsByType(errors)
                }
            } catch {
                if (!cancelled) {
                    router.push('/login')
                }
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
    }, [router, loadDocumentsEnabled, loadDocuments])

    const handleRefresh = useCallback(async () => {
        if (!adminToken || !activeDomain) return

        setRefreshing(true)
        try {
            const { rows, errors } = await loadDocuments(adminToken, activeDomain)
            setRowsByType(rows)
            setErrorsByType(errors)
        } finally {
            setRefreshing(false)
        }
    }, [adminToken, activeDomain, loadDocuments])

    // Sorting stays as the API returned it (newest first); the box only narrows what is shown.
    const filterRows = useCallback((type) => {
        const rows = rowsByType[type.key] || []
        const query = String(searchQuery || '').trim().toLowerCase()
        if (!query) return rows

        return rows.filter((row) => type.searchValues(row)
            .map((value) => String(value || '').toLowerCase())
            .join(' ')
            .includes(query))
    }, [rowsByType, searchQuery])

    const visibleRows = useMemo(() => (activeType ? filterRows(activeType) : []), [activeType, filterRows])

    // The All tab reports a running total across every module, narrowed the same way.
    const visibleTotal = useMemo(
        () => (isAllTypes ? DOCUMENT_TYPES.reduce((sum, type) => sum + filterRows(type).length, 0) : 0),
        [isAllTypes, filterRows]
    )

    const toggleExpandedType = useCallback((key) => {
        setExpandedTypes((previous) => ({ ...previous, [key]: !previous[key] }))
    }, [])

    const columns = useMemo(() => (activeType ? activeType.columns(now) : []), [activeType, now])
    const totalRecords = useMemo(
        () => DOCUMENT_TYPES.reduce((sum, type) => sum + (rowsByType[type.key]?.length || 0), 0),
        [rowsByType]
    )

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-sm text-gray-600">Loading documents...</div>
            </div>
        )
    }

    if (!isAuthenticated) {
        return null
    }

    return (
        <div className="min-h-screen">
            <AdminHeader title="Docs" brandingDomainKey={activeDomain} />

            <main className="mx-auto max-w-7xl px-4 py-8 space-y-6">
                <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Patient Documents</h1>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={handleRefresh}
                                disabled={refreshing || !documentsEnabled}
                                className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
                                {refreshing ? 'Refreshing...' : 'Refresh'}
                            </button>
                            <button
                                type="button"
                                onClick={() => router.push('/admin')}
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50"
                            >
                                Back to Admin
                            </button>
                        </div>
                    </div>

                    {!documentsEnabled && (
                        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                            Patient documents are disabled, so there is nothing to list yet.
                            Enable Patients and the Docs card in Domain Settings first.
                        </p>
                    )}
                </section>

                {documentsEnabled && (
                    <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
                        <div className="border-b border-gray-200 px-4">
                            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Patient document types">
                                {[ALL_TYPES_TAB, ...DOCUMENT_TYPES].map((type) => {
                                    const isActive = type.key === activeTypeKey
                                    const count = type.key === ALL_TYPES_KEY ? totalRecords : (rowsByType[type.key]?.length || 0)
                                    const Icon = type.icon
                                    return (
                                        <button
                                            key={type.key}
                                            type="button"
                                            role="tab"
                                            aria-selected={isActive}
                                            onClick={() => setActiveTypeKey(type.key)}
                                            className={`-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition-colors ${isActive
                                                ? 'border-gray-900 text-gray-900'
                                                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                                                }`}
                                        >
                                            <Icon className="h-4 w-4 flex-none" aria-hidden="true" />
                                            {type.label}
                                            <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${isActive ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
                                                {count}
                                            </span>
                                        </button>
                                    )
                                })}
                            </div>
                        </div>

                        <div role="tabpanel" className="px-5 py-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <p className="max-w-2xl text-sm text-gray-600">
                                    {isAllTypes
                                        ? 'Every document type in one place. Each module lists the newest records; expand one to see the rest.'
                                        : activeType.blurb}
                                </p>
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(event) => setSearchQuery(event.target.value)}
                                    placeholder={isAllTypes ? 'Search across all document types' : activeType.searchPlaceholder}
                                    className="w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm"
                                />
                            </div>

                            {isAllTypes ? (
                                <div className="mt-4 space-y-5">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                        {visibleTotal} record{visibleTotal === 1 ? '' : 's'}
                                        {searchQuery ? ` of ${totalRecords}` : ''}
                                    </p>
                                    {DOCUMENT_TYPES.map((type) => (
                                        <DocumentTypeModule
                                            key={type.key}
                                            type={type}
                                            rows={filterRows(type)}
                                            columns={type.columns(now)}
                                            error={errorsByType[type.key]}
                                            expanded={Boolean(expandedTypes[type.key])}
                                            onToggleExpanded={() => toggleExpandedType(type.key)}
                                            searchActive={Boolean(searchQuery)}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <>
                                    {errorsByType[activeType.key] && (
                                        <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                                            {errorsByType[activeType.key]}
                                        </p>
                                    )}

                                    <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">
                                        {visibleRows.length} record{visibleRows.length === 1 ? '' : 's'}
                                        {searchQuery ? ` of ${(rowsByType[activeType.key] || []).length}` : ''}
                                    </p>

                                    {visibleRows.length === 0 ? (
                                        <p className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-6 text-center text-sm text-gray-600">
                                            {searchQuery ? 'No records match that search.' : activeType.emptyLabel}
                                        </p>
                                    ) : (
                                        <div className="mt-3 overflow-x-auto">
                                            <table className="min-w-full divide-y divide-gray-200">
                                                <thead className="bg-gray-50">
                                                    <tr>
                                                        {columns.map((column) => (
                                                            <th key={column.key} scope="col" className={HEADER_CELL_CLASS}>{column.header}</th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-100">
                                                    {visibleRows.map((row, index) => (
                                                        <tr key={row.id ?? row.key ?? `${activeType.key}-${index}`} className="hover:bg-gray-50">
                                                            {columns.map((column) => (
                                                                <td key={column.key} className={CELL_CLASS}>{column.render(row)}</td>
                                                            ))}
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </section>
                )}

                {documentsEnabled && totalRecords === 0 && !Object.keys(errorsByType).length && (
                    <p className="text-center text-sm text-gray-500">
                        Nothing recorded across any document type yet.
                    </p>
                )}
            </main>
        </div>
    )
}
