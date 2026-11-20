'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Loader2, MoreVertical, RefreshCw, Trash2 } from 'lucide-react'

const PROVIDER_LABELS = {
    google: 'Google Calendar',
    microsoft: 'Microsoft 365',
}

const CALENDAR_PROVIDERS = Object.keys(PROVIDER_LABELS)

function formatSyncedAt(value) {
    if (!value) return 'never'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return 'never'
    return new Intl.DateTimeFormat('en-AU', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(date)
}

export default function CalendarConnectionsPanel({
    domain,
    practitioners = [],
    getAuthHeaders,
    onChanged,
}) {
    const [practitionerId, setPractitionerId] = useState(() => String(practitioners[0]?.id || ''))
    const [connections, setConnections] = useState([])
    const [providers, setProviders] = useState({})
    const [loading, setLoading] = useState(false)
    const [busyProvider, setBusyProvider] = useState('')
    const [message, setMessage] = useState('')

    // Sync and disconnect live behind the card menu: they are occasional
    // maintenance actions rather than part of the day-to-day overview.
    const [openMenuProvider, setOpenMenuProvider] = useState('')
    const menuRef = useRef(null)

    useEffect(() => {
        if (!openMenuProvider) return undefined

        const handlePointerDown = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                setOpenMenuProvider('')
            }
        }
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                setOpenMenuProvider('')
            }
        }

        document.addEventListener('mousedown', handlePointerDown)
        document.addEventListener('keydown', handleKeyDown)
        return () => {
            document.removeEventListener('mousedown', handlePointerDown)
            document.removeEventListener('keydown', handleKeyDown)
        }
    }, [openMenuProvider])

    const effectivePractitionerId = practitionerId || String(practitioners[0]?.id || '')

    const load = useCallback(async () => {
        if (!domain || !effectivePractitionerId) return
        const headers = await getAuthHeaders()
        const query = new URLSearchParams({ domain, practitioner_id: effectivePractitionerId })
        const response = await fetch(`/api/database/calendar-connections?${query.toString()}`, {
            headers,
            cache: 'no-store',
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
            throw new Error(data?.error || 'Failed to load calendar connections')
        }
        setConnections(Array.isArray(data?.data) ? data.data : [])
        setProviders(data?.providers || {})
    }, [domain, effectivePractitionerId, getAuthHeaders])

    useEffect(() => {
        let cancelled = false

        async function run() {
            if (!domain || !effectivePractitionerId) return
            const headers = await getAuthHeaders()
            if (cancelled) return
            setLoading(true)
            try {
                const query = new URLSearchParams({ domain, practitioner_id: effectivePractitionerId })
                const response = await fetch(`/api/database/calendar-connections?${query.toString()}`, {
                    headers,
                    cache: 'no-store',
                })
                const data = await response.json().catch(() => ({}))
                if (!response.ok) {
                    throw new Error(data?.error || 'Failed to load calendar connections')
                }
                if (cancelled) return
                setConnections(Array.isArray(data?.data) ? data.data : [])
                setProviders(data?.providers || {})
            } catch (error) {
                if (!cancelled) setMessage(error?.message || 'Failed to load calendar connections')
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        run()
        return () => {
            cancelled = true
        }
    }, [domain, effectivePractitionerId, getAuthHeaders])

    const byProvider = useMemo(() => {
        const map = {}
        connections.forEach((connection) => {
            map[connection.provider] = connection
        })
        return map
    }, [connections])

    const connect = useCallback(async (provider) => {
        if (!domain || !effectivePractitionerId) return
        setBusyProvider(provider)
        setMessage('')
        try {
            const headers = await getAuthHeaders()
            const query = new URLSearchParams({
                domain,
                practitioner_id: effectivePractitionerId,
                format: 'json',
            })
            const response = await fetch(
                `/api/scheduling/calendar/oauth/${provider}/start?${query.toString()}`,
                { headers, cache: 'no-store' }
            )
            const data = await response.json().catch(() => ({}))
            if (!response.ok || !data?.authUrl) {
                throw new Error(data?.error || 'Failed to start calendar authorisation')
            }
            window.location.assign(data.authUrl)
        } catch (error) {
            setMessage(error?.message || 'Failed to start calendar authorisation')
            setBusyProvider('')
        }
    }, [domain, effectivePractitionerId, getAuthHeaders])

    const sync = useCallback(async (connection) => {
        setOpenMenuProvider('')
        setBusyProvider(connection.provider)
        setMessage('')
        try {
            const headers = await getAuthHeaders()
            const query = new URLSearchParams({ domain })
            const response = await fetch(
                `/api/database/calendar-connections/${connection.id}/sync?${query.toString()}`,
                { method: 'POST', headers }
            )
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data?.error || 'Calendar sync failed')
            setMessage(`${PROVIDER_LABELS[connection.provider]} synced ${data?.data?.blocks ?? 0} busy block(s).`)
            await load()
            onChanged?.()
        } catch (error) {
            setMessage(error?.message || 'Calendar sync failed')
        } finally {
            setBusyProvider('')
        }
    }, [domain, getAuthHeaders, load, onChanged])

    const disconnect = useCallback(async (connection) => {
        setOpenMenuProvider('')
        if (typeof window !== 'undefined'
            && !window.confirm(`Disconnect ${PROVIDER_LABELS[connection.provider]}?`)) {
            return
        }
        setBusyProvider(connection.provider)
        setMessage('')
        try {
            const headers = await getAuthHeaders()
            const query = new URLSearchParams({ domain })
            const response = await fetch(
                `/api/database/calendar-connections/${connection.id}?${query.toString()}`,
                { method: 'DELETE', headers }
            )
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data?.error || 'Failed to disconnect calendar')
            setMessage(`${PROVIDER_LABELS[connection.provider]} disconnected.`)
            await load()
            onChanged?.()
        } catch (error) {
            setMessage(error?.message || 'Failed to disconnect calendar')
        } finally {
            setBusyProvider('')
        }
    }, [domain, getAuthHeaders, load, onChanged])

    const configuredProviders = CALENDAR_PROVIDERS.filter(
        (provider) => (providers[provider] || {}).configured !== false
    )
    const hasConnections = connections.length > 0
    // Until something is connected, configured services are offered as onboarding.
    // Once a calendar is connected, the other services step back to a quiet link so a
    // practice that only uses one calendar provider is not nudged towards the other.
    const cardProviders = CALENDAR_PROVIDERS.filter(
        (provider) => byProvider[provider] || (!hasConnections && configuredProviders.includes(provider))
    )
    const otherProviders = hasConnections
        ? configuredProviders.filter((provider) => !byProvider[provider])
        : []

    if (practitioners.length === 0) return null

    return (
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
                        <CalendarDays className="h-4 w-4 text-gray-500" aria-hidden="true" />
                        Connected calendars
                    </h2>
                    <p className="mt-1 text-xs text-gray-500">
                        Busy time from personal calendars blocks bookable slots. Patient details are never written back.
                    </p>
                </div>
                <select
                    value={effectivePractitionerId}
                    onChange={(event) => setPractitionerId(event.target.value)}
                    className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                    aria-label="Practitioner"
                >
                    {practitioners.map((practitioner) => (
                        <option key={practitioner.id} value={practitioner.id}>
                            {practitioner.display_name}
                        </option>
                    ))}
                </select>
            </div>

            {message && (
                <p className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                    {message}
                </p>
            )}

            <div className="mt-4 grid gap-3 md:grid-cols-2">
                {cardProviders.map((provider) => {
                    const connection = byProvider[provider]
                    const busy = busyProvider === provider

                    return (
                        <div key={provider} className="rounded-md border border-gray-200 p-4">
                            <div className="flex items-start justify-between gap-2">
                                <div>
                                    <h3 className="text-sm font-semibold text-gray-900">{PROVIDER_LABELS[provider]}</h3>
                                    {connection && (
                                        <p className="mt-1 text-xs text-gray-600">
                                            {connection.external_account_email || 'Connected'}
                                            <span className="block text-gray-400">
                                                Last synced {formatSyncedAt(connection.last_synced_at)}
                                            </span>
                                        </p>
                                    )}
                                </div>
                                {connection && (
                                    <div className="flex shrink-0 items-center gap-1.5">
                                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${connection.status === 'error' ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'}`}>
                                            {connection.status === 'error' ? 'Sync error' : 'Connected'}
                                        </span>
                                        <div
                                            className="relative"
                                            ref={openMenuProvider === provider ? menuRef : null}
                                        >
                                            <button
                                                type="button"
                                                onClick={() => setOpenMenuProvider((current) => (current === provider ? '' : provider))}
                                                disabled={busy}
                                                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-60"
                                                aria-label={`${PROVIDER_LABELS[provider]} settings`}
                                                aria-haspopup="menu"
                                                aria-expanded={openMenuProvider === provider}
                                                title="Calendar settings"
                                            >
                                                {busy
                                                    ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                                    : <MoreVertical className="h-4 w-4" strokeWidth={2} aria-hidden="true" />}
                                            </button>

                                            {openMenuProvider === provider && (
                                                <div
                                                    role="menu"
                                                    aria-label={`${PROVIDER_LABELS[provider]} settings`}
                                                    className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-left shadow-lg"
                                                >
                                                    <button
                                                        type="button"
                                                        role="menuitem"
                                                        onClick={() => sync(connection)}
                                                        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                                    >
                                                        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                                                        Sync now
                                                    </button>
                                                    <button
                                                        type="button"
                                                        role="menuitem"
                                                        onClick={() => disconnect(connection)}
                                                        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50"
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                                        Disconnect
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {connection?.last_sync_error && (
                                <p className="mt-2 text-xs text-red-700">{connection.last_sync_error}</p>
                            )}

                            {!connection && (
                                <div className="mt-3">
                                    <button
                                        type="button"
                                        onClick={() => connect(provider)}
                                        disabled={busy}
                                        className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {busy ? 'Connecting…' : 'Connect'}
                                    </button>
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>

            {!hasConnections && configuredProviders.length === 0 && (
                <div className="mt-4 rounded-md border border-dashed border-gray-200 px-3 py-2 text-xs text-gray-500">
                    <p className="font-medium text-gray-600">No calendar service is configured yet.</p>
                    <ul className="mt-1 list-disc pl-4">
                        {CALENDAR_PROVIDERS.map((provider) => (
                            <li key={provider}>
                                {PROVIDER_LABELS[provider]}: {(providers[provider] || {}).reason || 'Not configured'}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {otherProviders.length > 0 && (
                <p className="mt-3 text-xs text-gray-500">
                    Use another calendar as well?{' '}
                    {otherProviders.map((provider, index) => (
                        <span key={provider}>
                            {index > 0 && ' · '}
                            <button
                                type="button"
                                onClick={() => connect(provider)}
                                className="font-medium text-gray-600 underline underline-offset-2 hover:text-gray-900"
                            >
                                Connect {PROVIDER_LABELS[provider]}
                            </button>
                        </span>
                    ))}
                </p>
            )}

            {loading && (
                <p className="mt-3 text-xs text-gray-500">Refreshing connections…</p>
            )}
        </section>
    )
}
