'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import AdminHeader from '@/admin-ui/components/AdminHeader'
import { getCurrentUser, getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import { DEFAULT_DOMAIN_MODE, getEffectiveDomainMode } from '@/lib/domainMode'
import {
    isSourcingInProgress,
    sourcingStatusBadgeClass,
    sourcingStatusLabel,
    SOURCING_STATUS_QUOTE_RECEIVED,
    SOURCING_STATUS_QUOTE_REQUESTED,
} from '@/lib/equipmentSourcingStatus'
import { readStoredDefaultDomain } from '@/lib/defaultDomainPreference'


const FILTERS = [
    { id: 'all', label: 'All in progress' },
    { id: SOURCING_STATUS_QUOTE_RECEIVED, label: 'Quote received' },
    { id: SOURCING_STATUS_QUOTE_REQUESTED, label: 'Awaiting reply' },
]

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
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

function formatDateTime(isoString) {
    if (!isoString) return '-'
    const date = new Date(isoString)
    if (!Number.isFinite(date.getTime())) return '-'
    return date.toLocaleString()
}

export default function SourcingAdminPage() {
    const router = useRouter()

    const [loading, setLoading] = useState(true)
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [activeDomain, setActiveDomain] = useState(DEFAULT_DOMAIN_MODE)

    const [items, setItems] = useState([])
    const [counts, setCounts] = useState({ total: 0, quote_requested: 0, quote_received: 0 })
    const [statusChanges, setStatusChanges] = useState([])
    const [loadingItems, setLoadingItems] = useState(false)
    const [statusMessage, setStatusMessage] = useState('')
    const [statusTone, setStatusTone] = useState('neutral')
    const [selectedFilter, setSelectedFilter] = useState('all')

    const refreshItems = useCallback(async ({ domain } = {}) => {
        if (!domain) return

        const token = window.localStorage.getItem('adminToken')
        if (!token) {
            setItems([])
            return
        }

        setLoadingItems(true)
        try {
            const query = new URLSearchParams({ domain, limit: '200' })
            const response = await fetchWithTimeout(`/api/database/sourcing?${query.toString()}`, {
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store',
            })

            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to load sourcing items')
            }

            setItems(Array.isArray(data?.items) ? data.items : [])
            setCounts(data?.counts && typeof data.counts === 'object'
                ? { total: 0, quote_requested: 0, quote_received: 0, ...data.counts }
                : { total: 0, quote_requested: 0, quote_received: 0 })
            setStatusChanges(Array.isArray(data?.changes) ? data.changes : [])
            setStatusMessage('')
            setStatusTone('neutral')
        } catch (error) {
            setItems([])
            setCounts({ total: 0, quote_requested: 0, quote_received: 0 })
            setStatusChanges([])
            setStatusMessage(error?.message || 'Failed to load sourcing items')
            setStatusTone('error')
        } finally {
            setLoadingItems(false)
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

                await refreshItems({ domain: effectiveDomain })
            } catch (error) {
                if (cancelled) return
                setStatusMessage(error?.message || 'Failed to initialise the sourcing view')
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
    }, [refreshItems, router])

    const filteredItems = useMemo(() => {
        if (selectedFilter === 'all') return items
        return items.filter((item) => item.status === selectedFilter)
    }, [items, selectedFilter])

    const awaitingCount = counts.quote_requested || 0
    const receivedCount = counts.quote_received || 0

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <p className="text-sm text-gray-600">Loading sourcing admin...</p>
            </div>
        )
    }

    if (!isAuthenticated) {
        return null
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <AdminHeader title="Sourcing" brandingDomainKey={activeDomain} />

            <main className="mx-auto max-w-7xl px-4 py-8 space-y-6">
                <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Equipment sourcing</h1>
                            <p className="mt-1 text-sm text-gray-600">
                                Equipment quotes requested from suppliers, and the replies that have come back.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => refreshItems({ domain: activeDomain })}
                            disabled={loadingItems}
                            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {loadingItems ? 'Refreshing...' : 'Refresh'}
                        </button>
                    </div>

                    {statusMessage && (
                        <div className={`mt-4 rounded-md border px-3 py-2 text-sm ${statusTone === 'error'
                            ? 'border-red-200 bg-red-50 text-red-700'
                            : 'border-green-200 bg-green-50 text-green-700'
                            }`}>
                            {statusMessage}
                        </div>
                    )}

                    {statusChanges.length > 0 && (
                        <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                            {statusChanges.length} item{statusChanges.length === 1 ? '' : 's'} updated to{' '}
                            <span className="font-semibold">Quote received</span> from a supplier reply.
                        </div>
                    )}

                    <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">In progress</p>
                            <p className="mt-1 text-2xl font-bold text-gray-900">{counts.total || 0}</p>
                        </div>
                        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Awaiting reply</p>
                            <p className="mt-1 text-2xl font-bold text-blue-900">{awaitingCount}</p>
                        </div>
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Quote received</p>
                            <p className="mt-1 text-2xl font-bold text-emerald-900">{receivedCount}</p>
                        </div>
                    </div>

                    <div className="mt-6 border-b border-gray-200 flex flex-wrap gap-4">
                        {FILTERS.map((filter) => (
                            <button
                                key={filter.id}
                                type="button"
                                onClick={() => setSelectedFilter(filter.id)}
                                className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${selectedFilter === filter.id
                                    ? 'border-gray-900 text-gray-900'
                                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                    }`}
                            >
                                {filter.label}
                                <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal text-gray-600">
                                    {filter.id === 'all'
                                        ? counts.total || 0
                                        : filter.id === SOURCING_STATUS_QUOTE_RECEIVED
                                            ? receivedCount
                                            : awaitingCount}
                                </span>
                            </button>
                        ))}
                    </div>
                </section>

                <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                        <h2 className="text-lg font-semibold text-gray-900">In-progress items</h2>
                        <span className="text-xs text-gray-500">{filteredItems.length} item(s)</span>
                    </div>

                    <div className="mt-4 space-y-3">
                        {loadingItems && (
                            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                                Loading sourcing items...
                            </div>
                        )}

                        {!loadingItems && filteredItems.length === 0 && (
                            <div className="rounded-md border border-dashed border-gray-200 px-3 py-4 text-sm text-gray-500">
                                No equipment items are currently being sourced. Start a quote request from a patient&apos;s
                                Equipment tab.
                            </div>
                        )}

                        {!loadingItems && filteredItems.map((item) => {
                            const quoteReceived = item.status === SOURCING_STATUS_QUOTE_RECEIVED
                            return (
                                <div
                                    key={item.key}
                                    className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
                                >
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${sourcingStatusBadgeClass(item.status)}`}>
                                                    {sourcingStatusLabel(item.status)}
                                                </span>
                                                {item.supplierEmail && (
                                                    <span className="text-xs text-gray-400 font-mono">{item.supplierEmail}</span>
                                                )}
                                            </div>
                                            <p className="mt-2 text-sm font-semibold text-gray-900">
                                                {item.name || 'Untitled equipment item'}
                                            </p>
                                            <p className="mt-1 text-sm text-gray-600 line-clamp-2">
                                                {item.description || 'No description recorded.'}
                                            </p>
                                        </div>

                                        <div className="flex shrink-0 flex-col items-end gap-2">
                                            <button
                                                type="button"
                                                onClick={() => router.push(item.href)}
                                                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                            >
                                                Open equipment tab
                                            </button>
                                            {item.response?.id && (
                                                <button
                                                    type="button"
                                                    onClick={() => router.push(`/admin/messages/${encodeURIComponent(String(item.response.id))}?direction=inbound`)}
                                                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                                >
                                                    View supplier email
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2 border-t border-gray-100 pt-3 text-xs text-gray-600">
                                        <div>
                                            <p className="font-medium text-gray-500">Patient</p>
                                            <p className="mt-0.5 text-gray-800">
                                                {item.patientName || `Patient #${item.patientId}`}
                                            </p>
                                        </div>
                                        <div>
                                            <p className="font-medium text-gray-500">Supplier</p>
                                            <p className="mt-0.5 text-gray-800">{item.supplierName || 'Not recorded'}</p>
                                        </div>
                                        <div>
                                            <p className="font-medium text-gray-500">Requested</p>
                                            <p className="mt-0.5 text-gray-800" title={formatDateTime(item.requestedAt)}>
                                                {item.requestedAt ? formatRelativeTime(item.requestedAt) : '-'}
                                            </p>
                                        </div>
                                        <div>
                                            <p className="font-medium text-gray-500">Last activity</p>
                                            <p className="mt-0.5 text-gray-800" title={formatDateTime(item.lastActivityAt)}>
                                                {item.lastActivityAt ? formatRelativeTime(item.lastActivityAt) : '-'}
                                            </p>
                                        </div>
                                    </div>

                                    {quoteReceived && item.response && (
                                        <div className="mt-3 rounded-md border border-emerald-100 bg-emerald-50/60 px-3 py-2">
                                            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                                                Supplier reply · {formatRelativeTime(item.response.receivedAt)}
                                            </p>
                                            <p className="mt-1 text-sm font-medium text-gray-900">
                                                {item.response.subject || 'No subject'}
                                            </p>
                                            <p className="mt-1 text-sm text-gray-700">
                                                {item.response.preview || 'No preview available'}
                                            </p>
                                            <p className="mt-1 text-xs text-gray-500">
                                                From {item.response.fromEmail || 'unknown sender'}
                                                {item.response.matchCount > 1 ? ` · ${item.response.matchCount} matching messages` : ''}
                                            </p>
                                        </div>
                                    )}

                                    {!quoteReceived && isSourcingInProgress(item.status) && (
                                        <p className="mt-3 text-xs text-gray-500">
                                            Waiting on {item.supplierName || 'the supplier'} to reply to the quote request.
                                        </p>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </section>
            </main>
        </div>
    )
}
