'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import AdminHeader from '@/admin-ui/components/AdminHeader'
import { getCurrentUser, getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import { DEFAULT_DOMAIN_MODE, getEffectiveDomainMode } from '@/lib/domainMode'
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

function formatRelativeTime(isoString) {
    if (!isoString) return 'Unknown time'
    const timestamp = new Date(isoString).getTime()
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

function formatItemTypeLabel(item) {
    return String(item?.itemLabel || item?.itemType || 'Item').trim() || 'Item'
}

const CLEANUP_OPTIONS = [
    {
        value: 'month',
        label: 'Older than a month',
        description: 'Permanently delete items that have been in Recycling for more than one month.',
    },
    {
        value: '3months',
        label: 'Older than 3 months',
        description: 'Permanently delete items that have been in Recycling for more than three months.',
    },
    {
        value: 'all',
        label: 'Everything',
        description: 'Permanently delete every item currently in Recycling.',
    },
]

function formatCleanupScopeLabel(scope) {
    return CLEANUP_OPTIONS.find((option) => option.value === scope)?.label || 'selected items'
}

export default function RecyclingAdminPage() {
    const router = useRouter()
    const searchParams = useSearchParams()

    const [loading, setLoading] = useState(true)
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [activeDomain, setActiveDomain] = useState(DEFAULT_DOMAIN_MODE)
    const [items, setItems] = useState([])
    const [loadingItems, setLoadingItems] = useState(false)
    const [previewItem, setPreviewItem] = useState(null)
    const [restoringItemId, setRestoringItemId] = useState('')
    const [showCleanupModal, setShowCleanupModal] = useState(false)
    const [cleanupScope, setCleanupScope] = useState('month')
    const [cleaningUp, setCleaningUp] = useState(false)
    const [statusMessage, setStatusMessage] = useState('')
    const [statusTone, setStatusTone] = useState('neutral')

    const refreshItems = useCallback(async ({ domain } = {}) => {
        const scopedDomain = String(domain || activeDomain || '').trim().toLowerCase()
        if (!scopedDomain) {
            setItems([])
            return
        }

        setLoadingItems(true)
        setStatusMessage('')

        try {
            const token = await getOrCreateAdminTokenForLocalhost()
            if (!token) {
                throw new Error('Missing admin session token')
            }

            const query = new URLSearchParams({ domain: scopedDomain, limit: '200' })
            const response = await fetchWithTimeout(`/api/database/recycling?${query.toString()}`, {
                cache: 'no-store',
                headers: { Authorization: `Bearer ${token}` },
            })
            const data = await response.json().catch(() => ({}))

            if (!response.ok) {
                throw new Error(data?.error || 'Failed to load recycling items')
            }

            setItems(Array.isArray(data?.data) ? data.data : [])
        } catch (error) {
            setItems([])
            setStatusMessage(error?.message || 'Failed to load recycling items')
            setStatusTone('error')
        } finally {
            setLoadingItems(false)
        }
    }, [activeDomain])

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
                await refreshItems({ domain: effectiveDomain })
            } catch (error) {
                if (cancelled) return
                setStatusMessage(error?.message || 'Failed to initialize recycling view')
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
    }, [router, refreshItems])

    const visibleItems = useMemo(() => items, [items])

    useEffect(() => {
        const targetItemId = String(searchParams.get('item') || '').trim()
        if (!targetItemId || items.length === 0) return undefined

        const targetItem = items.find((item) => String(item?.id || '') === targetItemId)
        if (!targetItem) return undefined

        const timeoutId = window.setTimeout(() => {
            setPreviewItem(targetItem)
        }, 0)

        return () => window.clearTimeout(timeoutId)
    }, [items, searchParams])

    const handleRestoreItem = async (item) => {
        const sourceId = String(item?.sourceId || '').trim()
        if (!sourceId || !item?.itemType) return

        const confirmed = window.confirm(`Restore ${formatItemTypeLabel(item).toLowerCase()} "${item.title || 'Untitled item'}"?`)
        if (!confirmed) return

        setRestoringItemId(item.id || sourceId)
        setStatusMessage('')
        setStatusTone('neutral')

        try {
            const token = await getOrCreateAdminTokenForLocalhost()
            if (!token) {
                throw new Error('Missing admin session token')
            }

            const response = await fetchWithTimeout('/api/database/recycling', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action: 'restore',
                    domain: activeDomain,
                    itemType: item.itemType,
                    sourceId: item.sourceId,
                    sourceTable: item.sourceTable,
                }),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to restore item')
            }

            setItems((current) => current.filter((candidate) => candidate.id !== item.id))
            setPreviewItem((current) => current?.id === item.id ? null : current)
            setStatusMessage(`${formatItemTypeLabel(item)} restored.`)
            setStatusTone('success')
        } catch (error) {
            setStatusMessage(error?.message || 'Failed to restore item')
            setStatusTone('error')
        } finally {
            setRestoringItemId('')
        }
    }

    const handleCleanup = async () => {
        const confirmed = window.confirm(`Permanently delete ${formatCleanupScopeLabel(cleanupScope).toLowerCase()} from Recycling? This cannot be undone.`)
        if (!confirmed) return

        setCleaningUp(true)
        setStatusMessage('')
        setStatusTone('neutral')

        try {
            const token = await getOrCreateAdminTokenForLocalhost()
            if (!token) {
                throw new Error('Missing admin session token')
            }

            const response = await fetchWithTimeout('/api/database/recycling', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action: 'cleanup',
                    domain: activeDomain,
                    scope: cleanupScope,
                }),
            }, 30000)
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to clean up recycling items')
            }

            const deletedCount = Number(data?.result?.deletedCount || 0)
            setShowCleanupModal(false)
            setPreviewItem(null)
            await refreshItems({ domain: activeDomain })
            setStatusMessage(deletedCount === 1 ? '1 item permanently deleted.' : `${deletedCount} items permanently deleted.`)
            setStatusTone('success')
        } catch (error) {
            setStatusMessage(error?.message || 'Failed to clean up recycling items')
            setStatusTone('error')
        } finally {
            setCleaningUp(false)
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <p className="text-sm text-gray-600">Loading recycling...</p>
            </div>
        )
    }

    if (!isAuthenticated) {
        return null
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <AdminHeader title="Recycling" brandingDomainKey={activeDomain} />

            <main className="mx-auto max-w-7xl px-4 py-8 space-y-6">
                <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Recycling</h1>
                            <p className="mt-1 text-sm text-gray-600">Items marked as pending delete for the active domain.</p>
                        </div>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setShowCleanupModal(true)}
                                disabled={loadingItems || visibleItems.length === 0}
                                className="rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                Clean Up
                            </button>
                            <button
                                type="button"
                                onClick={() => refreshItems({ domain: activeDomain })}
                                disabled={loadingItems}
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {loadingItems ? 'Refreshing...' : 'Refresh'}
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

                <section className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
                    <div className="border-b border-gray-200 px-6 py-4">
                        <h2 className="text-lg font-semibold text-gray-900">Recently Deleted</h2>
                        <p className="mt-1 text-sm text-gray-600">Items marked pending delete can be restored here, including content posts, transcripts, and reports.</p>
                    </div>

                    {visibleItems.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Type</th>
                                        <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Title</th>
                                        <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Details</th>
                                        <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Updated</th>
                                        <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 bg-white">
                                    {visibleItems.map((item) => (
                                        <tr key={item.id} className="hover:bg-gray-50">
                                            <td className="px-6 py-4 text-sm text-gray-700">
                                                <span className="inline-flex rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700">
                                                    {formatItemTypeLabel(item)}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="text-sm font-medium text-gray-900">{item.title || 'Untitled item'}</div>
                                                <div className="mt-1 text-xs text-gray-500">{String(item.status || 'pending delete')}</div>
                                            </td>
                                            <td className="px-6 py-4 text-sm text-gray-600">
                                                <div>{item.subtitle || 'No details available'}</div>
                                                <div className="mt-1 text-xs text-gray-500">{item.domain ? `Domain ${item.domain}` : 'No domain metadata'}</div>
                                            </td>
                                            <td className="px-6 py-4 text-sm text-gray-600">
                                                {item.updatedAt ? formatRelativeTime(item.updatedAt) : 'Unknown time'}
                                            </td>
                                            <td className="px-6 py-4 text-right text-sm">
                                                <div className="flex justify-end gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => setPreviewItem(item)}
                                                        className="inline-flex rounded-md border border-gray-300 bg-white px-3 py-2 font-medium text-gray-700 hover:bg-gray-50"
                                                    >
                                                        Preview
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRestoreItem(item)}
                                                        disabled={restoringItemId === item.id}
                                                        className="inline-flex rounded-md bg-gray-900 px-3 py-2 font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                                                    >
                                                        {restoringItemId === item.id ? 'Restoring...' : 'Restore'}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="px-6 py-12 text-center text-sm text-gray-600">
                            No recently deleted items found.
                        </div>
                    )}
                </section>
            </main>

            {previewItem && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-3xl overflow-hidden rounded-xl bg-white shadow-2xl">
                        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{formatItemTypeLabel(previewItem)}</p>
                                <h2 className="mt-1 text-lg font-semibold text-gray-900">{previewItem.title || 'Untitled item'}</h2>
                                <p className="mt-1 text-sm text-gray-600">{previewItem.subtitle || 'No details available'}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setPreviewItem(null)}
                                className="rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                                aria-label="Close preview"
                            >
                                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <div className="max-h-[65vh] overflow-y-auto px-6 py-5">
                            <dl className="grid grid-cols-1 gap-3 text-sm text-gray-700 sm:grid-cols-3">
                                <div>
                                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Status</dt>
                                    <dd className="mt-1">{previewItem.status || 'pending delete'}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Restore To</dt>
                                    <dd className="mt-1">{previewItem.restoreStatus || 'completed'}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Updated</dt>
                                    <dd className="mt-1">{previewItem.updatedAt ? formatRelativeTime(previewItem.updatedAt) : 'Unknown time'}</dd>
                                </div>
                            </dl>

                            <div className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-4">
                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Preview</p>
                                <pre className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-gray-800">
                                    {String(previewItem.previewText || '').trim() || 'No preview text available for this item.'}
                                </pre>
                            </div>
                        </div>

                        <div className="flex justify-between gap-3 border-t border-gray-200 px-6 py-4">
                            {previewItem.patientHref ? (
                                <a
                                    href={previewItem.patientHref}
                                    className="inline-flex rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                                >
                                    View Patient
                                </a>
                            ) : <span />}
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setPreviewItem(null)}
                                    className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                                >
                                    Close
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleRestoreItem(previewItem)}
                                    disabled={restoringItemId === previewItem.id}
                                    className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {restoringItemId === previewItem.id ? 'Restoring...' : 'Restore'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {showCleanupModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl">
                        <div className="border-b border-gray-200 px-6 py-4">
                            <h2 className="text-lg font-semibold text-gray-900">Clean Up Recycling</h2>
                            <p className="mt-1 text-sm text-gray-600">Choose which pending-delete items to permanently remove.</p>
                        </div>

                        <div className="space-y-3 px-6 py-5">
                            {CLEANUP_OPTIONS.map((option) => (
                                <label
                                    key={option.value}
                                    className={`flex cursor-pointer gap-3 rounded-lg border p-4 ${cleanupScope === option.value
                                        ? 'border-red-300 bg-red-50'
                                        : 'border-gray-200 bg-white hover:bg-gray-50'
                                        }`}
                                >
                                    <input
                                        type="radio"
                                        name="cleanupScope"
                                        value={option.value}
                                        checked={cleanupScope === option.value}
                                        onChange={() => setCleanupScope(option.value)}
                                        className="mt-1 h-4 w-4 text-red-700"
                                    />
                                    <span>
                                        <span className="block text-sm font-semibold text-gray-900">{option.label}</span>
                                        <span className="mt-1 block text-sm text-gray-600">{option.description}</span>
                                    </span>
                                </label>
                            ))}
                        </div>

                        <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4">
                            <button
                                type="button"
                                onClick={() => setShowCleanupModal(false)}
                                disabled={cleaningUp}
                                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleCleanup}
                                disabled={cleaningUp}
                                className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {cleaningUp ? 'Cleaning Up...' : 'Permanently Delete'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
