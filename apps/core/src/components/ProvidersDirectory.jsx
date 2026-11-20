'use client'

import { Suspense, forwardRef, useCallback, useDeferredValue, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { ChevronDown, ExternalLink } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
    EMPTY_PROVIDER,
    PROVIDER_BOOLEAN_FIELDS,
    PROVIDER_LIST_FIELDS,
    PROFESSION_ALIASES,
    providerSearchScore,
    matchesProviderField,
    matchesProviderFilters,
    normalizeProvider,
    normalizeProfession,
} from '@/lib/providersDirectory'
import { getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import { PROVIDER_HERO_ASPECT_RATIO, providerHeroHostname } from '@/lib/providerHeroPreview'
import {
    ALLIED_HEALTH_ENQUIRIES_EMAIL,
    AlliedHealthBrandBar,
    AlliedHealthPageHero,
    AlliedHealthUtilityBar,
    FOCUS_RING,
    PAGE_WASH,
} from '@/components/AlliedHealthShell'

const FIELD_LABELS = {
    provider: 'Provider', description: 'Description',
    professions: 'Profession', service_types: 'Service types', age_groups: 'Age groups served',
    ndis_status: 'NDIS', funding: 'Funding', geography: 'Geography', languages_spoken: 'Languages spoken',
    telehealth: 'Telehealth', home_visits: 'Home visits', bulk_billing: 'Bulk billing',
    accepting_new_clients: 'Accepting new clients', referral_required: 'Referral required',
    registration_body: 'Registration body', typical_wait_time: 'Typical wait time',
    website_url: 'Website', email: 'Email', phone: 'Phone', last_verified_at: 'Last verified', status: 'Status',
}

const FORM_ROWS = [
    ['professions', 'service_types'], ['age_groups', 'geography'], ['ndis_status', 'funding'],
    ['languages_spoken', 'registration_body'], ['typical_wait_time', 'website_url'],
    ['email', 'phone'], ['last_verified_at', 'status'],
]

const PROFESSION_SHORT_CODES = Object.fromEntries(Object.entries(PROFESSION_ALIASES).map(([key, value]) => [value, key]))

// `typical_wait_time` is VARCHAR(120) and the values were written without a length guard, so a value
// sitting exactly on the limit was cut mid-word ("…early childhood sup"). A trailing ellipsis says so
// instead of letting the fragment read as a typo. Nothing shorter than the limit was touched by it.
const WAIT_TIME_MAX_LENGTH = 120
const ALL_FIELD_OPTIONS = ['provider', 'description', ...PROVIDER_LIST_FIELDS, 'ndis_status', ...PROVIDER_BOOLEAN_FIELDS,
    'registration_body', 'typical_wait_time', 'website_url', 'email', 'phone', 'last_verified_at', 'status']

function listText(value) {
    return Array.isArray(value) ? value.join(', ') : String(value || '')
}

function getInitials(name) {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) return '?'
    return words.slice(0, 2).map((word) => word[0].toUpperCase()).join('')
}

// Google's favicon service falls back to a fixed 16x16 generic globe icon for domains
// without a real favicon; treat any image that small as "no logo" and show initials instead.
function ProviderLogo({ name, logoUrl, size = 32 }) {
    const [failed, setFailed] = useState(false)
    const showImage = Boolean(logoUrl) && !failed
    const style = { width: size, height: size }
    if (!showImage) {
        return (
            <div style={style} className="flex shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                {getInitials(name)}
            </div>
        )
    }
    return (
        <Image
            src={logoUrl}
            alt=""
            width={size}
            height={size}
            unoptimized
            style={style}
            className="shrink-0 rounded-lg border border-slate-200 bg-white object-contain"
            onLoad={(event) => { if (event.currentTarget.naturalWidth <= 16 && event.currentTarget.naturalHeight <= 16) setFailed(true) }}
            onError={() => setFailed(true)}
        />
    )
}

/**
 * Human-approved capture for a provider's website, filling the bottom-right quadrant of a card.
 *
 * The approved images are the same 3:4 mobile captures the review page shows edge to edge, so the box
 * keeps that aspect ratio and takes its width from its grid cell — that way it stays a quadrant of the
 * card at any width rather than being a fixed size that only works at one breakpoint. `self-end`
 * anchors it to the bottom of that cell (grid would otherwise stretch it), so the capture sits flush
 * with the card's bottom-right corner even on the cards where the facts column is the taller one.
 * Callers only pass a URL the manifest vouches for, but the file can still have been removed since, so
 * a failed load hides the capture instead of leaving a broken frame.
 */
