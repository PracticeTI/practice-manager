'use client'

import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MoreVertical } from 'lucide-react'
import AdminHeader from '@/admin-ui/components/AdminHeader'
import { getCurrentUser, getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import { DEFAULT_DOMAIN_MODE, getEffectiveDomainMode } from '@/lib/domainMode'
import { isDocsBackedPageEnabled } from '@/lib/domainFeatureFlags'
import { DEFAULT_EXTERNAL_SOURCE, parseFormCsv } from '@/lib/forms'
import { buildFormMetrics, buildFormSections, describeFormSummary, formatFormDateTime } from '@/lib/formDisplay'
import { readStoredDefaultDomain } from '@/lib/defaultDomainPreference'

const PAGE_LIMIT = '500'

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
    const controller = new AbortController()
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)

    try {
        return await fetch(url, { ...options, signal: controller.signal })
    } finally {
        clearTimeout(timeoutHandle)
    }
}

function SummaryTile({ label, value, tone = 'neutral' }) {
    const toneClasses = tone === 'warning' ? 'text-amber-700' : 'text-gray-900'

    return (
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
            <p className={`mt-1 text-2xl font-bold ${toneClasses}`}>{value}</p>
        </div>
    )
}

function FormsPageContent() {
    const router = useRouter()

    const [loading, setLoading] = useState(true)
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [activeDomain, setActiveDomain] = useState(DEFAULT_DOMAIN_MODE)
    const [formsEnabled, setFormsEnabled] = useState(false)

    const [forms, setForms] = useState([])
    const [loadingForms, setLoadingForms] = useState(false)
    const [statusMessage, setStatusMessage] = useState('')
    const [statusTone, setStatusTone] = useState('neutral')

    const [searchQuery, setSearchQuery] = useState('')
    const [includeArchived, setIncludeArchived] = useState(false)
    const [expandedFormId, setExpandedFormId] = useState(null)

    // Kept in a ref so `refreshForms` stays stable and the checkbox can trigger
    // a refetch with the freshly toggled value.
    const includeArchivedRef = useRef(false)

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

    const refreshForms = useCallback(async (domain) => {
        if (!domain) return

        setLoadingForms(true)
        try {
            const query = new URLSearchParams({ domain, limit: PAGE_LIMIT })
            if (includeArchivedRef.current) query.set('includeArchived', '1')

            const headers = await getAdminAuthHeaders()
            const response = await fetchWithTimeout(`/api/database/forms?${query.toString()}`, {
                headers,
                cache: 'no-store',
            })
            const data = await response.json().catch(() => ({}))

            if (!response.ok) {
                throw new Error(data?.error || 'Failed to load forms')
            }

            setForms(Array.isArray(data?.data) ? data.data : [])
        } catch (error) {
            setForms([])
            setStatusMessage(error?.message || 'Failed to load forms')
            setStatusTone('error')
        } finally {
            setLoadingForms(false)
        }
    }, [getAdminAuthHeaders])

    const loadDomainFeatureState = useCallback(async (token, domain) => {
        if (!token || !domain) {
            return { formsEnabled: false }
        }

        try {
            const response = await fetchWithTimeout('/api/settings/domains', {
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store',
            })
            const data = await response.json().catch(() => ({}))
            const domainSettings = data?.domains?.[domain] || {}
            return {
                // The Docs page indexes forms too, so its card keeps this page reachable.
                formsEnabled: isDocsBackedPageEnabled(domainSettings, 'formsCardEnabled'),
            }
        } catch {
            return { formsEnabled: false }
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
                setFormsEnabled(domainFeatureState.formsEnabled)
                setIsAuthenticated(true)
                await refreshForms(effectiveDomain)
            } catch (error) {
                if (cancelled) return
                setStatusMessage(error?.message || 'Failed to initialize forms view')
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
    }, [router, loadDomainFeatureState, refreshForms])

    const summary = useMemo(() => buildFormMetrics(forms), [forms])

    const filteredRows = useMemo(() => {
        const query = String(searchQuery || '').trim().toLowerCase()
        if (!query) return forms

        return forms.filter((row) => {
            const haystack = [
                row?.patient_name,
                row?.linked_patient_name,
                row?.title,
                row?.external_id,
                row?.external_patient_id,
            ]
                .map((value) => String(value || '').toLowerCase())
                .join(' ')

            return haystack.includes(query)
        })
    }, [forms, searchQuery])

    const importPreview = useMemo(() => {
        if (!importText) return null
        try {
            const parsed = parseFormCsv(importText)
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
            const response = await fetchWithTimeout('/api/database/forms/import', {
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
                throw new Error(data?.error || 'Failed to import forms')
            }

            setImportResult(data?.data || null)
            setStatusTone('success')

            if (!dryRun) {
                setStatusMessage(
                    `Import complete: ${data?.data?.inserted ?? 0} added, ${data?.data?.updated ?? 0} updated, `
                    + `${data?.data?.enriched ?? 0} patient record(s) enriched.`
                )
                await refreshForms(activeDomain)
            } else {
                setStatusMessage('Dry run complete — nothing was written.')
            }
        } catch (error) {
            setStatusMessage(error?.message || 'Failed to import forms')
            setStatusTone('error')
        } finally {
            setImportRunning(false)
        }
    }, [importText, importSource, importFile, activeDomain, getAdminAuthHeaders, refreshForms])

    const deleteForm = useCallback(async (row) => {
        if (typeof window !== 'undefined' && !window.confirm('Delete this form submission? This cannot be undone.')) {
            return
        }

        try {
            const headers = await getAdminAuthHeaders()
            const query = new URLSearchParams({ domain: activeDomain })
            const response = await fetchWithTimeout(`/api/database/forms/${row.id}?${query.toString()}`, {
                method: 'DELETE',
                headers,
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to delete form')
            }
            await refreshForms(activeDomain)
            setStatusMessage('Form submission deleted.')
            setStatusTone('success')
        } catch (error) {
            setStatusMessage(error?.message || 'Failed to delete form')
            setStatusTone('error')
        }
    }, [activeDomain, getAdminAuthHeaders, refreshForms])

    const openPatient = (row) => {
        const patientId = String(row?.patient_id || '').trim()
        if (!patientId) return
        router.push(`/admin/patients?patientId=${encodeURIComponent(patientId)}&tab=forms`)
    }

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-sm text-gray-600">Loading forms...</div>
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
            <AdminHeader title="Forms" brandingDomainKey={activeDomain} />

            <main className="mx-auto max-w-7xl px-4 py-8 space-y-6">
                <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Forms</h1>
                            <p className="mt-1 text-sm text-gray-600">
                                Submitted intake forms, whether filled in through the native intake form or imported from the
                                practice management system. Either way the matching patient&apos;s Intake Data is filled with
                                any answers it does not already have.
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
                                onClick={() => router.push('/admin/intake')}
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50"
                            >
                                Intake settings
                            </button>
                            <button
                                type="button"
                                onClick={() => refreshForms(activeDomain)}
                                disabled={loadingForms}
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {loadingForms ? 'Refreshing...' : 'Refresh'}
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
                                        <h2 className="text-sm font-semibold text-gray-900">Import forms</h2>
                                        <p className="mt-1 text-xs text-gray-500">
                                            Upload a CSV export from the practice management system. Rows are matched on the
                                            external form ID, so re-importing the same file only touches records that
                                            changed. Start with a dry run to preview the changes.
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
                                                    <li>Linked to a patient: {importResult.linked}</li>
                                                    <li>Patient records enriched: {importResult.enriched}</li>
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

                    {!formsEnabled && (
                        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                            Forms are disabled. Enable Patients and either the Forms or Docs card in
                            Domain Settings first.
                        </p>
                    )}
                </section>

                <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
                    <SummaryTile label="Total" value={summary.total} />
                    <SummaryTile label="Linked patients" value={summary.linked} />
                    <SummaryTile label="Unlinked" value={summary.unlinked} tone={summary.unlinked > 0 ? 'warning' : 'neutral'} />
                    <SummaryTile label="Archived" value={summary.archived} />
                </section>

                <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h2 className="text-base font-semibold text-gray-900">All Forms</h2>
                            <p className="mt-1 text-xs text-gray-500">
                                Showing {filteredRows.length} of {forms.length} loaded submissions.
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(event) => setSearchQuery(event.target.value)}
                                className="w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm"
                                placeholder="Filter by patient, form title or ID"
                            />
                            <label className="flex items-center gap-2 text-sm text-gray-700">
                                <input
                                    type="checkbox"
                                    checked={includeArchived}
                                    onChange={(event) => {
                                        const next = event.target.checked
                                        includeArchivedRef.current = next
                                        setIncludeArchived(next)
                                        refreshForms(activeDomain)
                                    }}
                                    className="h-4 w-4"
                                />
                                Include archived
                            </label>
                        </div>
                    </div>

                    <div className="mt-4 overflow-x-auto rounded-md border border-gray-200">
                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Submitted</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Patient</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Form</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Answers</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">External ID</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 bg-white">
                                {filteredRows.map((row) => {
                                    const isExpanded = String(expandedFormId) === String(row.id)
                                    const sections = isExpanded ? buildFormSections(row) : []
                                    return (
                                        <Fragment key={row.id}>
                                            <tr>
                                                <td className="px-3 py-2 text-gray-700">
                                                    {formatFormDateTime(row.submitted_at) || '—'}
                                                    {row.archived === true && (
                                                        <span className="block text-xs text-amber-700">Archived</span>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2 font-medium text-gray-900">
                                                    {row.linked_patient_name || row.patient_name || '—'}
                                                    {row.patient_id ? (
                                                        <span className="block text-xs text-emerald-700">Linked</span>
                                                    ) : row.patient_name ? (
                                                        <span className="block text-xs text-gray-400">Not linked</span>
                                                    ) : null}
                                                </td>
                                                <td className="px-3 py-2 text-gray-700">
                                                    {row.title || '—'}
                                                    <span className="block text-xs text-gray-500">{row.submitted_message || ''}</span>
                                                </td>
                                                <td className="px-3 py-2 text-gray-700">
                                                    <button
                                                        type="button"
                                                        onClick={() => setExpandedFormId(isExpanded ? null : row.id)}
                                                        className="text-xs font-medium text-gray-700 underline decoration-gray-300 underline-offset-2 hover:text-gray-900"
                                                    >
                                                        {isExpanded ? 'Hide' : 'View'} {Object.keys(row.answers || {}).length} mapped answer(s)
                                                    </button>
                                                    <span className="block text-xs text-gray-500">{describeFormSummary(row)}</span>
                                                </td>
                                                <td className="px-3 py-2 text-xs text-gray-500">
                                                    {row.external_id || '—'}
                                                    <span className="block text-gray-400">{row.external_source}</span>
                                                </td>
                                                <td className="px-3 py-2">
                                                    <div className="flex items-center gap-2">
                                                        {row.patient_id ? (
                                                            <button
                                                                type="button"
                                                                onClick={() => openPatient(row)}
                                                                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                                            >
                                                                Open patient
                                                            </button>
                                                        ) : null}
                                                        <button
                                                            type="button"
                                                            onClick={() => deleteForm(row)}
                                                            className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                                                        >
                                                            Delete
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>

                                            {isExpanded && (
                                                <tr>
                                                    <td colSpan={6} className="bg-gray-50 px-3 py-4">
                                                        {sections.length === 0 ? (
                                                            <p className="text-xs text-gray-500">
                                                                This submission has no readable answers.
                                                            </p>
                                                        ) : (
                                                            <div className="space-y-4">
                                                                {sections.map((section) => (
                                                                    <div key={section.name}>
                                                                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                                                            {section.name}
                                                                        </p>
                                                                        <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-2">
                                                                            {section.entries.map((entry) => (
                                                                                <div key={entry.key}>
                                                                                    <dt className="text-xs font-medium text-gray-600">
                                                                                        {entry.question}
                                                                                        {entry.matched && (
                                                                                            <span className="ml-2 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                                                                                                Intake
                                                                                            </span>
                                                                                        )}
                                                                                    </dt>
                                                                                    <dd className="mt-0.5 whitespace-pre-wrap text-xs text-gray-800">
                                                                                        {entry.answer || '—'}
                                                                                    </dd>
                                                                                </div>
                                                                            ))}
                                                                        </dl>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            )}
                                        </Fragment>
                                    )
                                })}

                                {!loadingForms && filteredRows.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="px-3 py-5 text-center text-gray-500">
                                            No forms found. Use the ⋮ menu above to import a CSV export.
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

export default function FormsPage() {
    return (
        <Suspense>
            <FormsPageContent />
        </Suspense>
    )
}
