'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import AdminHeader from '@/admin-ui/components/AdminHeader'
import { getCurrentUser, getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'

const EMPTY_DRAFT = {
    key: '',
    value: '',
}

const PAGE_SIZE = 25

function formatDateTime(value) {
    if (!value) return 'Never'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return String(value)
    return date.toLocaleString()
}

function getValuePreview(value) {
    const text = String(value || '').trim()
    if (!text) return 'Empty value'
    return text.length > 180 ? `${text.slice(0, 180)}...` : text
}

function formatValueForEditing(record) {
    const rawValue = record?.value
    if (typeof rawValue === 'string') {
        try {
            return JSON.stringify(JSON.parse(rawValue), null, 2)
        } catch {
            return rawValue
        }
    }

    return rawValue === undefined || rawValue === null
        ? ''
        : JSON.stringify(rawValue, null, 2)
}

export default function SystemStateSettingsPage() {
    const router = useRouter()
    const editorPanelRef = useRef(null)
    const inlineEditorRef = useRef(null)
    const skipNextRecordsEffectRef = useRef(false)
    const valueTextareaRef = useRef(null)
    const [loading, setLoading] = useState(true)
    const [records, setRecords] = useState([])
    const [totalRecords, setTotalRecords] = useState(0)
    const [pageIndex, setPageIndex] = useState(0)
    const [recordsLoading, setRecordsLoading] = useState(false)
    const [query, setQuery] = useState('')
    const [draft, setDraft] = useState(EMPTY_DRAFT)
    const [editingKey, setEditingKey] = useState('')
    const [saving, setSaving] = useState(false)
    const [deletingKey, setDeletingKey] = useState('')
    const [statusMessage, setStatusMessage] = useState('')
    const [statusTone, setStatusTone] = useState('neutral')

    useEffect(() => {
        document.title = 'System State Settings'
    }, [])

    const setStatus = useCallback((message, tone = 'neutral') => {
        setStatusMessage(message)
        setStatusTone(tone)
    }, [])

    const fetchRecords = useCallback(async (token, options = {}) => {
        const nextPageIndex = Number.isInteger(options.pageIndex) ? options.pageIndex : pageIndex
        const nextQuery = typeof options.query === 'string' ? options.query : query
        const params = new URLSearchParams({
            limit: String(PAGE_SIZE),
            offset: String(Math.max(nextPageIndex, 0) * PAGE_SIZE),
        })
        if (nextQuery.trim()) {
            params.set('q', nextQuery.trim())
        }

        try {
            setRecordsLoading(true)
            const response = await fetch(`/api/settings/system-state?${params.toString()}`, {
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store',
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok || !data?.success) {
                throw new Error(data?.error || 'Failed to load system state records')
            }
            setRecords(Array.isArray(data.records) ? data.records : [])
            setTotalRecords(Number.isFinite(data.total) ? data.total : 0)
        } finally {
            setRecordsLoading(false)
        }
    }, [pageIndex, query])

    useEffect(() => {
        let cancelled = false

        async function bootstrap() {
            const token = await getOrCreateAdminTokenForLocalhost()
            if (cancelled) return

            if (!token) {
                router.push('/login')
                return
            }

            const user = getCurrentUser()
            if (!user || user.role !== 'superadmin') {
                setLoading(false)
                router.replace('/admin')
                return
            }

            try {
                await fetchRecords(token, { pageIndex: 0, query: '' })
                skipNextRecordsEffectRef.current = true
            } catch (error) {
                setStatus(error?.message || 'Failed to load system state records', 'error')
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        bootstrap()
        return () => { cancelled = true }
    }, [fetchRecords, router, setStatus])

    useEffect(() => {
        if (loading) return

        if (skipNextRecordsEffectRef.current) {
            skipNextRecordsEffectRef.current = false
            return
        }

        const token = window.localStorage.getItem('adminToken')
        if (!token) return

        const timeoutId = window.setTimeout(() => {
            fetchRecords(token, { pageIndex, query })
                .catch((error) => setStatus(error?.message || 'Failed to load system state records', 'error'))
        }, 250)

        return () => window.clearTimeout(timeoutId)
    }, [fetchRecords, loading, pageIndex, query, setStatus])

    const filteredRecords = useMemo(() => {
        return records
    }, [records])

    const totalPages = Math.max(1, Math.ceil(totalRecords / PAGE_SIZE))
    const canGoPrevious = pageIndex > 0
    const canGoNext = pageIndex + 1 < totalPages

    const updateQuery = (value) => {
        setQuery(value)
        setPageIndex(0)
    }

    const refreshCurrentPage = async () => {
        const token = window.localStorage.getItem('adminToken')
        if (!token) return
        await fetchRecords(token, { pageIndex, query })
    }

    const startCreate = () => {
        setEditingKey('')
        setDraft(EMPTY_DRAFT)
        setStatus('', 'neutral')
        window.setTimeout(() => {
            editorPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }, 0)
    }

    const startEdit = (record) => {
        setEditingKey(record.key)
        setDraft({
            key: record.key,
            value: formatValueForEditing(record),
        })
        setStatus('', 'neutral')
        window.setTimeout(() => {
            const target = inlineEditorRef.current || editorPanelRef.current
            target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            valueTextareaRef.current?.focus()
        }, 0)
    }

    const saveRecord = async (event) => {
        event.preventDefault()

        const key = draft.key.trim()
        if (!key) {
            setStatus('Key is required.', 'error')
            return
        }

        const token = window.localStorage.getItem('adminToken')
        if (!token) {
            router.push('/login')
            return
        }

        setSaving(true)
        try {
            const response = await fetch('/api/settings/system-state', {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ key, value: draft.value }),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok || !data?.success) {
                throw new Error(data?.error || 'Failed to save system state record')
            }

            await refreshCurrentPage()
            setEditingKey(key)
            setDraft((current) => ({ ...current, key }))
            setStatus('System state record saved.', 'success')
        } catch (error) {
            setStatus(error?.message || 'Failed to save system state record', 'error')
        } finally {
            setSaving(false)
        }
    }

    const deleteRecord = async (record) => {
        if (!window.confirm(`Delete settings record "${record.key}"?`)) return

        const token = window.localStorage.getItem('adminToken')
        if (!token) {
            router.push('/login')
            return
        }

        setDeletingKey(record.key)
        try {
            const response = await fetch('/api/settings/system-state', {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ key: record.key }),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok || !data?.success) {
                throw new Error(data?.error || 'Failed to delete system state record')
            }

            await refreshCurrentPage()
            if (editingKey === record.key) startCreate()
            setStatus('System state record deleted.', 'success')
        } catch (error) {
            setStatus(error?.message || 'Failed to delete system state record', 'error')
        } finally {
            setDeletingKey('')
        }
    }

    const statusClassName = statusTone === 'error'
        ? 'border-red-200 bg-red-50 text-red-700'
        : statusTone === 'success'
            ? 'border-green-200 bg-green-50 text-green-700'
            : 'border-gray-200 bg-gray-50 text-gray-700'

    if (loading) {
        return (
            <div className="min-h-screen">
                <AdminHeader title="System State" />
                <main className="mx-auto max-w-7xl px-4 py-8">
                    <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600 shadow-sm">Loading system state records...</div>
                </main>
            </div>
        )
    }

    return (
        <div className="min-h-screen">
            <AdminHeader title="System State" />
            <main className="mx-auto max-w-7xl px-4 py-8">
                <section className="mb-6 rounded-lg border border-gray-200 bg-white/90 p-6 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">System State</h1>
                            <p className="mt-1 text-sm text-gray-600">Review and manage system-wide settings stored in system_settings.</p>
                        </div>
                        <button
                            type="button"
                            onClick={startCreate}
                            className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700"
                        >
                            Add record
                        </button>
                    </div>
                </section>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
                    <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
                        <div className="border-b border-gray-200 p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <h2 className="text-lg font-semibold text-gray-900">Records</h2>
                                    <p className="text-sm text-gray-500">
                                        {recordsLoading ? 'Loading...' : `${filteredRecords.length} shown of ${totalRecords} records`}
                                    </p>
                                </div>
                                <input
                                    type="search"
                                    value={query}
                                    onChange={(event) => updateQuery(event.target.value)}
                                    placeholder="Search key or value"
                                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm md:w-72"
                                />
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200 text-sm">
                                <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    <tr>
                                        <th className="px-4 py-3">Key</th>
                                        <th className="px-4 py-3">Value</th>
                                        <th className="px-4 py-3">Updated</th>
                                        <th className="px-4 py-3 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 bg-white">
                                    {filteredRecords.map((record) => (
                                        <Fragment key={record.key}>
                                            <tr className={editingKey === record.key ? 'bg-blue-50/60' : undefined}>
                                                <td className="max-w-[220px] px-4 py-3 align-top font-mono text-xs font-medium text-gray-900 break-all">{record.key}</td>
                                                <td className="max-w-md px-4 py-3 align-top">
                                                    <pre className="max-h-24 overflow-hidden whitespace-pre-wrap break-words text-xs leading-5 text-gray-600">{getValuePreview(record.value)}</pre>
                                                </td>
                                                <td className="whitespace-nowrap px-4 py-3 align-top text-xs text-gray-500">{formatDateTime(record.updatedAt)}</td>
                                                <td className="whitespace-nowrap px-4 py-3 align-top text-right">
                                                    <button
                                                        type="button"
                                                        onClick={() => startEdit(record)}
                                                        className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                                    >
                                                        {editingKey === record.key ? 'Editing' : 'Edit'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => deleteRecord(record)}
                                                        disabled={deletingKey === record.key}
                                                        className="ml-2 rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                                                    >
                                                        {deletingKey === record.key ? 'Deleting...' : 'Delete'}
                                                    </button>
                                                </td>
                                            </tr>
                                            {editingKey === record.key && (
                                                <tr ref={inlineEditorRef} className="bg-blue-50/80">
                                                    <td className="px-4 py-4" colSpan={4}>
                                                        <form onSubmit={saveRecord} className="rounded-lg border border-blue-200 bg-white p-4 shadow-sm">
                                                            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                                                                <div>
                                                                    <h3 className="text-sm font-semibold text-gray-900">Editing JSON value</h3>
                                                                    <p className="mt-1 break-all font-mono text-xs text-blue-800">{record.key}</p>
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <button
                                                                        type="submit"
                                                                        disabled={saving}
                                                                        className="rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                                                                    >
                                                                        {saving ? 'Saving...' : 'Save'}
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={startCreate}
                                                                        className="rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                                                    >
                                                                        Close
                                                                    </button>
                                                                </div>
                                                            </div>
                                                            <textarea
                                                                ref={valueTextareaRef}
                                                                value={draft.value}
                                                                onChange={(event) => setDraft((current) => ({ ...current, value: event.target.value }))}
                                                                rows={14}
                                                                className="w-full rounded-md border border-blue-200 px-3 py-2 font-mono text-sm leading-5 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                                            />
                                                        </form>
                                                    </td>
                                                </tr>
                                            )}
                                        </Fragment>
                                    ))}
                                    {filteredRecords.length === 0 && (
                                        <tr>
                                            <td className="px-4 py-8 text-center text-sm text-gray-500" colSpan={4}>No system state records found.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-4 py-3 text-sm text-gray-600">
                            <span>Page {pageIndex + 1} of {totalPages}</span>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setPageIndex((current) => Math.max(current - 1, 0))}
                                    disabled={!canGoPrevious || recordsLoading}
                                    className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                >
                                    Previous
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPageIndex((current) => current + 1)}
                                    disabled={!canGoNext || recordsLoading}
                                    className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    </section>

                    <aside ref={editorPanelRef} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                        <div className="mb-4 flex items-center justify-between gap-3">
                            <div>
                                <h2 className="text-lg font-semibold text-gray-900">{editingKey ? 'Edit record' : 'Add record'}</h2>
                                <p className="text-sm text-gray-500">Values are saved as raw text and parsed as JSON by consumers when valid.</p>
                                {editingKey && (
                                    <p className="mt-2 break-all rounded-md bg-blue-50 px-2 py-1 font-mono text-xs font-medium text-blue-800">{editingKey}</p>
                                )}
                            </div>
                        </div>

                        {statusMessage && (
                            <div className={`mb-4 rounded-md border px-3 py-2 text-sm ${statusClassName}`}>{statusMessage}</div>
                        )}

                        <form onSubmit={saveRecord} className="space-y-4">
                            <label className="block">
                                <span className="text-sm font-medium text-gray-700">Key</span>
                                <input
                                    type="text"
                                    value={draft.key}
                                    onChange={(event) => setDraft((current) => ({ ...current, key: event.target.value }))}
                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm"
                                    placeholder="example_setting_v1"
                                />
                            </label>

                            <label className="block">
                                <span className="text-sm font-medium text-gray-700">Value</span>
                                <textarea
                                    value={draft.value}
                                    onChange={(event) => setDraft((current) => ({ ...current, value: event.target.value }))}
                                    rows={16}
                                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm leading-5"
                                    placeholder='{"enabled": true}'
                                />
                            </label>

                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                                >
                                    {saving ? 'Saving...' : 'Save record'}
                                </button>
                                <button
                                    type="button"
                                    onClick={startCreate}
                                    className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                                >
                                    Clear
                                </button>
                            </div>
                        </form>
                    </aside>
                </div>
            </main>
        </div>
    )
}