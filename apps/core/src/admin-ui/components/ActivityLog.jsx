'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import {
    ACTIVITY_ACTIONS,
    ACTIVITY_ENTITY_TYPES,
    activityActionLabel,
    activityEntityLabel,
    buildActivityDeepLink,
} from '@/lib/activityDisplay'

const PAGE_SIZE = 100

const ACTOR_TYPE_OPTIONS = [
    { value: 'all', label: 'People and agents' },
    { value: 'human', label: 'People' },
    { value: 'agent', label: 'Agents' },
    { value: 'system', label: 'System' },
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

function formatTimestamp(isoString) {
    if (!isoString) return 'Unknown time'
    const date = new Date(isoString)
    if (Number.isNaN(date.getTime())) return 'Unknown time'
    return date.toLocaleString()
}

function actionBadgeClass(action) {
    if (action === 'create') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
    if (action === 'update') return 'bg-blue-50 text-blue-700 border-blue-200'
    if (action === 'delete') return 'bg-red-50 text-red-700 border-red-200'
    if (action === 'import') return 'bg-purple-50 text-purple-700 border-purple-200'
    return 'bg-gray-50 text-gray-700 border-gray-200'
}

function actorBadgeClass(actorType) {
    if (actorType === 'agent') return 'bg-indigo-50 text-indigo-700 border-indigo-200'
    if (actorType === 'human') return 'bg-gray-50 text-gray-700 border-gray-200'
    return 'bg-amber-50 text-amber-700 border-amber-200'
}

/**
 * The audit-trail browser. Owns filtering, paging and rendering so the
 * domain-scoped admin page and the superadmin settings page share one
 * implementation; the callers only decide which endpoint to read and whether to
 * expose the cross-domain filter.
 *
 * The admin session lives in localStorage, so the component resolves its own
 * token (the same way every `/admin` page does) rather than taking one as a prop.
 */
export default function ActivityLog({
    endpoint = '/api/database/activities',
    baseParams = null,
    showDomainFilter = false,
    title = 'Activities',
    description = null,
}) {
    const router = useRouter()

    const [token, setToken] = useState('')
    const [activities, setActivities] = useState([])
    const [domains, setDomains] = useState([])
    const [total, setTotal] = useState(0)
    const [offset, setOffset] = useState(0)
    const [loading, setLoading] = useState(false)
    const [statusMessage, setStatusMessage] = useState('')
    const [statusTone, setStatusTone] = useState('neutral')

    const [domainFilter, setDomainFilter] = useState('all')
    const [entityFilter, setEntityFilter] = useState('all')
    const [actionFilter, setActionFilter] = useState('all')
    const [actorFilter, setActorFilter] = useState('all')

    // Serialised so callers can pass an object literal without re-triggering fetches.
    const baseParamsKey = JSON.stringify(baseParams || {})

    useEffect(() => {
        let cancelled = false

        getOrCreateAdminTokenForLocalhost()
            .then((resolvedToken) => {
                if (!cancelled) setToken(resolvedToken || '')
            })
            .catch(() => {
                if (!cancelled) setToken('')
            })

        return () => { cancelled = true }
    }, [])

    const load = useCallback(async (nextOffset = 0) => {
        if (!token) return

        setLoading(true)
        try {
            const base = JSON.parse(baseParamsKey)
            const query = new URLSearchParams({ ...base, limit: String(PAGE_SIZE), offset: String(nextOffset) })
            if (showDomainFilter && domainFilter !== 'all') query.set('domain', domainFilter)
            if (entityFilter !== 'all') query.set('entity_type', entityFilter)
            if (actionFilter !== 'all') query.set('action', actionFilter)
            if (actorFilter !== 'all') query.set('actor_type', actorFilter)

            const response = await fetchWithTimeout(`${endpoint}?${query.toString()}`, {
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store',
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok || !data?.success) {
                throw new Error(data?.error || 'Failed to load activities')
            }

            setActivities(Array.isArray(data?.data) ? data.data : [])
            setTotal(Number(data?.total) || 0)
            setOffset(nextOffset)
            if (Array.isArray(data?.domains)) setDomains(data.domains)
            setStatusMessage('')
            setStatusTone('neutral')
        } catch (error) {
            setActivities([])
            setTotal(0)
            setStatusMessage(error?.message || 'Failed to load activities')
            setStatusTone('error')
        } finally {
            setLoading(false)
        }
    }, [token, endpoint, baseParamsKey, showDomainFilter, domainFilter, entityFilter, actionFilter, actorFilter])

    useEffect(() => {
        if (!token) return undefined

        // `load` flips the loading flag before its first await, so kick it off from a
        // microtask: state updates must not run synchronously inside an effect body.
        let cancelled = false
        Promise.resolve().then(() => {
            if (!cancelled) return load(0)
            return undefined
        })

        return () => { cancelled = true }
    }, [token, load])

    const rows = useMemo(() => activities.map((activity) => ({
        ...activity,
        href: activity.deep_link || buildActivityDeepLink(activity.entity_type, activity.entity_id, { patientId: activity.patient_id }),
    })), [activities])

    const resetFilters = () => {
        setDomainFilter('all')
        setEntityFilter('all')
        setActionFilter('all')
        setActorFilter('all')
    }

    const hasPrev = offset > 0
    const hasNext = offset + activities.length < total

    if (!token) {
        return (
            <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                <p className="text-sm text-gray-600">Loading activities...</p>
            </section>
        )
    }

    return (
        <>
            <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
                        {description && <p className="mt-1 text-sm text-gray-600">{description}</p>}
                    </div>
                    <button
                        type="button"
                        onClick={() => load(offset)}
                        disabled={loading}
                        className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {loading ? 'Refreshing...' : 'Refresh'}
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

                <div className={`mt-6 grid grid-cols-1 gap-3 ${showDomainFilter ? 'md:grid-cols-5' : 'md:grid-cols-4'}`}>
                    {showDomainFilter && (
                        <label>
                            <span className="text-xs font-medium text-gray-700">Domain</span>
                            <select
                                value={domainFilter}
                                onChange={(event) => setDomainFilter(event.target.value)}
                                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                            >
                                <option value="all">All domains</option>
                                {domains.map((domain) => (
                                    <option key={domain} value={domain}>{domain}</option>
                                ))}
                            </select>
                        </label>
                    )}

                    <label>
                        <span className="text-xs font-medium text-gray-700">Entity</span>
                        <select
                            value={entityFilter}
                            onChange={(event) => setEntityFilter(event.target.value)}
                            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                        >
                            <option value="all">All entities</option>
                            {ACTIVITY_ENTITY_TYPES.map((entityType) => (
                                <option key={entityType} value={entityType}>{activityEntityLabel(entityType)}</option>
                            ))}
                        </select>
                    </label>

                    <label>
                        <span className="text-xs font-medium text-gray-700">Action</span>
                        <select
                            value={actionFilter}
                            onChange={(event) => setActionFilter(event.target.value)}
                            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                        >
                            <option value="all">All actions</option>
                            {ACTIVITY_ACTIONS.map((action) => (
                                <option key={action} value={action}>{activityActionLabel(action)}</option>
                            ))}
                        </select>
                    </label>

                    <label>
                        <span className="text-xs font-medium text-gray-700">Actor</span>
                        <select
                            value={actorFilter}
                            onChange={(event) => setActorFilter(event.target.value)}
                            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                        >
                            {ACTOR_TYPE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </label>

                    <div className="flex items-end">
                        <button
                            type="button"
                            onClick={resetFilters}
                            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                            Reset filters
                        </button>
                    </div>
                </div>
            </section>

            <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
                {rows.length === 0 ? (
                    <div className="p-6">
                        <p className="text-sm text-gray-600">
                            {loading ? 'Loading activities...' : 'No activities recorded yet.'}
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">When</th>
                                    {showDomainFilter && (
                                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Domain</th>
                                    )}
                                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Actor</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Action</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Record</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Patient</th>
                                    <th className="px-4 py-3" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 bg-white">
                                {rows.map((activity) => (
                                    <tr key={activity.id} className="hover:bg-gray-50">
                                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                                            {formatTimestamp(activity.created_at)}
                                        </td>
                                        {showDomainFilter && (
                                            <td className="whitespace-nowrap px-4 py-3 text-sm">
                                                <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-700">
                                                    {activity.domain}
                                                </span>
                                            </td>
                                        )}
                                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium">{activity.actor_name || 'Unknown'}</span>
                                                <span className={`rounded-full border px-2 py-0.5 text-xs capitalize ${actorBadgeClass(activity.actor_type)}`}>
                                                    {activity.actor_type}
                                                </span>
                                            </div>
                                            {activity.actor_role && (
                                                <div className="text-xs text-gray-500">{activity.actor_role}</div>
                                            )}
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-3 text-sm">
                                            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${actionBadgeClass(activity.action)}`}>
                                                {activityActionLabel(activity.action) || activity.action}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-sm text-gray-900">
                                            <div className="font-medium">{activity.entity_label || activityEntityLabel(activity.entity_type) || activity.entity_type}</div>
                                            <div className="text-xs text-gray-500">
                                                {activityEntityLabel(activity.entity_type) || activity.entity_type}
                                                {activity.entity_id ? ` #${activity.entity_id}` : ''}
                                                {activity.summary ? ` · ${activity.summary}` : ''}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-sm text-gray-700">
                                            {activity.patient_name || (activity.patient_id ? `Patient #${activity.patient_id}` : '—')}
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-3 text-right text-sm">
                                            <button
                                                type="button"
                                                onClick={() => activity.href && router.push(activity.href)}
                                                disabled={!activity.href}
                                                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                Open record
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-4 py-3">
                    <p className="text-xs text-gray-600">
                        {total === 0
                            ? 'No results'
                            : `Showing ${offset + 1}–${offset + rows.length} of ${total}`}
                    </p>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => load(Math.max(offset - PAGE_SIZE, 0))}
                            disabled={!hasPrev || loading}
                            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Newer
                        </button>
                        <button
                            type="button"
                            onClick={() => load(offset + PAGE_SIZE)}
                            disabled={!hasNext || loading}
                            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Older
                        </button>
                    </div>
                </div>
            </section>
        </>
    )
}
