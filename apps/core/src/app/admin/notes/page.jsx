'use client'

import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MoreVertical } from 'lucide-react'
import AdminHeader from '@/admin-ui/components/AdminHeader'
import NoteBody from '@/admin-ui/components/NoteBody'
import { getCurrentUser, getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import { DEFAULT_DOMAIN_MODE, getEffectiveDomainMode } from '@/lib/domainMode'
import { DEFAULT_EXTERNAL_SOURCE, parseNoteCsv } from '@/lib/notes'
import { buildNoteMetrics, describeNoteSummary, formatNoteDateTime, notePreview, noteWordCount } from '@/lib/noteDisplay'
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

function NotesPageContent() {
    const router = useRouter()

    const [loading, setLoading] = useState(true)
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [activeDomain, setActiveDomain] = useState(DEFAULT_DOMAIN_MODE)
    const [notesEnabled, setNotesEnabled] = useState(false)

    const [notes, setNotes] = useState([])
    const [loadingNotes, setLoadingNotes] = useState(false)
    const [statusMessage, setStatusMessage] = useState('')
    const [statusTone, setStatusTone] = useState('neutral')

    const [searchQuery, setSearchQuery] = useState('')
    const [draftsOnly, setDraftsOnly] = useState(false)
    const [expandedNoteId, setExpandedNoteId] = useState(null)

    // Kept in a ref so `refreshNotes` stays stable and the checkbox can trigger
    // a refetch with the freshly toggled value.
    const draftsOnlyRef = useRef(false)

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

    const refreshNotes = useCallback(async (domain) => {
        if (!domain) return

        setLoadingNotes(true)
        try {
            const query = new URLSearchParams({ domain, limit: PAGE_LIMIT })
            if (draftsOnlyRef.current) query.set('draft', '1')

            const headers = await getAdminAuthHeaders()
            const response = await fetchWithTimeout(`/api/database/notes?${query.toString()}`, {
                headers,
                cache: 'no-store',
            })
            const data = await response.json().catch(() => ({}))

            if (!response.ok) {
                throw new Error(data?.error || 'Failed to load notes')
            }

            setNotes(Array.isArray(data?.data) ? data.data : [])
        } catch (error) {
            setNotes([])
            setStatusMessage(error?.message || 'Failed to load notes')
            setStatusTone('error')
        } finally {
            setLoadingNotes(false)
        }
    }, [getAdminAuthHeaders])

    const loadDomainFeatureState = useCallback(async (token, domain) => {
        if (!token || !domain) {
            return { notesEnabled: false }
        }

        try {
            const response = await fetchWithTimeout('/api/settings/domains', {
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store',
            })
            const data = await response.json().catch(() => ({}))
            const domainSettings = data?.domains?.[domain] || {}
            return {
                notesEnabled: domainSettings?.patientsEnabled === true
                    && domainSettings?.notesCardEnabled !== false,
            }
        } catch {
            return { notesEnabled: false }
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
                setNotesEnabled(domainFeatureState.notesEnabled)
                setIsAuthenticated(true)
                await refreshNotes(effectiveDomain)
            } catch (error) {
                if (cancelled) return
                setStatusMessage(error?.message || 'Failed to initialize notes view')
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
    }, [router, loadDomainFeatureState, refreshNotes])

    const summary = useMemo(() => buildNoteMetrics(notes), [notes])

    const filteredRows = useMemo(() => {
        const query = String(searchQuery || '').trim().toLowerCase()
        if (!query) return notes

        return notes.filter((row) => {
            const haystack = [
                row?.patient_name,
                row?.linked_patient_name,
                row?.title,
                row?.practitioner_name,
                row?.content_text,
                row?.external_id,
                row?.external_patient_id,
            ]
                .map((value) => String(value || '').toLowerCase())
                .join(' ')

            return haystack.includes(query)
        })
    }, [notes, searchQuery])

    const importPreview = useMemo(() => {
        if (!importText) return null
        try {
            const parsed = parseNoteCsv(importText)
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
            const response = await fetchWithTimeout('/api/database/notes/import', {
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
                throw new Error(data?.error || 'Failed to import notes')
            }

            setImportResult(data?.data || null)
            setStatusTone('success')

            if (!dryRun) {
                setStatusMessage(
                    `Import complete: ${data?.data?.inserted ?? 0} added, ${data?.data?.updated ?? 0} updated, `
                    + `${data?.data?.linked ?? 0} linked to a patient.`
                )
                await refreshNotes(activeDomain)
            } else {
                setStatusMessage('Dry run complete — nothing was written.')
            }
        } catch (error) {
            setStatusMessage(error?.message || 'Failed to import notes')
            setStatusTone('error')
        } finally {
            setImportRunning(false)
        }
    }, [importText, importSource, importFile, activeDomain, getAdminAuthHeaders, refreshNotes])

    const deleteNote = useCallback(async (row) => {
        if (typeof window !== 'undefined' && !window.confirm('Delete this note? This cannot be undone.')) {
            return
        }

        try {
            const headers = await getAdminAuthHeaders()
            const query = new URLSearchParams({ domain: activeDomain })
            const response = await fetchWithTimeout(`/api/database/notes/${row.id}?${query.toString()}`, {
                method: 'DELETE',
                headers,
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to delete note')
            }
            await refreshNotes(activeDomain)
            setStatusMessage('Note deleted.')
            setStatusTone('success')
        } catch (error) {
            setStatusMessage(error?.message || 'Failed to delete note')
            setStatusTone('error')
        }
    }, [activeDomain, getAdminAuthHeaders, refreshNotes])

    const openPatient = (row) => {
        const patientId = String(row?.patient_id || '').trim()
        if (!patientId) return
        router.push(`/admin/patients?patientId=${encodeURIComponent(patientId)}&tab=notes`)
    }

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-sm text-gray-600">Loading notes...</div>
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
            <AdminHeader title="Notes" brandingDomainKey={activeDomain} />

            <main className="mx-auto max-w-7xl px-4 py-8 space-y-6">
                <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Notes</h1>
                            <p className="mt-1 text-sm text-gray-600">
                                Patient notes: notes written in the app, plus notes imported from the practice
                                management system. Notes are linked to the matching patient so they appear on that
                                patient&apos;s record.
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
                                onClick={() => refreshNotes(activeDomain)}
                                disabled={loadingNotes}
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {loadingNotes ? 'Refreshing...' : 'Refresh'}
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
                                        <h2 className="text-sm font-semibold text-gray-900">Import notes</h2>
                                        <p className="mt-1 text-xs text-gray-500">
                                            Upload a CSV export from the practice management system. Rows are matched on the
                                            external note ID, so re-importing the same file only touches records that
                                            changed. An optional &quot;Created At&quot; column is kept as the note&apos;s
                                            creation date. Start with a dry run to preview the changes.
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
                                                                {importPreview.firstRow.title || 'untitled'} ·{' '}
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

                    {!notesEnabled && (
                        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                            Notes are disabled. Enable Patients and the Notes card in
                            Domain Settings first.
                        </p>
                    )}
                </section>

                <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
                    <SummaryTile label="Total" value={summary.total} />
                    <SummaryTile label="Linked patients" value={summary.linked} />
                    <SummaryTile label="Unlinked" value={summary.unlinked} tone={summary.unlinked > 0 ? 'warning' : 'neutral'} />
                    <SummaryTile label="Drafts" value={summary.drafts} />
                </section>

                <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h2 className="text-base font-semibold text-gray-900">All Notes</h2>
                            <p className="mt-1 text-xs text-gray-500">
                                Showing {filteredRows.length} of {notes.length} loaded notes.
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(event) => setSearchQuery(event.target.value)}
                                className="w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm"
                                placeholder="Filter by patient, title or note text"
                            />
                            <label className="flex items-center gap-2 text-sm text-gray-700">
                                <input
                                    type="checkbox"
                                    checked={draftsOnly}
                                    onChange={(event) => {
                                        const next = event.target.checked
                                        draftsOnlyRef.current = next
                                        setDraftsOnly(next)
                                        refreshNotes(activeDomain)
                                    }}
                                    className="h-4 w-4"
                                />
                                Drafts only
                            </label>
                        </div>
                    </div>

                    <div className="mt-4 overflow-x-auto rounded-md border border-gray-200">
                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Patient</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Note</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Words</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Practitioner</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">External ID</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 bg-white">
                                {filteredRows.map((row) => {
                                    const isExpanded = String(expandedNoteId) === String(row.id)
                                    return (
                                        <Fragment key={row.id}>
                                            <tr>
                                                <td className="px-3 py-2 font-medium text-gray-900">
                                                    {row.linked_patient_name || row.patient_name || '—'}
                                                    {row.patient_id ? (
                                                        <span className="block text-xs text-emerald-700">Linked</span>
                                                    ) : row.patient_name ? (
                                                        <span className="block text-xs text-gray-400">Not linked</span>
                                                    ) : null}
                                                </td>
                                                <td className="px-3 py-2 text-gray-700">
                                                    <span className="font-medium text-gray-900">{row.title || 'Untitled note'}</span>
                                                    {row.draft === true && (
                                                        <span className="ml-2 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                                                            Draft
                                                        </span>
                                                    )}
                                                    <span className="block max-w-md truncate text-xs text-gray-500">
                                                        {notePreview(row) || 'No body'}
                                                    </span>
                                                    <span className="block text-[11px] text-gray-400">
                                                        Updated {formatNoteDateTime(row.updated_at) || 'unknown'}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-2 text-gray-700">{noteWordCount(row)}</td>
                                                <td className="px-3 py-2 text-gray-700">
                                                    {row.practitioner_name || '—'}
                                                    {row.external_appointment_id ? (
                                                        <span className="block text-xs text-gray-500">
                                                            Appt {row.external_appointment_id}
                                                        </span>
                                                    ) : null}
                                                </td>
                                                <td className="px-3 py-2 text-xs text-gray-500">
                                                    {row.external_id || '—'}
                                                    <span className="block text-gray-400">{row.external_source}</span>
                                                </td>
                                                <td className="px-3 py-2">
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => setExpandedNoteId(isExpanded ? null : row.id)}
                                                            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                                        >
                                                            {isExpanded ? 'Hide note' : 'View note'}
                                                        </button>
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
                                                            onClick={() => deleteNote(row)}
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
                                                        <NoteBody content={row.content} className="max-w-3xl" />
                                                        <p className="mt-3 text-[11px] text-gray-400">
                                                            {describeNoteSummary(row)}
                                                        </p>
                                                    </td>
                                                </tr>
                                            )}
                                        </Fragment>
                                    )
                                })}

                                {!loadingNotes && filteredRows.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="px-3 py-5 text-center text-gray-500">
                                            No notes found. Use the ⋮ menu above to import a CSV export.
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

export default function NotesPage() {
    return (
        <Suspense>
            <NotesPageContent />
        </Suspense>
    )
}
