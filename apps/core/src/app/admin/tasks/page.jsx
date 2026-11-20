'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUpRight, Check, ChevronRight, ListTodo, RefreshCw, RotateCcw } from 'lucide-react'
import AdminHeader from '@/admin-ui/components/AdminHeader'
import AssistantAvatar from '@/admin-ui/components/AssistantAvatar'
import { TASK_KIND_ACCENTS, TASK_KIND_ICONS } from '@/admin-ui/components/taskKindTheme'
import { getCurrentUser, getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import { DEFAULT_DOMAIN_MODE, getEffectiveDomainMode } from '@/lib/domainMode'
import { isTasksPageFeatureEnabled } from '@/lib/domainFeatureFlags'
import { buildPatientTaskHref, summarizePatientTasks } from '@/lib/patientTasks'
import { readStoredDefaultDomain } from '@/lib/defaultDomainPreference'


/**
 * The queue is one list at two moments, so the page switches between "what is
 * waiting", "what this practice marked as done" and both, rather than growing a
 * second surface for the finished work.
 */
const TASK_FILTERS = [
    { key: 'waiting', label: 'Waiting' },
    { key: 'done', label: 'Done' },
    { key: 'all', label: 'All' },
]

function formatRelativeTime(isoString, now) {
    if (!isoString) return ''
    const timestamp = new Date(isoString).getTime()
    if (!Number.isFinite(timestamp)) return ''

    const diffMs = now - timestamp
    const minute = 60 * 1000
    const hour = 60 * minute
    const day = 24 * hour
    const formatUnit = (value, unit) => `${value} ${unit}${value === 1 ? '' : 's'} ago`

    if (diffMs < minute) return 'Just now'
    if (diffMs < hour) return formatUnit(Math.max(1, Math.floor(diffMs / minute)), 'minute')
    if (diffMs < day) return formatUnit(Math.max(1, Math.floor(diffMs / hour)), 'hour')
    return formatUnit(Math.max(1, Math.floor(diffMs / day)), 'day')
}

function patientLabel(group) {
    return group.patientName || `Patient #${group.patientId}`
}

/**
 * The heading of one group. A patient's group links to their record; the website
 * enquiries belong to the practice, so their heading is plain text.
 */
function GroupHeading({ group }) {
    const label = patientLabel(group)

    if (!group.patientId) {
        return <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-900">{label}</span>
    }

    return (
        <a
            href={buildPatientTaskHref(group.patientId)}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-900 hover:text-sky-700"
        >
            {label}
            <ArrowUpRight className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
        </a>
    )
}

/** The stored admin token as an Authorization header, or undefined when absent. */
function authHeader(token) {
    return token ? { Authorization: 'Bearer ' + token } : undefined
}

/**
 * Read the practice-wide queue. Returns the parsed payload, or an error message —
 * `enabled: false` is a valid answer (the domain has Tasks off), not a failure.
 */
async function fetchTasks(domainKey) {
    const token = window.localStorage.getItem('adminToken')
    const query = new URLSearchParams({ domain: domainKey })

    try {
        const response = await fetch(`/api/admin/tasks?${query.toString()}`, {
            mode: 'cors',
            cache: 'no-store',
            headers: authHeader(token),
        })
        const data = await response.json().catch(() => ({}))

        if (!response.ok || data?.success !== true) {
            return { error: String(data?.error || 'Failed to load tasks') }
        }

        return {
            enabled: data.enabled === true,
            groups: Array.isArray(data.groups) ? data.groups : [],
            dismissedItems: Array.isArray(data.dismissedItems) ? data.dismissedItems : [],
        }
    } catch {
        return { error: 'Failed to load tasks' }
    }
}

/** How many underlying records a set of queue rows stands for. */
function countTaskRecords(items) {
    return (Array.isArray(items) ? items : [])
        .reduce((sum, item) => sum + (Number(item?.count) || 0), 0)
}

export default function TasksAdminPage() {
    const router = useRouter()

    const [loading, setLoading] = useState(true)
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [activeDomain, setActiveDomain] = useState(DEFAULT_DOMAIN_MODE)
    const [groups, setGroups] = useState([])
    const [dismissedItems, setDismissedItems] = useState([])
    const [statusFilter, setStatusFilter] = useState('waiting')
    const [pendingItemKey, setPendingItemKey] = useState('')
    const [error, setError] = useState('')
    const [reloading, setReloading] = useState(false)
    const [refreshTicker, setRefreshTicker] = useState(() => Date.now())

    useEffect(() => {
        const intervalId = window.setInterval(() => setRefreshTicker(Date.now()), 60 * 1000)
        return () => window.clearInterval(intervalId)
    }, [])

    useEffect(() => {
        let cancelled = false

        async function loadTasks(domainKey) {
            const result = await fetchTasks(domainKey)
            if (cancelled) return

            if (result.error) {
                setError(result.error)
                setGroups([])
                setDismissedItems([])
                return
            }

            // A domain that has turned Tasks off since the page was opened has no
            // queue to show, so the visit falls back to the dashboard.
            if (!result.enabled) {
                router.replace('/admin')
                return
            }

            setError('')
            setGroups(result.groups)
            setDismissedItems(result.dismissedItems)
        }

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

                // The page only exists for a domain that turned Tasks on, so a direct
                // visit otherwise falls back to the main dashboard.
                if (!isTasksPageFeatureEnabled(settings, domainKey)) {
                    router.replace('/admin')
                    return
                }

                setIsAuthenticated(true)
                await loadTasks(domainKey)
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
    }, [router])

    /**
     * Reload the list after a dismissal or a restore. The server owns both lists —
     * what is still on it and what was cleared (see `taskEntries.js`) — so they come
     * back from one request rather than being patched here and drifting.
     */
    const reloadTasks = async () => {
        const result = await fetchTasks(activeDomain)

        if (result.error) {
            setError(result.error)
            return
        }

        if (!result.enabled) {
            router.replace('/admin')
            return
        }

        setError('')
        setGroups(result.groups)
        setDismissedItems(result.dismissedItems)
    }

    const handleRefresh = async () => {
        setReloading(true)
        try {
            await reloadTasks()
            setRefreshTicker(Date.now())
        } finally {
            setReloading(false)
        }
    }

    /** Mark one entry as done, or put it back in the queue. */
    const handleTaskAction = async (itemKey, action) => {
        if (!itemKey || pendingItemKey) return

        setPendingItemKey(itemKey)
        try {
            const token = window.localStorage.getItem('adminToken')
            const query = new URLSearchParams({ domain: activeDomain })
            const response = await fetch(`/api/admin/tasks?${query.toString()}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(authHeader(token) || {}) },
                body: JSON.stringify({ action, itemKey }),
            })
            const data = await response.json().catch(() => ({}))

            if (!response.ok || data?.success !== true) {
                setError(String(data?.error || 'Failed to update the task'))
                return
            }

            await reloadTasks()
        } catch {
            setError('Failed to update the task')
        } finally {
            setPendingItemKey('')
        }
    }

    const summary = useMemo(() => summarizePatientTasks(groups), [groups])
    const doneCount = countTaskRecords(dismissedItems)
    const waitingCount = summary.total
    const showWaiting = statusFilter !== 'done'
    const showDone = statusFilter !== 'waiting'

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-100">
                <p className="text-sm text-slate-500">Loading tasks...</p>
            </div>
        )
    }

    if (!isAuthenticated) {
        return null
    }

    return (
        <div className="min-h-screen bg-slate-100">
            <AdminHeader title="Tasks" brandingDomainKey={activeDomain} />

            <main className="mx-auto max-w-4xl px-4 py-8">
                <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                        <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm">
                            <ListTodo className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
                        </span>
                        <div>
                            <h1 className="text-xl font-bold tracking-tight text-gray-900">Tasks</h1>
                            <p className="mt-0.5 text-sm text-gray-600">{summary.summaryText}</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={handleRefresh}
                        disabled={reloading}
                        className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${reloading ? 'animate-spin' : ''}`} aria-hidden="true" />
                        Refresh
                    </button>
                </div>

                {error && (
                    <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
                )}

                <div className="mb-5 inline-flex rounded-lg border border-gray-200 bg-white p-0.5 shadow-sm" role="group" aria-label="Filter tasks">
                    {TASK_FILTERS.map((option) => {
                        const count = option.key === 'done'
                            ? doneCount
                            : option.key === 'waiting'
                                ? waitingCount
                                : waitingCount + doneCount
                        const isActive = statusFilter === option.key

                        return (
                            <button
                                key={option.key}
                                type="button"
                                onClick={() => setStatusFilter(option.key)}
                                aria-pressed={isActive}
                                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${isActive ? 'bg-slate-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                            >
                                {option.label}
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${isActive ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'}`}>
                                    {count}
                                </span>
                            </button>
                        )
                    })}
                </div>

                {!error && waitingCount + doneCount === 0 && (
                    <section className="rounded-lg border border-dashed border-gray-300 bg-white px-6 py-10 text-center">
                        <AssistantAvatar
                            domainKey={activeDomain}
                            iconClassName="mx-auto h-6 w-6 text-sky-600"
                            imageClassName="mx-auto h-6 w-6"
                        />
                        <h2 className="mt-3 text-sm font-semibold text-gray-900">Nothing is on your list</h2>
                        <p className="mt-1 text-xs text-gray-500">
                            Work drafted by your agents, and website enquiries, lands here as it happens and stays until somebody marks it done.
                        </p>
                    </section>
                )}

                {showWaiting && groups.length > 0 && (
                    <div className="space-y-5">
                        {groups.map((group) => {
                            const oldestLabel = formatRelativeTime(group.oldestCreatedAt, refreshTicker)

                            return (
                                <section
                                    key={group.groupKey || group.patientId}
                                    className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"
                                    aria-label={`Tasks for ${patientLabel(group)}`}
                                >
                                    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100 bg-gray-50/70 px-5 py-3">
                                        <GroupHeading group={group} />
                                        <span className="text-xs text-gray-500">
                                            {group.total} {group.total === 1 ? 'item' : 'items'}
                                            {oldestLabel ? ` · oldest ${oldestLabel}` : ''}
                                        </span>
                                    </div>

                                    <ul className="divide-y divide-gray-100">
                                        {group.items.map((item) => {
                                            const ItemIcon = TASK_KIND_ICONS[item.kind]
                                            const isPending = pendingItemKey === item.key

                                            return (
                                                <li key={item.key} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                                                    <div className="flex min-w-0 items-start gap-3">
                                                        {ItemIcon && (
                                                            <span className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${TASK_KIND_ACCENTS[item.kind] || 'bg-gray-100 text-gray-600'}`}>
                                                                <ItemIcon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                                                            </span>
                                                        )}
                                                        <div className="min-w-0">
                                                            <p className="flex flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700">
                                                                {item.workerLabel}
                                                                {item.isActioned && (
                                                                    <span
                                                                        className="rounded bg-gray-100 px-1.5 py-0.5 text-[9px] tracking-wide text-gray-500"
                                                                        title="Already dealt with on the record — mark it done to clear it from this list."
                                                                    >
                                                                        Actioned
                                                                    </span>
                                                                )}
                                                            </p>
                                                            <p className="mt-0.5 text-sm font-medium text-gray-900">{item.title}</p>
                                                            <p className="mt-0.5 text-xs text-gray-500">{item.detail}</p>
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-none items-center gap-1.5">
                                                        <a
                                                            href={item.href}
                                                            className="inline-flex items-center gap-1 rounded-md border border-sky-300 bg-sky-50 px-2.5 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100"
                                                        >
                                                            {item.actionLabel}
                                                            <ChevronRight className="h-3 w-3" aria-hidden="true" />
                                                        </a>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleTaskAction(item.key, 'dismiss')}
                                                            disabled={Boolean(pendingItemKey)}
                                                            title="Mark as done"
                                                            aria-label={`Mark ${item.title} as done`}
                                                            className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 disabled:opacity-50"
                                                        >
                                                            <Check className="h-3 w-3" aria-hidden="true" />
                                                            {isPending ? 'Saving...' : 'Done'}
                                                        </button>
                                                    </div>
                                                </li>
                                            )
                                        })}
                                    </ul>
                                </section>
                            )
                        })}
                    </div>
                )}

                {showWaiting && groups.length === 0 && waitingCount + doneCount > 0 && (
                    <p className="rounded-lg border border-dashed border-gray-300 bg-white px-5 py-8 text-center text-sm text-gray-500">
                        Nothing is on your list.
                    </p>
                )}

                {showDone && (
                    <section
                        className={`overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm ${showWaiting && waitingCount > 0 ? 'mt-5' : ''}`}
                        aria-label="Tasks marked as done"
                    >
                        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100 bg-gray-50/70 px-5 py-3">
                            <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                                <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                                Done
                            </h2>
                            <span className="text-xs text-gray-500">
                                {doneCount} {doneCount === 1 ? 'item' : 'items'} marked done
                            </span>
                        </div>

                        {dismissedItems.length === 0 ? (
                            <p className="px-5 py-8 text-center text-xs text-gray-500">
                                Nothing has been marked as done yet. Marking an item done clears it from the list without touching the record itself.
                            </p>
                        ) : (
                            <ul className="divide-y divide-gray-100">
                                {dismissedItems.map((item) => {
                                    const ItemIcon = TASK_KIND_ICONS[item.kind]
                                    const doneLabel = formatRelativeTime(item.dismissedAt, refreshTicker)
                                    const ownerLabel = item.patientName || (item.patientId ? `Patient #${item.patientId}` : '')

                                    return (
                                        <li key={item.key} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                                            <div className="flex min-w-0 items-start gap-3">
                                                {ItemIcon && (
                                                    <span className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md opacity-60 ${TASK_KIND_ACCENTS[item.kind] || 'bg-gray-100 text-gray-600'}`}>
                                                        <ItemIcon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                                                    </span>
                                                )}
                                                <div className="min-w-0">
                                                    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                                                        {[item.workerLabel, ownerLabel].filter(Boolean).join(' · ')}
                                                    </p>
                                                    <p className="mt-0.5 text-sm font-medium text-gray-900">{item.title}</p>
                                                    <p className="mt-0.5 text-xs text-gray-500">
                                                        Done {doneLabel || 'recently'}{item.dismissedBy ? ` by ${item.dismissedBy}` : ''}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex flex-none items-center gap-1.5">
                                                <button
                                                    type="button"
                                                    onClick={() => handleTaskAction(item.key, 'restore')}
                                                    disabled={Boolean(pendingItemKey)}
                                                    className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                                >
                                                    <RotateCcw className="h-3 w-3" aria-hidden="true" />
                                                    {pendingItemKey === item.key ? 'Restoring...' : 'Restore'}
                                                </button>
                                                {item.href && (
                                                    <a
                                                        href={item.href}
                                                        className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                                    >
                                                        Open
                                                        <ChevronRight className="h-3 w-3" aria-hidden="true" />
                                                    </a>
                                                )}
                                            </div>
                                        </li>
                                    )
                                })}
                            </ul>
                        )}
                    </section>
                )}
            </main>
        </div>
    )
}