function ProviderCardHero({ url, name, websiteUrl }) {
    const [failed, setFailed] = useState(false)
    if (failed) return null
    return (
        <div
            style={{ aspectRatio: PROVIDER_HERO_ASPECT_RATIO }}
            className="relative w-full self-end overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
        >
            <Image
                src={url}
                alt={`Website preview of ${name}`}
                fill
                sizes="(min-width: 1024px) 25vw, 45vw"
                className="object-cover object-top"
                onError={() => setFailed(true)}
            />
            {websiteUrl ? (
                // The capture is the link to the provider's site and the icon chip is its affordance, so
                // the card does not offer the same destination twice. The focus ring is inset because the
                // rounded frame clips anything drawn outside the box.
                <a
                    href={websiteUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${name} website (opens in a new tab)`}
                    className="absolute inset-0 flex items-end justify-end bg-slate-950/0 p-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-900 group-hover:bg-slate-950/10"
                >
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-700 shadow-sm ring-1 ring-slate-200 transition group-hover:bg-slate-950 group-hover:text-white">
                        Visit site
                        <ExternalLink aria-hidden="true" className="h-3 w-3" />
                    </span>
                </a>
            ) : null}
        </div>
    )
}

/**
 * Provider description, clamped to three lines until the reader asks for the rest.
 *
 * A card is a narrow column, so an unchecked description pushes the facts a referrer actually
 * compares (NDIS, funding, wait time) below the fold. The control only appears when something is
 * actually hidden — and how many characters fit in three lines depends on the column width, which
 * the hero thumbnail and the viewport both change, so that is measured rather than guessed.
 * ResizeObserver fires on observe(), which covers the first paint.
 */
function ProviderDescription({ text }) {
    const [expanded, setExpanded] = useState(false)
    const [clamped, setClamped] = useState(false)
    const textRef = useRef(null)
    const textId = useId()

    useEffect(() => {
        const node = textRef.current
        // Nothing to measure once expanded — and leaving `clamped` as measured keeps the control on
        // screen with "Show less" instead of vanishing the moment it is used.
        if (!node || expanded) return
        const observer = new ResizeObserver(() => {
            setClamped(node.scrollHeight > node.clientHeight + 1)
        })
        observer.observe(node)
        return () => observer.disconnect()
    }, [expanded, text])

    return (
        <>
            <p ref={textRef} id={textId} className={`mt-2 text-sm leading-6 text-slate-600 ${expanded ? '' : 'line-clamp-3'}`}>{text}</p>
            {clamped && (
                <button
                    type="button"
                    onClick={() => setExpanded((value) => !value)}
                    aria-expanded={expanded}
                    aria-controls={textId}
                    className={`mt-1 inline-flex items-center gap-1 rounded text-xs font-semibold text-slate-600 underline underline-offset-2 hover:text-slate-900 ${FOCUS_RING}`}
                >
                    {expanded ? 'Show less' : 'Show more'}
                    <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                </button>
            )}
        </>
    )
}

function authHeaders(token, json = false) {
    return {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(json ? { 'Content-Type': 'application/json' } : {}),
    }
}

// Small seeded PRNG (mulberry32). The default browse order is shuffled from a seed chosen once per
// page load, so the list is random for the visitor but stays put between renders instead of jumping
// when React re-runs the sort (favouriting a card, opening the create form, ...).
function createSeededRandom(seed) {
    let state = seed >>> 0
    return () => {
        state = (state + 0x6d2b79f5) >>> 0
        let value = state
        value = Math.imul(value ^ (value >>> 15), value | 1)
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296
    }
}

// Fisher-Yates using the seeded PRNG above.
function shuffleWithSeed(items, seed) {
    const random = createSeededRandom(seed)
    const shuffled = [...items]
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(random() * (index + 1))
        const held = shuffled[index]
        shuffled[index] = shuffled[swapIndex]
        shuffled[swapIndex] = held
    }
    return shuffled
}

/**
 * Reports this route's deep-link params (`?q=`, `?provider=`) to the directory.
 *
 * `useSearchParams` is reactive, so this fires on a full page load *and* on a client-side
 * navigation that lands on this same route — the admin header practice search navigates that
 * way, and it does not remount the directory, so a mount-only effect would never run.
 *
 * The hook suspends during server rendering, so it sits behind its own `Suspense` boundary.
 * That keeps the client-side-rendered region down to this component (which renders nothing)
 * rather than dragging the whole directory behind a fallback.
 */
function DeepLinkParams({ onParams }) {
    const searchParams = useSearchParams()
    const providerId = searchParams.get('provider') || ''
    const query = searchParams.get('q') || ''

    // Depend on the two strings rather than the `URLSearchParams` object, so this runs when a
    // param actually changes instead of on every router render.
    useEffect(() => {
        onParams({ providerId, query })
    }, [providerId, query, onParams])

    return null
}

const ProvidersDirectory = forwardRef(function ProvidersDirectory({ manage = false, initialProfession = '', showHeader = true, superadminReview = false, embedded = false, providerHeroes = {}, heroCard = false, shuffleSeed = null, basePath = '/allied-health/providers' }, ref) {
    const router = useRouter()
    const [providers, setProviders] = useState([])
    const [deletedProviders, setDeletedProviders] = useState([])
    const [token, setToken] = useState('')
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [query, setQuery] = useState('')
    const [filters, setFilters] = useState(() => ({ professions: normalizeProfession(initialProfession) }))
    const [showAdvanced, setShowAdvanced] = useState(Boolean(initialProfession))
    const [favoritesOnly, setFavoritesOnly] = useState(false)
    const [fieldFilter, setFieldFilter] = useState({ field: 'provider', value: '' })
    const [editing, setEditing] = useState(null)
    const [saving, setSaving] = useState(false)
    const [webSearching, setWebSearching] = useState(false)
    const [webSearchMessage, setWebSearchMessage] = useState('')
    const deferredQuery = useDeferredValue(query)

    useImperativeHandle(ref, () => ({
        openCreateForm: () => setEditing({ ...EMPTY_PROVIDER }),
    }))

    const loadProviders = async (adminToken = token, onlyFavorites = favoritesOnly) => {
        setLoading(true)
        setError('')
        try {
            const params = new URLSearchParams()
            if (manage && !superadminReview) params.set('admin', '1')
            if (manage && onlyFavorites) params.set('favorites', '1')
            const response = await fetch(superadminReview ? '/api/providers/review' : `/api/providers?${params}`, {
                cache: 'no-store',
                headers: authHeaders(adminToken),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data?.error || 'Unable to load providers')
            setProviders((data.providers || []).map(normalizeProvider))
            setDeletedProviders(data.deletions || [])
        } catch (loadError) {
            setError(loadError.message || 'Unable to load providers')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        let cancelled = false
        async function start() {
            const adminToken = manage
                ? await getOrCreateAdminTokenForLocalhost()
                : window.localStorage.getItem('adminToken') || ''
            if (cancelled) return
            if (manage && !adminToken) {
                router.push('/login')
                return
            }
            setToken(adminToken)
            await loadProviders(adminToken, false)
        }
        start()
        return () => { cancelled = true }
        // Initial load only; subsequent refreshes are triggered by actions.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [manage])

    // Drop params that have already been acted on, so a refresh or a back/forward does not
    // replay them. `history.replaceState` is integrated with the App Router, so the reactive
    // `useSearchParams` above observes the change and does not re-report the param.
    const consumeSearchParams = useCallback((...keys) => {
        if (typeof window === 'undefined') return
        const url = new URL(window.location.href)
        let changed = false
        for (const key of keys) {
            if (url.searchParams.has(key)) {
                url.searchParams.delete(key)
                changed = true
            }
        }
        if (!changed) return
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
    }, [])

    // Deep links, reported by `DeepLinkParams` so they work on a full page load and on a
    // client-side navigation into this route. `?q=<name>` seeds the search box, so a provider
    // link lands on a filtered name search: both the admin dashboard's Providers card and the
    // admin header practice search send it. `?provider=<id>` opens one record's editor
    // directly; no in-app link emits it any more, so it only serves bookmarked/external URLs.
    const handleDeepLinkParams = useCallback(({ providerId, query }) => {
        if (query) {
            setQuery(query)
            consumeSearchParams('q')
            return
        }
        // Opening the editor is admin-only, and waits for the listing so the id can be
        // resolved against it. Arriving before the providers load is not a failure: this
        // callback changes identity with `providers`, which re-runs the reporter.
        if (!manage || !providerId || providers.length === 0) return
        const provider = providers.find((item) => String(item.id) === providerId)
        if (!provider) return
        consumeSearchParams('provider')
        setEditing({ ...provider })
    }, [consumeSearchParams, manage, providers])

    const filterOptions = useMemo(() => {
        const options = {}
        for (const field of [...PROVIDER_LIST_FIELDS, 'ndis_status']) {
            const selectedValue = filters[field]
            options[field] = Array.from(new Set([...providers.flatMap((provider) => {
                const value = provider[field]
                return Array.isArray(value) ? value : value ? [value] : []
            }), ...(selectedValue ? [selectedValue] : [])])).sort((left, right) => left.localeCompare(right))
        }
        return options
    }, [providers, filters])

    const visibleProviders = useMemo(() => {
        const matched = providers
            .map((provider) => ({ provider, score: providerSearchScore(provider, deferredQuery) }))
            .filter(({ provider, score }) => score > 0 && matchesProviderFilters(provider, filters) && matchesProviderField(provider, fieldFilter.field, fieldFilter.value))

        // A listing nobody has searched is otherwise alphabetical, which always leads with the same
        // names, so it is shuffled to spread the smaller/less-favourited listings throughout. Facet
        // filters (the preset `?p=ot` profession, funding, NDIS, ...) only narrow the pool that gets
        // shuffled. Relevance order returns as soon as the visitor searches or uses a field filter,
        // because then they are looking for a specific thing rather than browsing.
        const isBrowsing = !String(deferredQuery || '').trim() && !String(fieldFilter.value || '').trim()
        if (Number.isFinite(shuffleSeed) && isBrowsing) {
            return shuffleWithSeed(matched.map(({ provider }) => provider), shuffleSeed)
        }

        return matched
            .sort((left, right) => right.score - left.score || right.provider.favorite_count - left.provider.favorite_count || left.provider.provider.localeCompare(right.provider.provider))
            .map(({ provider }) => provider)
    }, [providers, deferredQuery, filters, fieldFilter, shuffleSeed])

    const setFilter = (field, value) => {
        setFilters((current) => ({ ...current, [field]: value }))
        if (field === 'professions' && typeof window !== 'undefined') {
            const url = new URL(window.location.href)
            const shortCode = PROFESSION_SHORT_CODES[value] || ''
            if (shortCode) url.searchParams.set('p', shortCode)
            else url.searchParams.delete('p')
            window.history.replaceState({}, '', `${url.pathname}${url.search}`)
        }
    }

    const toggleFavorite = async (provider) => {
        if (!token) {
            router.push(`/login?returnTo=${encodeURIComponent(basePath)}`)
            return
        }
        const favorite = !provider.is_favorite
        setProviders((current) => current.map((item) => item.id === provider.id ? {
            ...item,
            is_favorite: favorite,
            favorite_count: Math.max(0, item.favorite_count + (favorite ? 1 : -1)),
        } : item))
        const response = await fetch('/api/providers/favorites', {
            method: 'POST', headers: authHeaders(token, true),
            body: JSON.stringify({ provider_id: provider.id, favorite }),
        })
        if (!response.ok) await loadProviders(token, favoritesOnly)
    }

    const saveProvider = async (event) => {
        event.preventDefault()
        setSaving(true)
        setError('')
        const payload = normalizeProvider(editing)
        const isExisting = Boolean(payload.id)
        try {
            const response = await fetch(isExisting ? `/api/providers/${payload.id}` : '/api/providers', {
                method: isExisting ? 'PATCH' : 'POST',
                headers: authHeaders(token, true), body: JSON.stringify(payload),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data?.error || 'Unable to save provider')
            setEditing(null)
            await loadProviders(token, favoritesOnly)
        } catch (saveError) {
            setError(saveError.message || 'Unable to save provider')
        } finally {
            setSaving(false)
        }
    }

    const removeProvider = async (provider) => {
        if (!window.confirm(`Delete ${provider.provider}?`)) return
        const response = await fetch(`/api/providers/${provider.id}`, { method: 'DELETE', headers: authHeaders(token) })
        if (response.ok) {
            if (superadminReview) await loadProviders(token, favoritesOnly)
            else setProviders((current) => current.filter((item) => item.id !== provider.id))
        }
    }

    const hideProvider = async (provider) => {
        if (!window.confirm(`Hide ${provider.provider} from all catalogs?`)) return
        const response = await fetch(`/api/providers/review/${provider.id}`, {
            method: 'PATCH',
            headers: authHeaders(token, true),
            body: JSON.stringify({ status: 'hidden' }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
            setError(data?.error || 'Unable to hide provider')
            return
        }
        setProviders((current) => current.map((item) => item.id === provider.id ? { ...item, status: 'hidden' } : item))
        setDeletedProviders((current) => current.map((item) => item.provider_id === provider.id ? { ...item, status: 'hidden' } : item))
    }

    const hardAddProvider = async (provider) => {
        const response = await fetch(`/api/providers/review/${provider.id}`, {
            method: 'PATCH',
            headers: authHeaders(token, true),
            body: JSON.stringify({ status: 'published' }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
            setError(data?.error || 'Unable to publish provider')
            return
        }
        setProviders((current) => current.map((item) => item.id === provider.id ? { ...item, status: 'published' } : item))
    }

    const searchWebForMoreProviders = async () => {
        const searchTerm = query.trim()
        if (!searchTerm || !token) return
        setWebSearching(true)
        setWebSearchMessage('')
        try {
            const response = await fetch('/api/providers/web-search', {
                method: 'POST', headers: authHeaders(token, true),
                body: JSON.stringify({ query: searchTerm }),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data?.error || 'Web search failed')
            const addedNames = Array.isArray(data.added) ? data.added.map((provider) => provider.provider).filter(Boolean) : []
            setWebSearchMessage(addedNames.length > 0
                ? `Added ${addedNames.length} new provider${addedNames.length === 1 ? '' : 's'} from the web: ${addedNames.join(', ')}.`
                : 'No new allied health providers found on the web.')
            if (addedNames.length > 0) await loadProviders(token, favoritesOnly)
        } catch (webSearchError) {
            setWebSearchMessage(webSearchError.message || 'Web search failed')
        } finally {
            setWebSearching(false)
        }
    }

    const hasFilters = Object.values(filters).some((value) => value !== '' && value !== undefined) || Boolean(fieldFilter.value)

    const shellClassName = embedded
        ? 'text-slate-900'
        : showHeader
            ? `min-h-screen ${PAGE_WASH} text-slate-900`
            : 'min-h-screen bg-[radial-gradient(circle_at_18%_12%,#f1f5f9_0%,#eef2ff_26%,#f8fafc_52%,#ffffff_100%)] text-slate-900'

    return (
        <div className={shellClassName}>
            {/* Reads `?q=` / `?provider=` reactively. Renders nothing; the Suspense boundary
                exists only because `useSearchParams` suspends during server rendering. */}
            <Suspense fallback={null}>
                <DeepLinkParams onParams={handleDeepLinkParams} />
            </Suspense>

            {showHeader && <AlliedHealthUtilityBar />}

            <div className={showHeader ? 'mx-auto w-full max-w-6xl px-6 pb-20 pt-6 sm:px-10 lg:px-14' : 'mx-auto max-w-7xl px-4 py-7 sm:px-6 lg:px-8'}>
                {showHeader && (
                    <>
                        <AlliedHealthBrandBar currentPath={basePath} />
                        <AlliedHealthPageHero
                            eyebrow="Provider directory"
                            title="Allied health provider directory"
                            summary="Find Australian allied health providers by profession, service type, funding pathway, and location."
                            trail={[{ label: 'Home', href: '/' }, { label: 'Allied health', href: '/allied-health' }, { label: 'Providers' }]}
                            facts={[
                                { label: 'Coverage', value: 'Australia-wide' },
                                { label: 'Listings', value: loading ? 'Loading listings' : `${visibleProviders.length} matching listing${visibleProviders.length === 1 ? '' : 's'}` },
                                { label: 'Maintenance', value: 'Reviewed as information changes' },
                                { label: 'Enquiries', value: ALLIED_HEALTH_ENQUIRIES_EMAIL },
                            ]}
                            factsNote="Entries are compiled from publicly published provider information."
                            action={manage ? <button type="button" onClick={() => setEditing({ ...EMPTY_PROVIDER })} className="rounded-full bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">Add provider</button> : null}
                        />
                    </>
                )}

                <div className="mt-8 rounded-[1.5rem] border border-slate-200 bg-white/90 p-4 shadow-[0_20px_60px_-50px_rgba(15,23,42,0.45)] backdrop-blur-sm">
                    <div className="flex flex-col gap-3 md:flex-row">
                        <label className="min-w-0 flex-1">
                            <span className="sr-only">Search providers</span>
                            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search providers, professions, or locations" className={`w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-500 ${FOCUS_RING}`} />
                        </label>
                        <button type="button" onClick={() => setShowAdvanced((value) => !value)} className={`rounded-full border border-slate-300 bg-white px-5 py-2 text-sm font-semibold text-slate-800 hover:border-slate-400 hover:bg-slate-50 ${FOCUS_RING}`}>{showAdvanced ? 'Hide filters' : 'Advanced search'}</button>
                        {manage && <button type="button" onClick={() => { const next = !favoritesOnly; setFavoritesOnly(next); loadProviders(token, next) }} className={`rounded-full border px-5 py-2 text-sm font-semibold ${FOCUS_RING} ${favoritesOnly ? 'border-amber-400 bg-amber-50 text-amber-900' : 'border-slate-300 bg-white text-slate-800 hover:border-slate-400 hover:bg-slate-50'}`}>My favourites</button>}
                    </div>

                    {showAdvanced && (
                        <div className="mt-4 grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-2 lg:grid-cols-4">
                            {[...PROVIDER_LIST_FIELDS, 'ndis_status'].map((field) => (
                                <label key={field} className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-600">{FIELD_LABELS[field]}
                                    <select value={filters[field] || ''} onChange={(event) => setFilter(field, event.target.value)} className={`mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm font-normal normal-case tracking-normal text-slate-900 ${FOCUS_RING}`}>
                                        <option value="">Any</option>
                                        {(filterOptions[field] || []).map((option) => <option key={option} value={option}>{option}</option>)}
                                    </select>
                                </label>
                            ))}
                            {PROVIDER_BOOLEAN_FIELDS.map((field) => (
                                <label key={field} className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-600">{FIELD_LABELS[field]}
                                    <select value={filters[field] === undefined ? '' : String(filters[field])} onChange={(event) => setFilter(field, event.target.value === '' ? undefined : event.target.value === 'true')} className={`mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm font-normal normal-case tracking-normal text-slate-900 ${FOCUS_RING}`}>
                                        <option value="">Any</option><option value="true">Yes</option><option value="false">No</option>
                                    </select>
                                </label>
                            ))}
                            <label className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-600">Filter any field
                                <select value={fieldFilter.field} onChange={(event) => setFieldFilter((current) => ({ ...current, field: event.target.value }))} className={`mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm font-normal normal-case tracking-normal text-slate-900 ${FOCUS_RING}`}>
                                    {ALL_FIELD_OPTIONS.map((field) => <option key={field} value={field}>{FIELD_LABELS[field] || 'Provider'}</option>)}
                                </select>
                            </label>
                            <label className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-600">Contains
                                <input value={fieldFilter.value} onChange={(event) => setFieldFilter((current) => ({ ...current, value: event.target.value }))} className={`mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm font-normal normal-case tracking-normal text-slate-900 ${FOCUS_RING}`} placeholder="Enter a value" />
                            </label>
                            {hasFilters && <button type="button" onClick={() => { setFilters({}); setFieldFilter({ field: 'provider', value: '' }); setFilter('professions', '') }} className={`self-end rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400 hover:bg-slate-50 ${FOCUS_RING}`}>Clear filters</button>}
                        </div>
                    )}
                </div>

                <div className="my-5 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
                    <p>{loading ? 'Loading providers…' : `${visibleProviders.length} listing${visibleProviders.length === 1 ? '' : 's'} shown`}</p>
                    {initialProfession && <p>Profession filter: <span className="font-semibold text-slate-800">{normalizeProfession(initialProfession)}</span></p>}
                </div>
                {error && <div className="mb-5 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

                {superadminReview ? (
                    <>
                        <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                            <div className="border-b border-slate-200 px-5 py-4"><h2 className="text-lg font-semibold text-slate-900">Providers</h2></div>
                            <table className="w-full min-w-[760px] text-left text-sm">
                                <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-600"><tr><th className="px-5 py-3">Provider</th><th className="px-5 py-3">Website</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Domain</th><th className="px-5 py-3">Updated</th><th className="px-5 py-3 text-right">Actions</th></tr></thead>
                                <tbody className="divide-y divide-slate-200">{visibleProviders.map((provider) => <tr key={provider.id} className="text-slate-700"><td className="px-5 py-3 font-semibold text-slate-900"><div className="flex items-center gap-2"><ProviderLogo name={provider.provider} logoUrl={provider.logo_url} size={20} />{provider.provider}</div></td><td className="max-w-xs truncate px-5 py-3">{provider.website_url || 'Not listed'}</td><td className="px-5 py-3 capitalize">{provider.status}</td><td className="px-5 py-3">{provider.domain || 'Global'}</td><td className="px-5 py-3">{provider.updated_at ? new Date(provider.updated_at).toLocaleDateString() : 'Not listed'}</td><td className="px-5 py-3 text-right"><div className="flex justify-end gap-3 font-semibold"><button type="button" onClick={() => setEditing({ ...provider })} className="text-slate-700 underline underline-offset-2 hover:text-slate-950">Edit</button>{provider.status === 'admin_added' && <button type="button" onClick={() => hardAddProvider(provider)} className="text-slate-700 underline underline-offset-2 hover:text-slate-950">Hard add</button>}{provider.status !== 'hidden' && <button type="button" onClick={() => hideProvider(provider)} className="text-amber-700 underline underline-offset-2">Hide</button>}<button type="button" onClick={() => removeProvider(provider)} className="text-red-700 underline underline-offset-2">Delete</button></div></td></tr>)}</tbody>
                            </table>
                            {!loading && visibleProviders.length === 0 && <p className="px-5 py-8 text-sm text-slate-500">No providers found.</p>}
                        </section>
                        <section className="mt-6 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                            <div className="border-b border-slate-200 px-5 py-4"><h2 className="text-lg font-semibold text-slate-900">Admin-deleted records</h2><p className="mt-1 text-sm text-slate-500">Review records removed from an individual admin&apos;s view and hide them globally when appropriate.</p></div>
                            {deletedProviders.length === 0 ? <p className="px-5 py-8 text-sm text-slate-500">No admin-deleted records to review.</p> : <table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-amber-100 text-xs uppercase tracking-wide text-amber-800"><tr><th className="px-5 py-3">Provider</th><th className="px-5 py-3">Admin</th><th className="px-5 py-3">Deleted</th><th className="px-5 py-3">Status</th><th className="px-5 py-3 text-right">Action</th></tr></thead><tbody className="divide-y divide-slate-200">{deletedProviders.map((item) => <tr key={item.id} className="text-slate-700"><td className="px-5 py-3 font-semibold text-slate-900">{item.provider}</td><td className="px-5 py-3">{item.admin_key}</td><td className="px-5 py-3">{item.created_at ? new Date(item.created_at).toLocaleDateString() : 'Not listed'}</td><td className="px-5 py-3 capitalize">{item.status || 'Unknown'}</td><td className="px-5 py-3 text-right">{item.status === 'hidden' ? <span className="text-slate-500">Hidden globally</span> : <button type="button" onClick={() => hideProvider({ id: item.provider_id, provider: item.provider })} className="font-semibold text-amber-700 underline underline-offset-2">Hide globally</button>}</td></tr>)}</tbody></table>}
                        </section>
                    </>
                ) : !loading && visibleProviders.length === 0 ? (
                    <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
                        <h2 className="text-lg font-semibold text-slate-900">No matching providers</h2>
                        <p className="mt-1 text-sm text-slate-500">Try a broader search or clear one of the filters.</p>
                    </div>
                ) : (
                    <div className="grid gap-4 lg:grid-cols-2">
                        {visibleProviders.map((provider) => <ProviderCard key={provider.id} provider={provider} heroUrl={providerHeroes[providerHeroHostname(provider.website_url)] || ''} heroCard={heroCard} canFavorite={Boolean(token)} manage={manage} embedded={embedded} onFavorite={toggleFavorite} onEdit={setEditing} onDelete={removeProvider} />)}
                    </div>
                )}

                {Boolean(token) && manage && !superadminReview && (
                    <div className="mt-6 flex flex-col items-center gap-2">
                        <button
                            type="button"
                            onClick={searchWebForMoreProviders}
                            disabled={webSearching || !query.trim()}
                            className={`rounded-full border border-slate-300 bg-white px-6 py-2 text-sm font-semibold text-slate-800 hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
                            title={query.trim() ? 'Search the web for more providers matching your search' : 'Enter a search term above to search the web'}
                        >
                            {webSearching ? 'Searching the web...' : 'More'}
                        </button>
                        {webSearchMessage && <p className="text-xs text-slate-500">{webSearchMessage}</p>}
                    </div>
                )}
            </div>

            {editing && <ProviderEditor provider={editing} saving={saving} allowHidden={superadminReview} onChange={setEditing} onClose={() => setEditing(null)} onSubmit={saveProvider} />}
        </div>
    )
})

