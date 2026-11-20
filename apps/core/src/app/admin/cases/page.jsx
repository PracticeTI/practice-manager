'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MoreVertical } from 'lucide-react'
import AdminHeader from '@/admin-ui/components/AdminHeader'
import { getCurrentUser, getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import { DEFAULT_DOMAIN_MODE, getEffectiveDomainMode } from '@/lib/domainMode'
import { isDocsBackedPageEnabled } from '@/lib/domainFeatureFlags'
import {
    DEFAULT_EXTERNAL_SOURCE,
    parseCaseCsv,
} from '@/lib/patientCases'
import {
    CASE_ATTENTION_WINDOW_DAYS,
    STATUS_LABELS,
    STATUS_PILL_STYLES,
    buildCaseMetrics,
    formatAllocation,
    formatDisplayDate,
    getTypeConfig,
} from '@/lib/patientCaseDisplay'
import { readStoredDefaultDomain } from '@/lib/defaultDomainPreference'


const STATUS_FILTER_OPTIONS = [
    { value: 'all', label: 'All statuses' },
    { value: 'open', label: 'Open' },
    { value: 'closed', label: 'Closed' },
    { value: 'expired', label: 'Expired' },
]

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
    const controller = new AbortController()
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)

    try {
        return await fetch(url, { ...options, signal: controller.signal })
    } finally {
        clearTimeout(timeoutHandle)
    }
}

function StatusPill({ status }) {
    return (
        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${STATUS_PILL_STYLES[status] || STATUS_PILL_STYLES.open}`}>
            {STATUS_LABELS[status] || String(status || 'open')}
        </span>
    )
}

function AttentionPill({ attention }) {
    if (!attention) return null

    const toneClasses = attention.tone === 'danger'
        ? 'border-red-200 bg-red-50 text-red-700'
        : 'border-amber-200 bg-amber-50 text-amber-800'

    return (
        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${toneClasses}`}>
            {attention.label}
        </span>
    )
}

function SummaryTile({ label, value, tone = 'neutral' }) {
    const toneClasses = tone === 'danger'
        ? 'text-red-700'
        : tone === 'warning'
            ? 'text-amber-700'
            : 'text-gray-900'

    return (
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
            <p className={`mt-1 text-2xl font-bold ${toneClasses}`}>{value}</p>
        </div>
    )
}

