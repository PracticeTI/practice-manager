'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BookOpen, ExternalLink, FileText, Link2, Plus, Settings2, Trash2 } from 'lucide-react'
import AdminHeader from '@/admin-ui/components/AdminHeader'
import FunderLibrary from '@/admin-ui/components/FunderLibrary'
import { getCurrentUser, getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import { DEFAULT_DOMAIN_MODE, getEffectiveDomainMode } from '@/lib/domainMode'
import {
    FUNDER_DOCUMENT_CATEGORIES,
    FUNDER_DOCUMENT_TYPES,
    FUNDER_STATUSES,
    describeFunderDocument,
    groupFunderDocumentsByCategory,
    sortFunderDocuments,
} from '@/lib/funders'
import { getFunderLinkStatusLabel, isProblemLinkStatus } from '@/lib/funderLinkCheck'
import { readStoredDefaultDomain } from '@/lib/defaultDomainPreference'


const EMPTY_FUNDER_DRAFT = {
    name: '',
    full_name: '',
    description: '',
    jurisdiction: '',
    website_url: '',
    status: 'published',
}

const EMPTY_DOCUMENT_DRAFT = {
    title: '',
    url: '',
    category: 'pricing',
    doc_type: 'link',
    description: '',
    effective_period: '',
    is_primary: false,
    status: 'published',
}

/** Copy the editable fields off a funder record into the form draft. */
function buildFunderDraft(funder) {
    if (!funder) return { ...EMPTY_FUNDER_DRAFT }
    return {
        name: funder.name || '',
        full_name: funder.full_name || '',
        description: funder.description || '',
        jurisdiction: funder.jurisdiction || '',
        website_url: funder.website_url || '',
        status: funder.status || 'published',
    }
}

const INPUT_CLASS = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400'
const LABEL_CLASS = 'block text-xs font-semibold uppercase tracking-wide text-gray-500'
const PRIMARY_BUTTON_CLASS = 'rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60'
const SECONDARY_BUTTON_CLASS = 'rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60'

function StatusPill({ status }) {
    const tone = status === 'published'
        ? 'border-green-200 bg-green-50 text-green-700'
        : status === 'archived'
            ? 'border-red-200 bg-red-50 text-red-700'
            : 'border-amber-200 bg-amber-50 text-amber-800'

    return (
        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${tone}`}>
            {status || 'draft'}
        </span>
    )
}

function FunderDocumentRow({ document, onEdit, onDelete, busy }) {
    const linkProblem = isProblemLinkStatus(document.link_status)

    return (
        <li className="flex items-start justify-between gap-4 rounded-md border border-gray-200 bg-white px-3 py-2">
            <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-900">{document.title}</span>
                    {document.is_primary && (
                        <span className="inline-flex rounded-full border border-gray-900 bg-gray-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                            Primary
                        </span>
                    )}
                    <StatusPill status={document.status} />
                    {linkProblem && (
                        <span
                            className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${document.link_status === 'blocked' ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-red-300 bg-red-50 text-red-700'}`}
                            title={`Last link check: ${getFunderLinkStatusLabel(document.link_status)}${document.http_status ? ` (HTTP ${document.http_status})` : ''}${document.link_checked_at ? ` on ${document.link_checked_at.slice(0, 10)}` : ''}`}
                        >
                            Link {getFunderLinkStatusLabel(document.link_status)}
                        </span>
                    )}
                </div>
                <p className="mt-0.5 text-xs text-gray-500">{describeFunderDocument(document)}</p>
                {document.url ? (
                    <a
                        href={document.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-xs text-blue-700 hover:underline break-all"
                    >
                        <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                        {document.url}
                    </a>
                ) : (
                    <p className="mt-1 text-xs italic text-gray-400">No link — internal note</p>
                )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
                <button
                    type="button"
                    onClick={() => onEdit(document)}
                    disabled={busy}
                    className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-60"
                >
                    Edit
                </button>
                <button
                    type="button"
                    onClick={() => onDelete(document)}
                    disabled={busy}
                    className="rounded-md border border-red-200 bg-white p-1.5 text-red-600 hover:bg-red-50 disabled:opacity-60"
                    aria-label={`Delete ${document.title}`}
                >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
            </div>
        </li>
    )
}