export default ProvidersDirectory

function ProviderCard({ provider, heroUrl, heroCard = false, canFavorite, manage, embedded, onFavorite, onEdit, onDelete }) {
    const serviceFlags = PROVIDER_BOOLEAN_FIELDS.filter((field) => provider[field]).map((field) => FIELD_LABELS[field])
    const waitTime = String(provider.typical_wait_time || '').trim()
    const waitTimeText = waitTime.length >= WAIT_TIME_MAX_LENGTH ? `${waitTime}…` : waitTime
    const factEntries = [
        ['Age groups', provider.age_groups.join(', ') || 'All ages'],
        ['NDIS', provider.ndis_status || 'Not listed'],
        ['Funding', provider.funding.join(', ') || 'Not listed'],
    ]
    // Wait time only earns a row when a provider actually publishes one — 4 of 106 do, so as a fixed row
    // it read "Not listed" on almost every card, and where it does exist it is worth keeping ("Usually no
    // waitlist", "Responds in ~2 hours"). The classic card keeps the placeholder because its two-column
    // grid needs the fourth cell to fill the row.
    if (waitTimeText || !heroCard) factEntries.push(['Wait time', waitTimeText || 'Not listed'])
    const facts = factEntries.map(([label, value]) => (
        <div key={label}><dt className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</dt><dd className="mt-0.5 text-slate-700">{value}</dd></div>
    ))
    // `key` is required because this element is also placed directly inside the `secondaryActions`
    // array; an array child without a key triggers React's "unique key prop" warning.
    const favoriteNote = provider.favorite_count > 0 ? (
        <p key="favorite-note" className="text-xs font-semibold text-amber-800">Favourited by {provider.favorite_count} referrer{provider.favorite_count === 1 ? '' : 's'}</p>
    ) : null
    const websiteLink = (
        <a href={provider.website_url} target="_blank" rel="noreferrer" className={`rounded text-slate-700 underline underline-offset-2 hover:text-slate-950 ${FOCUS_RING}`}>Website</a>
    )
    const manageLinks = (
        <>
            {manage && <button type="button" onClick={() => onEdit({ ...provider })} className={`rounded text-slate-700 underline underline-offset-2 hover:text-slate-950 ${FOCUS_RING}`}>Edit</button>}
            {manage && <button type="button" onClick={() => onDelete(provider)} className={`rounded text-red-700 underline underline-offset-2 hover:text-red-800 ${FOCUS_RING}`}>Delete</button>}
        </>
    )
    const actionLinks = (
        <div className="flex items-center gap-4 font-semibold">
            {provider.website_url && websiteLink}
            {manageLinks}
        </div>
    )
    // On a hero card the capture itself links to the provider's site, so the "Website" text link is
    // only needed when there is no approved capture to overlay it on — and the block is skipped
    // altogether when it would hold nothing.
    const secondaryActions = [
        favoriteNote,
        manage || (!heroUrl && provider.website_url) ? (
            <div key="links" className="flex flex-wrap items-center gap-4 font-semibold">
                {!heroUrl && provider.website_url ? websiteLink : null}
                {manageLinks}
            </div>
        ) : null,
    ].filter(Boolean)
    // The hero card leads with the provider's own words — description under the name — and splits the
    // lower half into the facts on the left and the capture filling the right-hand quadrant.
    return (
        <article className={`flex flex-col rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-[0_20px_60px_-52px_rgba(15,23,42,0.45)] transition ${embedded ? '' : 'hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_28px_70px_-50px_rgba(15,23,42,0.55)]'}`}>
            <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                    <ProviderLogo name={provider.provider} logoUrl={provider.logo_url} size={32} />
                    <div className="min-w-0">
                        <h2 className="text-lg font-semibold text-slate-900">{provider.provider}</h2>
                        <p className="mt-1 text-sm text-slate-500">{provider.geography.join(' · ') || 'Service area not listed'}</p>
                        {heroCard && provider.description ? <ProviderDescription text={provider.description} /> : null}
                    </div>
                </div>
                <button type="button" onClick={() => onFavorite(provider)} className={`shrink-0 rounded-full px-2 py-1 text-xl leading-none ${FOCUS_RING} ${provider.is_favorite ? 'text-amber-600' : 'text-slate-300 hover:text-slate-400'}`} title={canFavorite ? 'Toggle favourite' : 'Admin sign-in required'} aria-label={provider.is_favorite ? 'Remove favourite' : 'Add favourite'}>{provider.is_favorite ? '★' : '☆'}</button>
            </div>
            {!heroCard && provider.description && <p className="mt-3 text-sm leading-6 text-slate-600">{provider.description}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
                {[...provider.professions, ...provider.service_types].slice(0, 8).map((item) => <span key={item} className={`rounded-full border px-2.5 py-1 text-xs ${embedded ? 'border-gray-200 bg-gray-50 text-gray-700' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>{item}</span>)}
            </div>
            {heroCard ? (
                // Bottom half: facts as a single column in the bottom-left quadrant, capture filling the
                // bottom-right one. The 3:4 capture is normally the taller of the two, so it sets the row
                // height and lands flush against the card's bottom-right corner; `mt-auto` keeps the
                // actions on the baseline when the facts column is the taller one.
                // `flex-1` matters: a card is stretched to its taller row-mate, and without it that leftover
                // height lands *below* this grid, leaving a strip under the capture instead of pinning it
                // to the card's bottom-right corner.
                <div className="mt-5 grid flex-1 gap-x-5 gap-y-4 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2">
                    {/* Centred against the capture: the fact list is a fixed height while the capture's
                        3:4 box sets the row height on most cards, so top-aligning the facts left the slack
                        hanging at the bottom of the quadrant. On the cards where the facts column is the
                        taller one the capture is bottom-anchored instead, and the text stays centred in
                        the cell. */}
                    <div className="flex min-w-0 flex-col justify-center gap-4">
                        <dl className="grid gap-y-4">{facts}</dl>
                        {serviceFlags.length > 0 || secondaryActions.length > 0 ? (
                            <div className="flex flex-col gap-4">
                                {serviceFlags.length > 0 && <p className="text-xs text-slate-500">{serviceFlags.join(' · ')}</p>}
                                {secondaryActions.length > 0 ? (
                                    <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">{secondaryActions}</div>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                    {heroUrl ? <ProviderCardHero url={heroUrl} name={provider.provider} websiteUrl={provider.website_url} /> : null}
                </div>
            ) : (
                <>
                    <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-100 pt-4 text-sm">{facts}</dl>
                    {serviceFlags.length > 0 && <p className="mt-4 text-xs text-slate-500">{serviceFlags.join(' · ')}</p>}
                    <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 text-sm">
                        {favoriteNote}
                        {actionLinks}
                    </div>
                </>
            )}
        </article>
    )
}

function ProviderEditor({ provider, saving, allowHidden = false, onChange, onClose, onSubmit }) {
    const update = (field, value) => onChange({ ...provider, [field]: value })
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
            <form onSubmit={onSubmit} className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-[1.5rem] bg-white p-6 shadow-xl">
                <div className="mb-5 flex items-center justify-between"><h2 className="text-xl font-semibold text-slate-900">{provider.id ? 'Provider' : 'Add provider'}</h2><button type="button" onClick={onClose} className={`rounded-full px-2 text-2xl leading-none text-slate-500 hover:text-slate-900 ${FOCUS_RING}`} aria-label="Close">x</button></div>
                <div className="grid gap-4 md:grid-cols-2">
                    <label className="text-sm font-semibold md:col-span-2">Provider<input required value={provider.provider || ''} onChange={(event) => update('provider', event.target.value)} className="mt-1 w-full font-normal" /></label>
                    <label className="text-sm font-semibold md:col-span-2">Description<textarea value={provider.description || ''} onChange={(event) => update('description', event.target.value)} rows="3" className="mt-1 w-full font-normal" /></label>
                    {FORM_ROWS.flat().filter((field) => field !== 'status').map((field) => <label key={field} className="text-sm font-semibold">{FIELD_LABELS[field]}<input type={field.includes('url') ? 'url' : field === 'email' ? 'email' : field === 'last_verified_at' ? 'date' : 'text'} value={PROVIDER_LIST_FIELDS.includes(field) ? listText(provider[field]) : provider[field] || ''} onChange={(event) => update(field, PROVIDER_LIST_FIELDS.includes(field) ? event.target.value.split(',').map((item) => item.trim()).filter(Boolean) : event.target.value)} placeholder={PROVIDER_LIST_FIELDS.includes(field) ? 'Comma separated' : ''} className="mt-1 w-full font-normal" /></label>)}
                    <label className="text-sm font-semibold">Status<select value={provider.status || 'published'} onChange={(event) => update('status', event.target.value)} className="mt-1 w-full font-normal"><option value="published">Published</option><option value="draft">Draft</option><option value="archived">Archived</option>{allowHidden && <option value="admin_added">Admin added</option>}{allowHidden && <option value="hidden">Hidden</option>}</select></label>
                    <div className="flex flex-wrap items-end gap-4 md:col-span-2">{PROVIDER_BOOLEAN_FIELDS.map((field) => <label key={field} className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={Boolean(provider[field])} onChange={(event) => update(field, event.target.checked)} />{FIELD_LABELS[field]}</label>)}</div>
                </div>
                <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className={`rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 ${FOCUS_RING}`}>Cancel</button><button disabled={saving} type="submit" className={`rounded-full bg-slate-950 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 ${FOCUS_RING}`}>{saving ? 'Saving...' : 'Save provider'}</button></div>
            </form>
        </div>
    )
}
