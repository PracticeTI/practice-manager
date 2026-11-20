'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUpRight, Wrench } from 'lucide-react'
import AdminHeader from '@/admin-ui/components/AdminHeader'
import { TOOL_CARD_ACCENTS, TOOL_CARD_ICONS } from '@/admin-ui/components/toolCardTheme'
import { getCurrentUser, getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import { DEFAULT_DOMAIN_MODE, getEffectiveDomainMode } from '@/lib/domainMode'
import { filterRecentContentUpdates } from '@/lib/adminDashboardUtils'
import { isToolsPageFeatureEnabled } from '@/lib/domainFeatureFlags'
import { buildAdminToolsCards } from '@/lib/adminToolsCards'
import { readStoredDefaultDomain } from '@/lib/defaultDomainPreference'


// The card icons and colours come from `src/admin-ui/components/toolCardTheme.js`,
// which the Admin dashboard's Tools card also reads, so a card and its shortcut
// cannot drift. The card shapes stay in src/lib/adminToolsCards.js, free of React
// imports.
//
// The Tools cards deliberately read differently from the main Admin dashboard
// cards: a coloured accent rail, tinted header band and "Tool" eyebrow against
// the plain white, borderless-heading dashboard cards.

const TOOL_CARD_PREVIEW_LIMIT = 3

function formatRelativeTime(isoString, now) {
    if (!isoString) return 'Unknown time'
    const timestamp = new Date(isoString).getTime()
    if (!Number.isFinite(timestamp)) return 'Unknown time'

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

export default function ToolsAdminPage() {
    const router = useRouter()

    const [loading, setLoading] = useState(true)
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [activeDomain, setActiveDomain] = useState(DEFAULT_DOMAIN_MODE)
    const [recentContentUpdates, setRecentContentUpdates] = useState([])
    const [recentRecyclingItems, setRecentRecyclingItems] = useState([])
    const [recentAuditActivities, setRecentAuditActivities] = useState([])
    const [recyclingEnabled, setRecyclingEnabled] = useState(false)
    const [refreshTicker, setRefreshTicker] = useState(() => Date.now())

    useEffect(() => {
        const intervalId = window.setInterval(() => setRefreshTicker(Date.now()), 60 * 1000)
        return () => window.clearInterval(intervalId)
    }, [])

    useEffect(() => {
        let cancelled = false

        async function loadTools({ domainKey, recyclingEnabledForDomain }) {
            const token = window.localStorage.getItem('adminToken')
            const authHeaders = token ? { Authorization: `Bearer ${token}` } : undefined

            const recentActivityResponse = await fetch(`/api/database/recent-activity?domain=${encodeURIComponent(domainKey)}`, {
                mode: 'cors',
                cache: 'no-cache',
                headers: authHeaders,
            })
            const recentActivityData = await recentActivityResponse.json().catch(() => ({}))
            if (cancelled) return

            setRecentContentUpdates(recentActivityResponse.ok
                ? filterRecentContentUpdates(recentActivityData?.contentUpdates)
                : [])

            const activitiesQuery = new URLSearchParams({ limit: String(TOOL_CARD_PREVIEW_LIMIT), domain: domainKey })
            const activitiesResponse = await fetch(`/api/database/activities?${activitiesQuery.toString()}`, {
                mode: 'cors',
                cache: 'no-cache',
                headers: authHeaders,
            })
            const activitiesData = await activitiesResponse.json().catch(() => ({}))
            if (cancelled) return

            setRecentAuditActivities(activitiesResponse.ok && activitiesData?.success && Array.isArray(activitiesData?.data)
                ? activitiesData.data.slice(0, TOOL_CARD_PREVIEW_LIMIT)
                : [])

            // Recycling is the one Tools card still gated by a domain flag, so skip the
            // request entirely when it is off rather than loading data nobody sees.
            if (!recyclingEnabledForDomain) {
                setRecentRecyclingItems([])
                return
            }

            const recyclingQuery = new URLSearchParams({ limit: String(TOOL_CARD_PREVIEW_LIMIT), domain: domainKey })
            const recyclingResponse = await fetch(`/api/database/recycling?${recyclingQuery.toString()}`, {
                mode: 'cors',
                cache: 'no-cache',
                headers: authHeaders,
            })
            const recyclingData = await recyclingResponse.json().catch(() => ({}))
            if (cancelled) return

            setRecentRecyclingItems(recyclingResponse.ok && Array.isArray(recyclingData?.data)
                ? recyclingData.data.slice(0, TOOL_CARD_PREVIEW_LIMIT)
                : [])
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
                    headers: { Authorization: `Bearer ${token}` },
                    cache: 'no-store',
                })
                const settingsData = await settingsResponse.json().catch(() => ({}))
                if (cancelled) return

                const settings = settingsData?.domains?.[domainKey] || {}
                const recyclingEnabledForDomain = settings?.recyclingEnabled === true

                // The page only exists for a domain that turned Tools on, so a direct
                // visit otherwise falls back to the main dashboard.
                if (!isToolsPageFeatureEnabled(settings, domainKey)) {
                    router.replace('/admin')
                    return
                }

                setRecyclingEnabled(recyclingEnabledForDomain)
                setIsAuthenticated(true)

                await loadTools({ domainKey, recyclingEnabledForDomain })
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

    const cards = useMemo(() => buildAdminToolsCards({
        recentContentUpdates,
        recentRecyclingItems,
        recentAuditActivities,
        recyclingEnabled,
        formatRelativeTime: (isoString) => formatRelativeTime(isoString, refreshTicker),
    }), [recentContentUpdates, recentRecyclingItems, recentAuditActivities, recyclingEnabled, refreshTicker])

    const visibleCards = cards.filter((card) => card.enabled)

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-100">
                <p className="text-sm text-slate-500">Loading tools...</p>
            </div>
        )
    }

    if (!isAuthenticated) {
        return null
    }

    return (
        <div className="min-h-screen bg-slate-100">
            <AdminHeader title="Tools" brandingDomainKey={activeDomain} />

            <main className="mx-auto max-w-7xl px-4 py-8">
                <div className="mb-6 flex items-start gap-3">
                    <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm">
                        <Wrench className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
                    </span>
                    <div>
                        <h1 className="text-xl font-bold tracking-tight text-gray-900">Tools</h1>
                        <p className="text-sm text-gray-600">
                            Maintenance and content surfaces for {activeDomain}, kept separate from the main Admin dashboard.
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
                    {visibleCards.map((card) => {
                        const Icon = TOOL_CARD_ICONS[card.key]
                        const accent = TOOL_CARD_ACCENTS[card.key]
                        const previewItems = card.items.slice(0, TOOL_CARD_PREVIEW_LIMIT)

                        return (
                            <article
                                key={card.key}
                                className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_12px_30px_-24px_rgba(15,23,42,0.5)] transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_18px_36px_-24px_rgba(15,23,42,0.45)]"
                            >
                                <span className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${accent.rail}`} aria-hidden="true" />

                                <div className={`flex items-start gap-3 bg-gradient-to-r ${accent.band} to-white px-5 pb-4 pt-6`}>
                                    <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white shadow-sm ${accent.tile}`}>
                                        {Icon && <Icon className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${accent.eyebrow}`}>Tool</p>
                                        <h2 className="truncate text-base font-semibold text-slate-900">{card.title}</h2>
                                    </div>
                                </div>

                                <p className="px-5 text-xs leading-relaxed text-slate-600">{card.description}</p>

                                <div className="mt-4 flex-1 px-5">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{card.recentLabel}</p>
                                    <div className="mt-2 space-y-1.5">
                                        {previewItems.map((item) => (
                                            <a
                                                key={item.key}
                                                href={item.href}
                                                className="block rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 transition-colors hover:border-slate-300 hover:bg-white"
                                            >
                                                <span className="block truncate text-sm font-medium text-slate-900">{item.primary}</span>
                                                <span className="mt-0.5 block truncate text-xs text-slate-500">{item.secondary}</span>
                                            </a>
                                        ))}

                                        {previewItems.length === 0 && (
                                            <p className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-500">
                                                {card.emptyLabel}
                                            </p>
                                        )}
                                    </div>
                                </div>

                                <div className="mt-5 border-t border-slate-100 px-5 py-3">
                                    <button
                                        type="button"
                                        onClick={() => router.push(card.actionHref)}
                                        className="inline-flex w-full items-center justify-between text-sm font-medium text-slate-700 transition-colors hover:text-slate-900"
                                    >
                                        <span>Open {card.title}</span>
                                        <ArrowUpRight className={`h-4 w-4 ${accent.arrow}`} aria-hidden="true" />
                                    </button>
                                </div>
                            </article>
                        )
                    })}
                </div>
            </main>
        </div>
    )
}