function CasesPageContent() {
    const router = useRouter()

    const [loading, setLoading] = useState(true)
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [activeDomain, setActiveDomain] = useState(DEFAULT_DOMAIN_MODE)
    const [casesEnabled, setCasesEnabled] = useState(false)
    const [cases, setCases] = useState([])
    const [loadingCases, setLoadingCases] = useState(false)
    const [statusMessage, setStatusMessage] = useState('')
    const [statusTone, setStatusTone] = useState('neutral')
    const [searchQuery, setSearchQuery] = useState('')
    const [statusFilter, setStatusFilter] = useState('all')
    const [attentionOnly, setAttentionOnly] = useState(false)

    // Expiry/utilisation is relative to the day the page was opened.
    const [now] = useState(() => new Date())

    const [importSource, setImportSource] = useState(DEFAULT_EXTERNAL_SOURCE)
    const [importFile, setImportFile] = useState(null)
    const [importText, setImportText] = useState('')
    const [importDryRun, setImportDryRun] = useState(true)
    const [importRunning, setImportRunning] = useState(false)
    const [importResult, setImportResult] = useState(null)
    const fileInputRef = useRef(null)

    // Importing lives behind the page menu: it is an occasional, advanced tool
    // rather than part of the day-to-day list view.
    const [importMenuOpen, setImportMenuOpen] = useState(false)
    const importMenuRef = useRef(null)

    const getAdminAuthHeaders = useCallback(async () => {
        const token = await getOrCreateAdminTokenForLocalhost()
        if (!token) throw new Error('Missing admin session token')
        return { Authorization: `Bearer ${token}` }
    }, [])

    const refreshCases = useCallback(async (domain) => {
        if (!domain) return

        setLoadingCases(true)
        try {
            const query = new URLSearchParams({ domain, limit: '300' })
            const headers = await getAdminAuthHeaders()
            const response = await fetchWithTimeout(`/api/database/cases?${query.toString()}`, {
                headers,
                cache: 'no-store',
            })
            const data = await response.json().catch(() => ({}))

            if (!response.ok) {
                throw new Error(data?.error || 'Failed to load cases')
            }

            setCases(Array.isArray(data?.data) ? data.data : [])
        } catch (error) {
            setCases([])
            setStatusMessage(error?.message || 'Failed to load cases')
            setStatusTone('error')
        } finally {
            setLoadingCases(false)
        }
    }, [getAdminAuthHeaders])

    const loadDomainFeatureState = useCallback(async (token, domain) => {
        if (!token || !domain) {
            return { casesEnabled: false }
        }

        try {
            const response = await fetchWithTimeout('/api/settings/domains', {
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store',
            })
            const data = await response.json().catch(() => ({}))
            const domainSettings = data?.domains?.[domain] || {}
            return {
                // The Docs page indexes cases too, so its card keeps this page reachable.
                casesEnabled: isDocsBackedPageEnabled(domainSettings, 'casesCardEnabled'),
            }
        } catch {
            return { casesEnabled: false }
        }
    }, [])

    // Dismiss the import menu on an outside click or Escape so it never traps
    // the page in a half-open state.
    useEffect(() => {
        if (!importMenuOpen) return undefined

        const handlePointerDown = (event) => {
            if (importMenuRef.current && !importMenuRef.current.contains(event.target)) {
                setImportMenuOpen(false)
            }
        }
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                setImportMenuOpen(false)
            }
        }

        document.addEventListener('mousedown', handlePointerDown)
        document.addEventListener('keydown', handleKeyDown)
        return () => {
            document.removeEventListener('mousedown', handlePointerDown)
            document.removeEventListener('keydown', handleKeyDown)
        }
    }, [importMenuOpen])

    const importPreview = useMemo(() => {
        if (!importText) return null
        try {
            const parsed = parseCaseCsv(importText)
            return {
                rowCount: parsed.rowCount,
                unknownHeaders: parsed.unknownHeaders,
                firstRow: parsed.records[0]?.raw || null,
            }
        } catch (error) {
            return { error: error?.message || 'Failed to parse CSV' }
        }
    }, [importText])

    const handleFileSelected = useCallback(async (file) => {
        if (!file) return

        setImportFile(file)
        setImportResult(null)

        try {
            const text = await file.text()
            setImportText(text)
        } catch (error) {
            setImportText('')
            setStatusMessage(error?.message || 'Failed to read the selected file')
            setStatusTone('error')
        }
    }, [])

    const runImport = useCallback(async (dryRun) => {
        if (!importText) {
            setStatusMessage('Choose a CSV file to import first')
            setStatusTone('error')
            return
        }

        setImportRunning(true)
        setImportResult(null)
        setStatusMessage('')
        setStatusTone('neutral')

        try {
            const headers = await getAdminAuthHeaders()
            const response = await fetchWithTimeout('/api/database/cases/import', {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    domain: activeDomain,
                    csv: importText,
                    source: importSource || DEFAULT_EXTERNAL_SOURCE,
                    fileName: importFile?.name || null,
                    dryRun,
                }),
            }, 120000)

            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to import cases')
            }

            setImportResult(data?.data || null)
            setStatusTone('success')

            if (!dryRun) {
                setStatusMessage(`Import complete: ${data?.data?.inserted ?? 0} added, ${data?.data?.updated ?? 0} updated.`)
                await refreshCases(activeDomain)
            } else {
                setStatusMessage('Dry run complete — nothing was written.')
            }
        } catch (error) {
            setStatusMessage(error?.message || 'Failed to import cases')
            setStatusTone('error')
        } finally {
            setImportRunning(false)
        }
    }, [importText, importSource, importFile, activeDomain, getAdminAuthHeaders, refreshCases])

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

                const domainFeatureState = await loadDomainFeatureState(token, effectiveDomain)
                if (cancelled) return

                setActiveDomain(effectiveDomain)
                setCasesEnabled(domainFeatureState.casesEnabled)
                setIsAuthenticated(true)
                await refreshCases(effectiveDomain)
            } catch (error) {
                if (cancelled) return
                setStatusMessage(error?.message || 'Failed to initialize cases view')
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
    }, [router, loadDomainFeatureState, refreshCases])

    const caseRows = useMemo(() => {
        return cases.map((row) => ({ row, metrics: buildCaseMetrics(row, now) }))
    }, [cases, now])

    const summary = useMemo(() => {
        return caseRows.reduce((acc, entry) => {
            if (entry.metrics.status === 'open') acc.open += 1
            if (entry.metrics.status === 'closed') acc.closed += 1
            if (entry.metrics.status === 'expired') acc.expired += 1
            if (entry.metrics.attention) acc.needsAttention += 1
            return acc
        }, { open: 0, closed: 0, expired: 0, needsAttention: 0 })
    }, [caseRows])

    const filteredRows = useMemo(() => {
        const query = String(searchQuery || '').trim().toLowerCase()

        return caseRows.filter(({ row, metrics }) => {
            if (statusFilter !== 'all' && metrics.status !== statusFilter) return false
            if (attentionOnly && !metrics.attention) return false
            if (!query) return true

            const haystack = [
                row?.patient_name,
                row?.case_number,
                row?.practitioner,
                `patient ${row?.patient_id}`,
            ]
                .map((value) => String(value || '').toLowerCase())
                .join(' ')

            return haystack.includes(query)
        })
    }, [caseRows, searchQuery, statusFilter, attentionOnly])

    const openPatientCase = (row) => {
        const patientId = String(row?.patient_id || '').trim()
        if (!patientId) return
        router.push(`/admin/patients?patientId=${encodeURIComponent(patientId)}&tab=cases`)
    }

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-sm text-gray-600">Loading cases...</div>
            </div>
        )
    }

    if (!isAuthenticated) {
        return null
    }

    const statusClasses =
        statusTone === 'success' ? 'bg-green-50 border-green-200 text-green-700' :
            statusTone === 'error' ? 'bg-red-50 border-red-200 text-red-700' :
                'bg-gray-50 border-gray-200 text-gray-600'

    return (
        <div className="min-h-screen">
            <AdminHeader title="Cases" brandingDomainKey={activeDomain} />

            <main className="mx-auto max-w-7xl px-4 py-8 space-y-6">
                <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Cases</h1>
                            <p className="mt-1 text-sm text-gray-600">
                                Funding allocations across every patient, with usage and expiry at a glance.
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => router.push('/admin')}
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50"
                            >
                                Back to Admin
                            </button>
                            <button
                                type="button"
                                onClick={() => refreshCases(activeDomain)}
                                disabled={loadingCases}
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {loadingCases ? 'Refreshing...' : 'Refresh'}
                            </button>

                            {/* Import lives behind this menu: it is an occasional,
                                advanced tool rather than part of the daily list view. */}
                            <div className="relative" ref={importMenuRef}>
                                <button
                                    type="button"
                                    onClick={() => setImportMenuOpen((open) => !open)}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                                    aria-label="More actions"
                                    aria-haspopup="true"
                                    aria-expanded={importMenuOpen}
                                    title="More actions"
                                >
                                    <MoreVertical className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                                </button>

                                {importMenuOpen && (
                                    <div className="absolute right-0 top-full z-20 mt-2 w-[24rem] max-w-[calc(100vw-2rem)] rounded-xl border border-gray-200 bg-white p-4 text-left shadow-lg">
                                        <h2 className="text-sm font-semibold text-gray-900">Import cases</h2>
                                        <p className="mt-1 text-xs text-gray-500">
                                            Upload a CSV export from the practice management system. Rows are matched on the
                                            external case ID, so re-importing the same file only touches records that changed.
                                            Each row is linked to the patient it belongs to; the upstream “Used” figure is
                                            recorded as a single usage entry so utilisation matches the export. Start with a
                                            dry run to preview the changes.
                                        </p>

                                        <label className="mt-4 block">
                                            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">CSV file</span>
                                            <input
                                                ref={fileInputRef}
                                                type="file"
                                                accept=".csv,text/csv"
                                                onChange={(event) => handleFileSelected(event.target.files?.[0] || null)}
                                                className="mt-1 w-full text-sm text-gray-700"
                                            />
                                        </label>

                                        <label className="mt-3 block">
                                            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">External source</span>
                                            <input
                                                type="text"
                                                value={importSource}
                                                onChange={(event) => setImportSource(event.target.value)}
                                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                placeholder="splose"
                                            />
                                        </label>

                                        <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
                                            <input
                                                type="checkbox"
                                                checked={importDryRun}
                                                onChange={(event) => setImportDryRun(event.target.checked)}
                                                className="h-4 w-4"
                                            />
                                            Dry run
                                        </label>

                                        <div className="mt-4 grid grid-cols-2 gap-2">
                                            <button
                                                type="button"
                                                onClick={() => runImport(true)}
                                                disabled={importRunning || !importText}
                                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                {importRunning ? 'Working...' : 'Preview changes'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => runImport(importDryRun)}
                                                disabled={importRunning || !importText}
                                                className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                {importRunning ? 'Importing...' : (importDryRun ? 'Import (dry run)' : 'Import')}
                                            </button>
                                        </div>

                                        {importPreview && (
                                            <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
                                                {importPreview.error ? (
                                                    <span className="text-red-700">{importPreview.error}</span>
                                                ) : (
                                                    <>
                                                        <p>
                                                            <span className="font-semibold">{importPreview.rowCount}</span> data row(s) detected
                                                            {importFile?.name ? ` in ${importFile.name}` : ''}.
                                                        </p>
                                                        {importPreview.unknownHeaders?.length > 0 && (
                                                            <p className="mt-1 text-amber-800">
                                                                Unrecognised column(s) will be ignored: {importPreview.unknownHeaders.join(', ')}
                                                            </p>
                                                        )}
                                                        {importPreview.firstRow && (
                                                            <p className="mt-1 text-gray-500">
                                                                First row: {importPreview.firstRow.patient_name || 'no patient'} ·{' '}
                                                                {importPreview.firstRow.case_number || 'no case number'} ·{' '}
                                                                {importPreview.firstRow.external_id || 'no external ID'}
                                                            </p>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        )}

                                        {importResult && (
                                            <div className="mt-3 rounded-md border border-gray-200 px-3 py-2 text-xs text-gray-700">
                                                <p className="font-semibold text-gray-900">
                                                    {importResult.dryRun ? 'Dry run result' : 'Import result'}
                                                </p>
                                                <ul className="mt-1 space-y-0.5">
                                                    <li>Rows read: {importResult.total}</li>
                                                    <li>Added: {importResult.inserted}</li>
                                                    <li>Updated: {importResult.updated}</li>
                                                    <li>Unchanged: {importResult.unchanged}</li>
                                                    <li>Skipped: {importResult.skipped}</li>
                                                    {importResult.usageCreated > 0 && <li>Usage entries added: {importResult.usageCreated}</li>}
                                                    {importResult.usageUpdated > 0 && <li>Usage entries updated: {importResult.usageUpdated}</li>}
                                                    {importResult.usageRemoved > 0 && <li>Usage entries cleared: {importResult.usageRemoved}</li>}
                                                </ul>
                                                {importResult.errors?.length > 0 && (
                                                    <ul className="mt-2 list-disc space-y-0.5 pl-5 text-red-700">
                                                        {importResult.errors.map((entry) => (
                                                            <li key={`${entry.row}-${entry.message}`}>Row {entry.row}: {entry.message}</li>
                                                        ))}
                                                    </ul>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {statusMessage && (
                        <p className={`mt-4 rounded-md border px-3 py-2 text-sm ${statusClasses}`}>{statusMessage}</p>
                    )}

                    {!casesEnabled && (
                        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                            Cases are disabled. Enable Patients and either the Cases or Docs card in Domain Settings first.
                        </p>
                    )}
                </section>

                <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
                    <SummaryTile label="Open" value={summary.open} />
                    <SummaryTile label="Needs attention" value={summary.needsAttention} tone={summary.needsAttention > 0 ? 'warning' : 'neutral'} />
                    <SummaryTile label="Expired" value={summary.expired} tone={summary.expired > 0 ? 'danger' : 'neutral'} />
                    <SummaryTile label="Closed" value={summary.closed} />
                </section>

                <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h2 className="text-base font-semibold text-gray-900">All Cases</h2>
                            <p className="mt-1 text-xs text-gray-500">
                                Expiring within {CASE_ATTENTION_WINDOW_DAYS} days and allocations at 90% or more are flagged.
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(event) => setSearchQuery(event.target.value)}
                                className="w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm"
                                placeholder="Filter by patient, case number or practitioner"
                            />
                            <select
                                value={statusFilter}
                                onChange={(event) => setStatusFilter(event.target.value)}
                                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                            >
                                {STATUS_FILTER_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                            <label className="flex items-center gap-2 text-sm text-gray-700">
                                <input
                                    type="checkbox"
                                    checked={attentionOnly}
                                    onChange={(event) => setAttentionOnly(event.target.checked)}
                                    className="h-4 w-4"
                                />
                                Needs attention only
                            </label>
                        </div>
                    </div>

                    <div className="mt-4 overflow-x-auto rounded-md border border-gray-200">
                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Patient</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Case</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Type</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Used / Allocated</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Remaining</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Utilisation</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Expiry</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Status</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 bg-white">
                                {filteredRows.map(({ row, metrics }) => (
                                    <tr key={row.id}>
                                        <td className="px-3 py-2 font-medium text-gray-900">
                                            {row.patient_name || `Patient ${row.patient_id}`}
                                        </td>
                                        <td className="px-3 py-2 text-gray-700">
                                            {row.case_number || '-'}
                                            {row.practitioner && (
                                                <span className="block text-xs text-gray-500">{row.practitioner}</span>
                                            )}
                                            {row.external_id && (
                                                <span className="mt-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">
                                                    Imported · {row.external_source || DEFAULT_EXTERNAL_SOURCE}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-gray-700">{getTypeConfig(row.case_type).label}</td>
                                        <td className="px-3 py-2 text-gray-700">
                                            <span className={metrics.over ? 'font-semibold text-red-600' : 'font-medium text-gray-900'}>
                                                {formatAllocation(row.case_type, metrics.used)}
                                            </span>
                                            <span className="text-gray-500"> / {formatAllocation(row.case_type, metrics.total)}</span>
                                        </td>
                                        <td className="px-3 py-2 font-medium text-gray-900">
                                            {metrics.total > 0 ? formatAllocation(row.case_type, metrics.remaining) : '-'}
                                        </td>
                                        <td className="px-3 py-2 text-gray-700">
                                            {metrics.total > 0 ? `${Math.round(metrics.utilisation)}%` : 'No allocation'}
                                            {metrics.attention && (
                                                <span className="mt-1 block">
                                                    <AttentionPill attention={metrics.attention} />
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-gray-700">{formatDisplayDate(row.expiry_date)}</td>
                                        <td className="px-3 py-2"><StatusPill status={metrics.status} /></td>
                                        <td className="px-3 py-2">
                                            <button
                                                type="button"
                                                onClick={() => openPatientCase(row)}
                                                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                            >
                                                Open
                                            </button>
                                        </td>
                                    </tr>
                                ))}

                                {!loadingCases && filteredRows.length === 0 && (
                                    <tr>
                                        <td colSpan={9} className="px-3 py-5 text-center text-gray-500">
                                            No cases found. Use the ⋮ menu above to import a CSV export.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>
            </main>
        </div>
    )
}

export default function CasesPage() {
    return (
        <Suspense>
            <CasesPageContent />
        </Suspense>
    )
}