function FundersPageContent() {
    const router = useRouter()

    const [loading, setLoading] = useState(true)
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [activeDomain, setActiveDomain] = useState(DEFAULT_DOMAIN_MODE)
    // Domain admins get the read-only library; only a superadmin can switch to the
    // editing view (the API enforces the same rule, so hiding the UI is cosmetic).
    const [isSuperAdminUser, setIsSuperAdminUser] = useState(false)
    const [manageMode, setManageMode] = useState(false)

    const [funders, setFunders] = useState([])
    const [selectedFunderKey, setSelectedFunderKey] = useState('')
    const [funderDraft, setFunderDraft] = useState(EMPTY_FUNDER_DRAFT)
    const [creatingFunder, setCreatingFunder] = useState(false)

    const [documentDraft, setDocumentDraft] = useState({ ...EMPTY_DOCUMENT_DRAFT })
    const [editingDocumentId, setEditingDocumentId] = useState(null)
    const [documentFormOpen, setDocumentFormOpen] = useState(false)

    const [busy, setBusy] = useState(false)
    const [statusMessage, setStatusMessage] = useState('')
    const [statusTone, setStatusTone] = useState('neutral')

    const getAdminAuthHeaders = useCallback(async () => {
        const token = await getOrCreateAdminTokenForLocalhost()
        if (!token) throw new Error('Missing admin session token')
        return { Authorization: `Bearer ${token}` }
    }, [])

    const reportError = useCallback((message, tone = 'error') => {
        setStatusMessage(message)
        setStatusTone(tone)
    }, [])

    const selectedFunder = useMemo(
        () => funders.find((funder) => funder.key === selectedFunderKey) || null,
        [funders, selectedFunderKey]
    )

    const selectedDocuments = useMemo(
        () => sortFunderDocuments(selectedFunder?.documents || []),
        [selectedFunder]
    )

    const groupedDocuments = useMemo(
        () => groupFunderDocumentsByCategory(selectedDocuments),
        [selectedDocuments]
    )

    const loadFunders = useCallback(async (preferredKey = '') => {
        const headers = await getAdminAuthHeaders()
        const response = await fetch('/api/funders', { headers, cache: 'no-store' })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data?.error || 'Failed to load funders')

        const nextFunders = Array.isArray(data?.funders) ? data.funders : []
        setFunders(nextFunders)

        const explicit = String(preferredKey || '').trim().toLowerCase()
        const fallback = nextFunders[0]?.key || ''
        const chosenKey = explicit && nextFunders.some((funder) => funder.key === explicit) ? explicit : fallback
        setSelectedFunderKey(chosenKey)
        setFunderDraft(buildFunderDraft(nextFunders.find((funder) => funder.key === chosenKey)))
    }, [getAdminAuthHeaders])

    useEffect(() => {
        let cancelled = false

        async function bootstrap() {
            try {
                const token = await getOrCreateAdminTokenForLocalhost()
                if (cancelled) return
                if (!token || !getCurrentUser()) {
                    router.push('/login')
                    return
                }

                const hostname = typeof window !== 'undefined' ? window.location.hostname : ''
                const storedDomain = readStoredDefaultDomain()
                const { mode } = getEffectiveDomainMode(hostname, storedDomain)
                const currentUser = getCurrentUser()
                const userDomain = String(currentUser?.domain || '').trim().toLowerCase()

                // The dashboard Funders card and the practice search deep-link straight
                // to one funder, e.g. /admin/funders?funder=ndis.
                const requestedFunder = typeof window !== 'undefined'
                    ? new URLSearchParams(window.location.search).get('funder') || ''
                    : ''

                setActiveDomain(userDomain || mode)
                setManageMode(false)
                setIsSuperAdminUser(String(currentUser?.role || '').toLowerCase() === 'superadmin')
                await loadFunders(requestedFunder)
                if (cancelled) return
                setIsAuthenticated(true)
            } catch (error) {
                if (cancelled) return
                reportError(error?.message || 'Failed to load funders')
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        bootstrap()
        return () => {
            cancelled = true
        }
    }, [router, loadFunders, reportError])

    // The editable form is refreshed from the record whenever the selection
    // changes, so switching funders never shows the previous funder's text. This
    // is done in the handlers (not an effect) to keep the repo's lint rule that
    // forbids synchronous setState inside an effect body.
    const selectFunder = (funderKey) => {
        const funder = funders.find((entry) => entry.key === funderKey) || null
        setSelectedFunderKey(funderKey)
        setCreatingFunder(false)
        setFunderDraft(buildFunderDraft(funder))
        setDocumentFormOpen(false)
        setEditingDocumentId(null)
        setDocumentDraft({ ...EMPTY_DOCUMENT_DRAFT })
        setStatusMessage('')
    }

    const upsertFunder = (funder) => {
        setFunders((current) => {
            const exists = current.some((entry) => entry.id === funder.id)
            if (!exists) return [...current, funder].sort((a, b) => String(a.name).localeCompare(String(b.name)))
            return current.map((entry) => (entry.id === funder.id ? funder : entry))
        })
    }

    const handleSaveFunder = async () => {
        if (!selectedFunder && !creatingFunder) return
        setBusy(true)
        setStatusMessage('')

        try {
            const headers = await getAdminAuthHeaders()
            const creating = !selectedFunder
            const url = creating ? '/api/funders' : `/api/funders/${selectedFunder.id}`
            const response = await fetch(url, {
                method: creating ? 'POST' : 'PATCH',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify(funderDraft),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data?.error || 'Failed to save funder')

            upsertFunder(data.funder)
            setSelectedFunderKey(data.funder.key)
            setCreatingFunder(false)
            setFunderDraft(buildFunderDraft(data.funder))
            reportError(creating ? 'Funder created.' : 'Funder saved.', 'success')
        } catch (error) {
            reportError(error?.message || 'Failed to save funder')
        } finally {
            setBusy(false)
        }
    }

    const handleDeleteFunder = async () => {
        if (!selectedFunder) return
        const confirmed = typeof window === 'undefined'
            ? false
            : window.confirm(`Delete the ${selectedFunder.name} funder and all of its documents?`)
        if (!confirmed) return

        setBusy(true)
        setStatusMessage('')
        try {
            const headers = await getAdminAuthHeaders()
            const response = await fetch(`/api/funders/${selectedFunder.id}`, { method: 'DELETE', headers })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data?.error || 'Failed to delete funder')

            const remaining = funders.filter((entry) => entry.id !== selectedFunder.id)
            const nextFunder = remaining[0] || null
            setFunders(remaining)
            setSelectedFunderKey(nextFunder?.key || '')
            setFunderDraft(buildFunderDraft(nextFunder))
            setCreatingFunder(false)
            reportError('Funder deleted.', 'success')
        } catch (error) {
            reportError(error?.message || 'Failed to delete funder')
        } finally {
            setBusy(false)
        }
    }

    const openDocumentForm = (document = null) => {
        setEditingDocumentId(document?.id ?? null)
        setDocumentDraft(document
            ? {
                title: document.title || '',
                url: document.url || '',
                category: document.category || 'reference',
                doc_type: document.doc_type || 'link',
                description: document.description || '',
                effective_period: document.effective_period || '',
                is_primary: Boolean(document.is_primary),
                status: document.status || 'published',
            }
            : { ...EMPTY_DOCUMENT_DRAFT })
        setDocumentFormOpen(true)
        setStatusMessage('')
    }

    const mergeDocumentIntoFunder = (document) => {
        setFunders((current) => current.map((funder) => {
            if (funder.id !== document.funder_id) return funder
            const exists = (funder.documents || []).some((entry) => entry.id === document.id)
            const documents = exists
                ? funder.documents.map((entry) => (entry.id === document.id ? document : entry))
                : [...(funder.documents || []), document]
            // A document just promoted to primary demotes the others locally too.
            const reconciled = document.is_primary
                ? documents.map((entry) => (entry.id === document.id ? entry : { ...entry, is_primary: false }))
                : documents
            return { ...funder, documents: sortFunderDocuments(reconciled) }
        }))
    }

    const handleSaveDocument = async () => {
        if (!selectedFunder) return
        setBusy(true)
        setStatusMessage('')

        try {
            const headers = await getAdminAuthHeaders()
            const editing = Boolean(editingDocumentId)
            const url = editing
                ? `/api/funders/${selectedFunder.id}/documents/${editingDocumentId}`
                : `/api/funders/${selectedFunder.id}/documents`
            const response = await fetch(url, {
                method: editing ? 'PATCH' : 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify(documentDraft),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data?.error || 'Failed to save document')

            mergeDocumentIntoFunder(data.document)
            setDocumentFormOpen(false)
            setEditingDocumentId(null)
            setDocumentDraft({ ...EMPTY_DOCUMENT_DRAFT })
            reportError(editing ? 'Document updated.' : 'Document added.', 'success')
        } catch (error) {
            reportError(error?.message || 'Failed to save document')
        } finally {
            setBusy(false)
        }
    }

    const handleDeleteDocument = async (document) => {
        if (!selectedFunder || !document) return
        if (typeof window !== 'undefined' && !window.confirm(`Remove "${document.title}"?`)) return

        setBusy(true)
        setStatusMessage('')
        try {
            const headers = await getAdminAuthHeaders()
            const response = await fetch(`/api/funders/${selectedFunder.id}/documents/${document.id}`, {
                method: 'DELETE',
                headers,
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data?.error || 'Failed to delete document')

            setFunders((current) => current.map((funder) => {
                if (funder.id !== selectedFunder.id) return funder
                return { ...funder, documents: (funder.documents || []).filter((entry) => entry.id !== document.id) }
            }))
            reportError('Document removed.', 'success')
        } catch (error) {
            reportError(error?.message || 'Failed to delete document')
        } finally {
            setBusy(false)
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-sm text-gray-600">Loading funders...</div>
            </div>
        )
    }

    if (!isAuthenticated) return null

    const statusClasses =
        statusTone === 'success' ? 'bg-green-50 border-green-200 text-green-700' :
            statusTone === 'error' ? 'bg-red-50 border-red-200 text-red-700' :
                'bg-gray-50 border-gray-200 text-gray-600'

    const documentCount = selectedDocuments.length

    return (
        <div className="min-h-screen">
            <AdminHeader title="Funders" brandingDomainKey={activeDomain} />

            <main className="mx-auto max-w-7xl px-4 py-8 space-y-6">
                <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Funders</h1>
                            <p className="mt-1 text-sm text-gray-600">
                                A reference library of the funding bodies this practice reports against, and the published
                                documentation each one relies on. Read-only — the material is maintained centrally.
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <button type="button" onClick={() => router.push('/admin')} className={SECONDARY_BUTTON_CLASS}>
                                Back to Admin
                            </button>
                            {isSuperAdminUser && (
                                <button
                                    type="button"
                                    onClick={() => setManageMode((current) => !current)}
                                    className={SECONDARY_BUTTON_CLASS}
                                    title={manageMode ? 'Return to the read-only library' : 'Edit funders and their documents'}
                                >
                                    <span className="inline-flex items-center gap-1">
                                        {manageMode
                                            ? <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                                            : <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />}
                                        {manageMode ? 'Library view' : 'Manage'}
                                    </span>
                                </button>
                            )}
                            {isSuperAdminUser && manageMode && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setCreatingFunder(true)
                                        setSelectedFunderKey('')
                                        setFunderDraft({ ...EMPTY_FUNDER_DRAFT })
                                        setStatusMessage('')
                                    }}
                                    className={PRIMARY_BUTTON_CLASS}
                                >
                                    <span className="inline-flex items-center gap-1">
                                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                                        Add funder
                                    </span>
                                </button>
                            )}
                        </div>
                    </div>
                    {statusMessage && (
                        <p className={`mt-4 rounded-md border px-3 py-2 text-sm ${statusClasses}`}>{statusMessage}</p>
                    )}
                </section>

                {isSuperAdminUser && manageMode ? (
                    <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
                        <aside className="space-y-2">
                            {/* Funders (NDIS is seeded on first use) */}
                            {funders.map((funder) => {
                                const isActive = !creatingFunder && funder.key === selectedFunderKey
                                return (
                                    <button
                                        key={funder.key}
                                        type="button"
                                        onClick={() => selectFunder(funder.key)}
                                        className={`w-full rounded-lg border px-4 py-3 text-left transition-colors ${isActive ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
                                    >
                                        <span className="flex items-center justify-between gap-2">
                                            <span className="font-semibold">{funder.name}</span>
                                            <span className={`text-xs ${isActive ? 'text-gray-300' : 'text-gray-500'}`}>
                                                {(funder.documents || []).length} docs
                                            </span>
                                        </span>
                                        {funder.full_name && (
                                            <span className={`mt-0.5 block text-xs ${isActive ? 'text-gray-300' : 'text-gray-500'}`}>
                                                {funder.full_name}
                                            </span>
                                        )}
                                    </button>
                                )
                            })}
                            {funders.length === 0 && !creatingFunder && (
                                <p className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500">
                                    No funders yet. Add one to start collecting its documentation.
                                </p>
                            )}
                        </aside>

                        <section className="space-y-6">
                            {(selectedFunder || creatingFunder) && (
                                <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <h2 className="text-lg font-semibold text-gray-900">
                                            {creatingFunder ? 'New funder' : selectedFunder?.name}
                                        </h2>
                                        <div className="flex items-center gap-2">
                                            {!creatingFunder && <StatusPill status={selectedFunder?.status} />}
                                            {!creatingFunder && (
                                                <button
                                                    type="button"
                                                    onClick={handleDeleteFunder}
                                                    disabled={busy}
                                                    className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
                                                >
                                                    Delete
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                                        <label className="space-y-1">
                                            <span className={LABEL_CLASS}>Name</span>
                                            <input
                                                className={INPUT_CLASS}
                                                value={funderDraft.name}
                                                onChange={(event) => setFunderDraft((draft) => ({ ...draft, name: event.target.value }))}
                                                placeholder="NDIS"
                                            />
                                        </label>
                                        <label className="space-y-1">
                                            <span className={LABEL_CLASS}>Full name</span>
                                            <input
                                                className={INPUT_CLASS}
                                                value={funderDraft.full_name}
                                                onChange={(event) => setFunderDraft((draft) => ({ ...draft, full_name: event.target.value }))}
                                                placeholder="National Disability Insurance Scheme"
                                            />
                                        </label>
                                        <label className="space-y-1">
                                            <span className={LABEL_CLASS}>Jurisdiction</span>
                                            <input
                                                className={INPUT_CLASS}
                                                value={funderDraft.jurisdiction}
                                                onChange={(event) => setFunderDraft((draft) => ({ ...draft, jurisdiction: event.target.value }))}
                                                placeholder="Australia"
                                            />
                                        </label>
                                        <label className="space-y-1">
                                            <span className={LABEL_CLASS}>Website</span>
                                            <input
                                                className={INPUT_CLASS}
                                                value={funderDraft.website_url}
                                                onChange={(event) => setFunderDraft((draft) => ({ ...draft, website_url: event.target.value }))}
                                                placeholder="https://www.ndis.gov.au"
                                            />
                                        </label>
                                        <label className="space-y-1 sm:col-span-2">
                                            <span className={LABEL_CLASS}>Description</span>
                                            <textarea
                                                className={`${INPUT_CLASS} min-h-[80px]`}
                                                value={funderDraft.description}
                                                onChange={(event) => setFunderDraft((draft) => ({ ...draft, description: event.target.value }))}
                                                placeholder="How the practice works with this funder."
                                            />
                                        </label>
                                        <label className="space-y-1">
                                            <span className={LABEL_CLASS}>Status</span>
                                            <select
                                                className={INPUT_CLASS}
                                                value={funderDraft.status}
                                                onChange={(event) => setFunderDraft((draft) => ({ ...draft, status: event.target.value }))}
                                            >
                                                {FUNDER_STATUSES.map((status) => (
                                                    <option key={status} value={status}>{status}</option>
                                                ))}
                                            </select>
                                        </label>
                                    </div>

                                    <div className="mt-5 flex items-center gap-2">
                                        <button type="button" onClick={handleSaveFunder} disabled={busy} className={PRIMARY_BUTTON_CLASS}>
                                            {creatingFunder ? 'Create funder' : 'Save changes'}
                                        </button>
                                        {creatingFunder && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setCreatingFunder(false)
                                                    setSelectedFunderKey(funders[0]?.key || '')
                                                }}
                                                className={SECONDARY_BUTTON_CLASS}
                                            >
                                                Cancel
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}

                            {selectedFunder && (
                                <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <h2 className="text-lg font-semibold text-gray-900">Documentation</h2>
                                            <p className="mt-0.5 text-sm text-gray-600">
                                                {documentCount === 0
                                                    ? 'No documents yet.'
                                                    : `${documentCount} document${documentCount === 1 ? '' : 's'} linked for ${selectedFunder.name}.`}
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => openDocumentForm(null)}
                                            disabled={busy}
                                            className={PRIMARY_BUTTON_CLASS}
                                        >
                                            <span className="inline-flex items-center gap-1">
                                                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                                                Add document
                                            </span>
                                        </button>
                                    </div>

                                    {documentFormOpen && (
                                        <div className="mt-5 rounded-lg border border-gray-300 bg-gray-50 p-4">
                                            <h3 className="text-sm font-semibold text-gray-900">
                                                {editingDocumentId ? 'Edit document' : 'New document'}
                                            </h3>
                                            <div className="mt-3 grid gap-4 sm:grid-cols-2">
                                                <label className="space-y-1 sm:col-span-2">
                                                    <span className={LABEL_CLASS}>Title</span>
                                                    <input
                                                        className={INPUT_CLASS}
                                                        value={documentDraft.title}
                                                        onChange={(event) => setDocumentDraft((draft) => ({ ...draft, title: event.target.value }))}
                                                        placeholder="NDIS pricing schedule 2026-27"
                                                    />
                                                </label>
                                                <label className="space-y-1 sm:col-span-2">
                                                    <span className={LABEL_CLASS}>URL</span>
                                                    <input
                                                        className={INPUT_CLASS}
                                                        value={documentDraft.url}
                                                        onChange={(event) => setDocumentDraft((draft) => ({ ...draft, url: event.target.value }))}
                                                        placeholder="https://www.ndis.gov.au/..."
                                                    />
                                                </label>
                                                <label className="space-y-1">
                                                    <span className={LABEL_CLASS}>Category</span>
                                                    <select
                                                        className={INPUT_CLASS}
                                                        value={documentDraft.category}
                                                        onChange={(event) => setDocumentDraft((draft) => ({ ...draft, category: event.target.value }))}
                                                    >
                                                        {FUNDER_DOCUMENT_CATEGORIES.map((category) => (
                                                            <option key={category.value} value={category.value}>{category.label}</option>
                                                        ))}
                                                    </select>
                                                </label>
                                                <label className="space-y-1">
                                                    <span className={LABEL_CLASS}>Type</span>
                                                    <select
                                                        className={INPUT_CLASS}
                                                        value={documentDraft.doc_type}
                                                        onChange={(event) => setDocumentDraft((draft) => ({ ...draft, doc_type: event.target.value }))}
                                                    >
                                                        {FUNDER_DOCUMENT_TYPES.map((type) => (
                                                            <option key={type.value} value={type.value}>{type.label}</option>
                                                        ))}
                                                    </select>
                                                </label>
                                                <label className="space-y-1">
                                                    <span className={LABEL_CLASS}>Effective period</span>
                                                    <input
                                                        className={INPUT_CLASS}
                                                        value={documentDraft.effective_period}
                                                        onChange={(event) => setDocumentDraft((draft) => ({ ...draft, effective_period: event.target.value }))}
                                                        placeholder="2026-27"
                                                    />
                                                </label>
                                                <label className="space-y-1">
                                                    <span className={LABEL_CLASS}>Status</span>
                                                    <select
                                                        className={INPUT_CLASS}
                                                        value={documentDraft.status}
                                                        onChange={(event) => setDocumentDraft((draft) => ({ ...draft, status: event.target.value }))}
                                                    >
                                                        {FUNDER_STATUSES.map((status) => (
                                                            <option key={status} value={status}>{status}</option>
                                                        ))}
                                                    </select>
                                                </label>
                                                <label className="space-y-1 sm:col-span-2">
                                                    <span className={LABEL_CLASS}>Description</span>
                                                    <textarea
                                                        className={`${INPUT_CLASS} min-h-[70px]`}
                                                        value={documentDraft.description}
                                                        onChange={(event) => setDocumentDraft((draft) => ({ ...draft, description: event.target.value }))}
                                                    />
                                                </label>
                                                <label className="flex items-center gap-2 text-sm text-gray-700">
                                                    <input
                                                        type="checkbox"
                                                        checked={documentDraft.is_primary}
                                                        onChange={(event) => setDocumentDraft((draft) => ({ ...draft, is_primary: event.target.checked }))}
                                                    />
                                                    Mark as the primary reference
                                                </label>
                                            </div>
                                            <div className="mt-4 flex items-center gap-2">
                                                <button type="button" onClick={handleSaveDocument} disabled={busy} className={PRIMARY_BUTTON_CLASS}>
                                                    {editingDocumentId ? 'Save document' : 'Add document'}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setDocumentFormOpen(false)
                                                        setEditingDocumentId(null)
                                                        setDocumentDraft({ ...EMPTY_DOCUMENT_DRAFT })
                                                    }}
                                                    className={SECONDARY_BUTTON_CLASS}
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    <div className="mt-5 space-y-5">
                                        {groupedDocuments.map((group) => (
                                            <div key={group.category}>
                                                <h3 className="text-sm font-semibold text-gray-900">{group.label}</h3>
                                                <ul className="mt-2 space-y-2">
                                                    {group.documents.map((document) => (
                                                        <FunderDocumentRow
                                                            key={document.id}
                                                            document={document}
                                                            busy={busy}
                                                            onEdit={openDocumentForm}
                                                            onDelete={handleDeleteDocument}
                                                        />
                                                    ))}
                                                </ul>
                                            </div>
                                        ))}

                                        {documentCount === 0 && !documentFormOpen && (
                                            <p className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500">
                                                <FileText className="mx-auto mb-2 h-5 w-5 text-gray-400" aria-hidden="true" />
                                                Add the pricing schedules, support catalogue and policies this platform cites.
                                            </p>
                                        )}
                                    </div>
                                </div>
                            )}

                            {!selectedFunder && !creatingFunder && (
                                <div className="rounded-lg border border-dashed border-gray-300 px-6 py-10 text-center text-sm text-gray-500">
                                    <Link2 className="mx-auto mb-2 h-6 w-6 text-gray-400" aria-hidden="true" />
                                    Select a funder to see its documentation.
                                </div>
                            )}
                        </section>
                    </div>
                ) : (
                    <FunderLibrary
                        funders={funders}
                        selectedFunderKey={selectedFunderKey}
                        onSelectFunder={selectFunder}
                    />
                )}
            </main>
        </div>
    )
}

/**
 * `useSearchParams` is intentionally avoided here: the funder deep link is read
 * once during bootstrap, so the page renders without a Suspense boundary.
 */
export default function AdminFundersPage() {
    return <FundersPageContent />
}
