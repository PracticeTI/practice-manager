'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
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

export default function ChatAdminPage() {
    const router = useRouter()

    const [loading, setLoading] = useState(true)
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [activeDomain, setActiveDomain] = useState(DEFAULT_DOMAIN_MODE)
    const [chatEnabled, setChatEnabled] = useState(false)

    const [chats, setChats] = useState([])
    const [loadingChats, setLoadingChats] = useState(false)
    const [statusMessage, setStatusMessage] = useState('')
    const [statusTone, setStatusTone] = useState('neutral')

    const [searchText, setSearchText] = useState('')
    const [selectedRole, setSelectedRole] = useState('all')
    const [selectedStatus, setSelectedStatus] = useState('all')

    const [roleOptions, setRoleOptions] = useState([])
    const [statusOptions, setStatusOptions] = useState([])

    const refreshChats = useCallback(async ({ domain, role = 'all', status = 'all', search = '' } = {}) => {
        if (!domain) return

        const token = window.localStorage.getItem('adminToken')
        if (!token) {
            setChats([])
            return
        }

        setLoadingChats(true)
        try {
            const query = new URLSearchParams({ domain, limit: '500' })
            if (role && role !== 'all') query.set('role', role)
            if (status && status !== 'all') query.set('status', status)
            if (search.trim()) query.set('search', search.trim())

            const response = await fetchWithTimeout(`/api/database/chats?${query.toString()}`, {
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store',
            })

            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(data?.error || 'Failed to load chats')
            }

            setChats(Array.isArray(data?.data) ? data.data : [])
            setRoleOptions(Array.isArray(data?.filters?.roles) ? data.filters.roles : [])
            setStatusOptions(Array.isArray(data?.filters?.statuses) ? data.filters.statuses : [])
            setStatusMessage('')
            setStatusTone('neutral')
        } catch (error) {
            setChats([])
            setStatusMessage(error?.message || 'Failed to load chats')
            setStatusTone('error')
        } finally {
            setLoadingChats(false)
        }
    }, [])

    const loadDomainFeatureState = useCallback(async (token, domain) => {
        if (!token || !domain) return false

        try {
            const response = await fetchWithTimeout('/api/settings/domains', {
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store',
            })
            const data = await response.json().catch(() => ({}))
            const domainSettings = data?.domains?.[domain] || {}
            return domainSettings?.chatEnabled === true
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

                const enabled = await loadDomainFeatureState(token, effectiveDomain)
                if (cancelled) return

                setActiveDomain(effectiveDomain)
                setChatEnabled(enabled)
                setIsAuthenticated(true)

                await refreshChats({ domain: effectiveDomain, role: 'all', status: 'all', search: '' })
            } catch (error) {
                if (cancelled) return
                setStatusMessage(error?.message || 'Failed to initialize chat view')
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
    }, [router, loadDomainFeatureState, refreshChats])

    const filteredChats = useMemo(() => chats, [chats])

    const handleApplyFilters = async () => {
        await refreshChats({
            domain: activeDomain,
            role: selectedRole,
            status: selectedStatus,
            search: searchText,
        })
    }

    const handleResetFilters = async () => {
        setSearchText('')
        setSelectedRole('all')
        setSelectedStatus('all')
        await refreshChats({ domain: activeDomain, role: 'all', status: 'all', search: '' })
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <p className="text-sm text-gray-600">Loading chat admin...</p>
            </div>
        )
    }

    if (!isAuthenticated) {
        return null
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <AdminHeader title="Chat" brandingDomainKey={activeDomain} />

            <main className="mx-auto max-w-7xl px-4 py-8 space-y-6">
                <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Chat Sessions</h1>
                            <p className="mt-1 text-sm text-gray-600">List view of recent chat sessions with filter controls.</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => refreshChats({ domain: activeDomain, role: selectedRole, status: selectedStatus, search: searchText })}
                            disabled={loadingChats}
                            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {loadingChats ? 'Refreshing...' : 'Refresh'}
                        </button>
                    </div>

                    {!chatEnabled && (
                        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                            Chat is disabled. You can still review past sessions here; enable chat in Domain Settings to capture new sessions.
                        </div>
                    )}

                    {statusMessage && (
                        <div className={`mt-4 rounded-md border px-3 py-2 text-sm ${statusTone === 'error'
                            ? 'border-red-200 bg-red-50 text-red-700'
                            : 'border-green-200 bg-green-50 text-green-700'
                            }`}>
                            {statusMessage}
                        </div>
                    )}
                </section>

                <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                    <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
                    <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
                        <label className="md:col-span-2">
                            <span className="text-xs font-medium text-gray-700">Search</span>
                            <input
                                type="text"
                                value={searchText}
                                onChange={(event) => setSearchText(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                        event.preventDefault()
                                        handleApplyFilters()
                                    }
                                }}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                placeholder="Search by contact, role, status, session id, or preview"
                            />
                        </label>

                        <label>
                            <span className="text-xs font-medium text-gray-700">Role</span>
                            <select
                                value={selectedRole}
                                onChange={(event) => setSelectedRole(event.target.value)}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            >
                                <option value="all">All roles</option>
                                {roleOptions.map((role) => (
                                    <option key={role} value={role}>{role}</option>
                                ))}
                            </select>
                        </label>

                        <label>
                            <span className="text-xs font-medium text-gray-700">Status</span>
                            <select
                                value={selectedStatus}
                                onChange={(event) => setSelectedStatus(event.target.value)}
                                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                            >
                                <option value="all">All statuses</option>
                                {statusOptions.map((status) => (
                                    <option key={status} value={status}>{status}</option>
                                ))}
                            </select>
                        </label>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={handleApplyFilters}
                            disabled={loadingChats}
                            className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            Apply Filters
                        </button>
                        <button
                            type="button"
                            onClick={handleResetFilters}
                            disabled={loadingChats}
                            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            Reset
                        </button>
                    </div>
                </section>

                <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                        <h2 className="text-lg font-semibold text-gray-900">Chats</h2>
                        <span className="text-xs text-gray-500">{filteredChats.length} result(s)</span>
                    </div>

                    <div className="mt-4 space-y-3">
                        {loadingChats && (
                            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                                Loading chats...
                            </div>
                        )}

                        {!loadingChats && filteredChats.length === 0 && (
                            <div className="rounded-md border border-dashed border-gray-200 px-3 py-4 text-sm text-gray-500">
                                No chat sessions matched your current filters.
                            </div>
                        )}

                        {!loadingChats && filteredChats.map((chat) => (
                            <button
                                key={chat.id}
                                type="button"
                                onClick={() => router.push(`/admin/chat/${encodeURIComponent(String(chat.id))}`)}
                                className="w-full rounded-lg border border-gray-200 bg-white p-4 text-left hover:border-gray-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
                            >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-semibold text-gray-900">{chat.title || 'Chat session'}</p>
                                        <p className="mt-1 text-sm text-gray-600">{chat.summary || chat.preview || 'No summary available'}</p>
                                    </div>
                                    <div className="flex flex-col items-end gap-2">
                                        <span className="inline-flex items-center rounded-full border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700">
                                            {chat.role || 'Contact'}
                                        </span>
                                        <p className="text-xs text-gray-500">Updated {formatRelativeTime(chat.timestamp)}</p>
                                    </div>
                                </div>

                                <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2 text-xs text-gray-600">
                                    <div>
                                        <p className="font-medium text-gray-500">From</p>
                                        <p className="mt-0.5 text-gray-800">{chat.from || 'Unknown'}</p>
                                    </div>
                                    <div>
                                        <p className="font-medium text-gray-500">Status</p>
                                        <p className="mt-0.5 text-gray-800">{chat.status || 'unknown'}</p>
                                    </div>
                                    <div>
                                        <p className="font-medium text-gray-500">Messages</p>
                                        <p className="mt-0.5 text-gray-800">{Number.isFinite(chat.messageCount) ? chat.messageCount : 0}</p>
                                    </div>
                                    <div>
                                        <p className="font-medium text-gray-500">Updated</p>
                                        <p className="mt-0.5 text-gray-800">{formatRelativeTime(chat.timestamp)}</p>
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                </section>
            </main>
        </div>
    )
}