'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, Download, Files, FolderOpen, RefreshCw, Search, Trash2, Upload } from 'lucide-react'
import AdminHeader from '@/admin-ui/components/AdminHeader'
import { getCurrentUser, getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import { DEFAULT_DOMAIN_MODE, getEffectiveDomainMode } from '@/lib/domainMode'
import { isFilesPageFeatureEnabled } from '@/lib/domainFeatureFlags'
import { buildPatientFilesHref, describeFileOwner, formatFileSize } from '@/lib/fileDisplay'
import { readStoredDefaultDomain } from '@/lib/defaultDomainPreference'

const FILE_LIST_LIMIT = 200
const PATIENT_OPTION_LIMIT = 500

/**
 * The page shows one practice's whole file store. The filter is about *who owns the
 * file* rather than about a patient: patient files and practice-level files are both
 * files the practice uploaded, and the split exists to help find one.
 */
const FILE_SCOPES = [
    { key: 'all', label: 'All files' },
    { key: 'patient', label: 'Patient files' },
    { key: 'practice', label: 'Practice files' },
]

function authHeader(token) {
    return token ? { Authorization: 'Bearer ' + token } : undefined
}

function formatUploadedAt(isoString, now) {
    const timestamp = new Date(isoString || '').getTime()
    if (!Number.isFinite(timestamp)) return ''

    const diffMs = now - timestamp
    const minute = 60 * 1000
    const hour = 60 * minute
    const day = 24 * hour

    if (diffMs < minute) return 'Just now'
    if (diffMs < hour) return `${Math.max(1, Math.floor(diffMs / minute))} min ago`
    if (diffMs < day) return `${Math.max(1, Math.floor(diffMs / hour))} hr ago`
    return `${Math.max(1, Math.floor(diffMs / day))} d ago`
}

async function fetchFiles({ domainKey, scope, query }) {
    const token = window.localStorage.getItem('adminToken')
    const params = new URLSearchParams({
        domain: domainKey,
        scope,
        limit: String(FILE_LIST_LIMIT),
    })
    if (query) params.set('q', query)

    try {
        const response = await fetch(`/api/database/patient-files?${params.toString()}`, {
            cache: 'no-store',
            headers: authHeader(token),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || data?.success !== true) {
            return { error: String(data?.error || 'Failed to load files') }
        }
        return {
            files: Array.isArray(data?.data) ? data.data : [],
            storage: data?.storage || null,
        }
    } catch {
        return { error: 'Failed to load files' }
    }
}

export default function FilesAdminPage() {
    const router = useRouter()
    const fileInputRef = useRef(null)

    const [loading, setLoading] = useState(true)
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [activeDomain, setActiveDomain] = useState(DEFAULT_DOMAIN_MODE)
    const [files, setFiles] = useState([])
    const [storage, setStorage] = useState(null)
    const [patients, setPatients] = useState([])
    const [scope, setScope] = useState('all')
    const [queryDraft, setQueryDraft] = useState('')
    const [appliedQuery, setAppliedQuery] = useState('')
    const [error, setError] = useState('')
    const [statusMessage, setStatusMessage] = useState('')
    const [reloading, setReloading] = useState(false)
    const [uploading, setUploading] = useState(false)
    const [uploadPatientId, setUploadPatientId] = useState('')
    const [deletingId, setDeletingId] = useState(null)
    const [refreshTicker, setRefreshTicker] = useState(() => Date.now())

    useEffect(() => {
        const intervalId = window.setInterval(() => setRefreshTicker(Date.now()), 60 * 1000)
        return () => window.clearInterval(intervalId)
    }, [])

    const loadFiles = useCallback(async (domainKey, nextScope, nextQuery) => {
        const result = await fetchFiles({ domainKey, scope: nextScope, query: nextQuery })
        if (result.error) {
            setError(result.error)
            setFiles([])
            return
        }

        setError('')
        setFiles(result.files)
        setStorage(result.storage)
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
                const domainKey = String(user?.domain || '').trim().toLowerCase() || mode

                setActiveDomain(domainKey)

                const settingsResponse = await fetch('/api/settings/domains', {
                    headers: authHeader(token),
                    cache: 'no-store',
                })
                const settingsData = await settingsResponse.json().catch(() => ({}))
                if (cancelled) return

                const settings = settingsData?.domains?.[domainKey] || {}

                // Files is off for nearly every practice, so a direct visit falls back
                // to the dashboard instead of showing a page the domain cannot use.
                if (!isFilesPageFeatureEnabled(settings, domainKey)) {
                    router.replace('/admin')
                    return
                }

                setIsAuthenticated(true)
                await loadFiles(domainKey, 'all', '')

                const patientParams = new URLSearchParams({ domain: domainKey, limit: String(PATIENT_OPTION_LIMIT) })
                const patientsResponse = await fetch(`/api/database/patients?${patientParams.toString()}`, {
                    cache: 'no-store',
                    headers: authHeader(token),
                })
                const patientsData = await patientsResponse.json().catch(() => ({}))
                if (!cancelled && patientsResponse.ok && patientsData?.success === true) {
                    setPatients(Array.isArray(patientsData.data) ? patientsData.data : [])
                }
            } catch {
                if (!cancelled) router.replace('/admin')
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        bootstrap()
        return () => {
            cancelled = true
        }
    }, [loadFiles, router])

    const requestFiles = useCallback(async (nextScope = scope, nextQuery = appliedQuery, { clearStatus = true } = {}) => {
        setReloading(true)
        if (clearStatus) setStatusMessage('')
        try {
            await loadFiles(activeDomain, nextScope, nextQuery)
            setRefreshTicker(Date.now())
        } finally {
            setReloading(false)
        }
    }, [activeDomain, appliedQuery, loadFiles, scope])

    const handleScopeChange = (nextScope) => {
        setScope(nextScope)
        requestFiles(nextScope, appliedQuery)
    }

    const handleSearch = (event) => {
        event.preventDefault()
        const nextQuery = queryDraft.trim()
        setAppliedQuery(nextQuery)
        requestFiles(scope, nextQuery)
    }

    const handleUpload = async (event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return

        setUploading(true)
        setError('')
        setStatusMessage('')
        try {
            const token = window.localStorage.getItem('adminToken')
            const formData = new FormData()
            formData.set('domain', activeDomain)
            if (uploadPatientId) formData.set('patient_id', uploadPatientId)
            formData.set('file', file)

            const response = await fetch('/api/database/patient-files', {
                method: 'POST',
                headers: authHeader(token),
                body: formData,
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok || data?.success !== true) {
                throw new Error(data?.error || 'Failed to upload file')
            }

            setStatusMessage(`${data?.file?.file_name || file.name} uploaded.`)
            await requestFiles(scope, appliedQuery, { clearStatus: false })
        } catch (uploadError) {
            setError(uploadError?.message || 'Failed to upload file')
        } finally {
            setUploading(false)
        }
    }

    const handleDownload = async (row) => {
        setError('')
        try {
            const token = window.localStorage.getItem('adminToken')
            const params = new URLSearchParams({ domain: activeDomain })
            const response = await fetch(
                `/api/database/patient-files/${encodeURIComponent(row.id)}?${params.toString()}`,
                { headers: authHeader(token) }
            )
            if (!response.ok) {
                const data = await response.json().catch(() => ({}))
                throw new Error(data?.error || 'Failed to download file')
            }

            const blob = await response.blob()
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url
            anchor.download = String(row.file_name || 'download')
            anchor.click()
            URL.revokeObjectURL(url)
        } catch (downloadError) {
            setError(downloadError?.message || 'Failed to download file')
        }
    }

    const handleDelete = async (row) => {
        if (!window.confirm(`Delete ${row.file_name || 'this file'}?`)) return

        setDeletingId(row.id)
        setError('')
        setStatusMessage('')
        try {
            const token = window.localStorage.getItem('adminToken')
            const params = new URLSearchParams({ domain: activeDomain })
            const response = await fetch(
                `/api/database/patient-files/${encodeURIComponent(row.id)}?${params.toString()}`,
                { method: 'DELETE', headers: authHeader(token) }
            )
            const data = await response.json().catch(() => ({}))
            if (!response.ok || data?.success !== true) {
                throw new Error(data?.error || 'Failed to delete file')
            }

            setStatusMessage(
                data?.storageWarning
                    ? `File deleted. ${data.storageWarning}`
                    : `${row.file_name || 'File'} deleted.`
            )
            await requestFiles(scope, appliedQuery, { clearStatus: false })
        } catch (deleteError) {
            setError(deleteError?.message || 'Failed to delete file')
        } finally {
            setDeletingId(null)
        }
    }

    // "No files yet" is only the whole truth when no filter is narrowing the list,
    // so the empty state names the filter that produced it.
    const emptyState = useMemo(() => {
        if (appliedQuery) {
            return {
                title: 'No files match that search',
                hint: 'Clear the search, or try a different file name.',
            }
        }
        if (scope === 'patient') {
            return {
                title: 'No patient files yet',
                hint: 'Files uploaded from a patient record land here.',
            }
        }
        if (scope === 'practice') {
            return {
                title: 'No practice files yet',
                hint: 'Choose "Practice (no patient)" above to store a file that belongs to the practice rather than a patient.',
            }
        }
        return {
            title: 'No files yet',
            hint: 'Upload a file for a patient, or for the practice, and it lands here.',
        }
    }, [appliedQuery, scope])

    const storageNotice = useMemo(() => {
        if (!storage) return null
        if (!storage.available) {
            return {
                tone: 'error',
                text: `Files are set to ${storage.label}, but this deployment cannot use it. ${storage.reason || ''}`.trim(),
            }
        }
        return {
            tone: 'info',
            text: storage.external
                ? `New uploads are stored in ${storage.label}, outside the database.`
                : 'New uploads are stored in the database.',
        }
    }, [storage])

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-100">
                <p className="text-sm text-slate-500">Loading files...</p>
            </div>
        )
    }

    if (!isAuthenticated) {
        return null
    }

    return (
        <div className="min-h-screen bg-slate-100">
            <AdminHeader title="Files" brandingDomainKey={activeDomain} />

            <main className="mx-auto max-w-5xl px-4 py-8">
                <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                        <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm">
                            <Files className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
                        </span>
                        <div>
                            <h1 className="text-xl font-bold tracking-tight text-gray-900">Files</h1>
                            <p className="mt-0.5 text-sm text-gray-600">
                                Every file uploaded to this practice, whether it belongs to a patient or to the practice.
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => requestFiles()}
                        disabled={reloading}
                        className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${reloading ? 'animate-spin' : ''}`} aria-hidden="true" />
                        Refresh
                    </button>
                </div>

                {storageNotice && (
                    <p
                        className={`mb-4 rounded-md border px-3 py-2 text-sm ${storageNotice.tone === 'error'
                            ? 'border-amber-300 bg-amber-50 text-amber-800'
                            : 'border-slate-200 bg-white text-slate-600'}`}
                    >
                        {storageNotice.text}
                    </p>
                )}

                {error && (
                    <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
                )}

                {statusMessage && !error && (
                    <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{statusMessage}</p>
                )}

                <section className="mb-5 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-end gap-3">
                        <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs font-medium text-gray-600">
                            Upload for
                            <select
                                value={uploadPatientId}
                                onChange={(event) => setUploadPatientId(event.target.value)}
                                className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-800"
                            >
                                <option value="">Practice (no patient)</option>
                                {patients.map((patient) => (
                                    <option key={patient.id} value={patient.id}>
                                        {patient.patient_name || `Patient #${patient.id}`}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <input
                            ref={fileInputRef}
                            type="file"
                            onChange={handleUpload}
                            className="hidden"
                            aria-hidden="true"
                            tabIndex={-1}
                        />
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploading || storage?.available === false}
                            className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                        >
                            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                            {uploading ? 'Uploading...' : 'Upload file'}
                        </button>
                        <p className="basis-full text-[11px] text-gray-500">Files must be 25 MB or smaller.</p>
                    </div>
                </section>

                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 shadow-sm" role="group" aria-label="Filter files">
                        {FILE_SCOPES.map((option) => {
                            const isActive = scope === option.key
                            return (
                                <button
                                    key={option.key}
                                    type="button"
                                    onClick={() => handleScopeChange(option.key)}
                                    aria-pressed={isActive}
                                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${isActive ? 'bg-slate-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                                >
                                    {option.label}
                                </button>
                            )
                        })}
                    </div>

                    <form onSubmit={handleSearch} className="flex items-center gap-2">
                        <label className="relative">
                            <span className="sr-only">Search files by name</span>
                            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" aria-hidden="true" />
                            <input
                                type="search"
                                value={queryDraft}
                                onChange={(event) => setQueryDraft(event.target.value)}
                                placeholder="Search file names"
                                className="h-9 w-56 rounded-md border border-gray-300 bg-white pl-8 pr-2 text-sm text-gray-800"
                            />
                        </label>
                        <button
                            type="submit"
                            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                            Search
                        </button>
                    </form>
                </div>

                {files.length === 0 ? (
                    <section className="rounded-lg border border-dashed border-gray-300 bg-white px-6 py-10 text-center">
                        <FolderOpen className="mx-auto h-6 w-6 text-sky-600" aria-hidden="true" />
                        <h2 className="mt-3 text-sm font-semibold text-gray-900">{emptyState.title}</h2>
                        <p className="mt-1 text-xs text-gray-500">{emptyState.hint}</p>
                    </section>
                ) : (
                    <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm" aria-label="Stored files">
                        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100 bg-gray-50/70 px-5 py-3">
                            <h2 className="text-sm font-semibold text-gray-900">Stored files</h2>
                            <span className="text-xs text-gray-500">
                                {files.length} {files.length === 1 ? 'file' : 'files'}
                                {files.length >= FILE_LIST_LIMIT ? ` (newest ${FILE_LIST_LIMIT})` : ''}
                            </span>
                        </div>
                        <ul className="divide-y divide-gray-100">
                            {files.map((row) => {
                                const ownerLabel = describeFileOwner(row)
                                const patientHref = row.patient_id
                                    ? buildPatientFilesHref(row.patient_id, { returnTo: '/admin/files' })
                                    : ''
                                const uploadedLabel = formatUploadedAt(row.created_at, refreshTicker)
                                const isDeleting = deletingId === row.id

                                return (
                                    <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-medium text-gray-900">{row.file_name || 'Untitled file'}</p>
                                            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-gray-500">
                                                {patientHref ? (
                                                    <a href={patientHref} className="inline-flex items-center gap-0.5 font-medium text-sky-700 hover:text-sky-800">
                                                        {ownerLabel}
                                                        <ChevronRight className="h-3 w-3" aria-hidden="true" />
                                                    </a>
                                                ) : (
                                                    <span className="font-medium text-gray-600">{ownerLabel}</span>
                                                )}
                                                <span aria-hidden="true">·</span>
                                                <span>{formatFileSize(row.file_size)}</span>
                                                {uploadedLabel && (
                                                    <>
                                                        <span aria-hidden="true">·</span>
                                                        <span>{uploadedLabel}</span>
                                                    </>
                                                )}
                                                {row.analysis_evidence && (
                                                    <>
                                                        <span aria-hidden="true">·</span>
                                                        <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700">
                                                            Analyst evidence
                                                        </span>
                                                    </>
                                                )}
                                            </p>
                                        </div>
                                        <div className="flex flex-none items-center gap-1.5">
                                            <button
                                                type="button"
                                                onClick={() => handleDownload(row)}
                                                className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                            >
                                                <Download className="h-3 w-3" aria-hidden="true" />
                                                Download
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleDelete(row)}
                                                disabled={isDeleting}
                                                className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                                            >
                                                <Trash2 className="h-3 w-3" aria-hidden="true" />
                                                {isDeleting ? 'Deleting...' : 'Delete'}
                                            </button>
                                        </div>
                                    </li>
                                )
                            })}
                        </ul>
                    </section>
                )}
            </main>
        </div>
    )
}
