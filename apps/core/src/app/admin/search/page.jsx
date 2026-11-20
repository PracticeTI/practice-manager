'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowRight, Loader2, Package, Search, Stethoscope, User, X } from 'lucide-react'
import AdminHeader from '@/admin-ui/components/AdminHeader'
import { getCurrentUser, getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import {
    PRACTICE_SEARCH_PAGE_MAX_RESULTS_PER_TYPE,
    PRACTICE_SEARCH_RESULTS_PATH,
    buildPracticeSearchResultsHref,
    getPracticeSearchEntityLabel,
    isPracticeSearchQueryReady,
} from '@/lib/practiceSearchCatalog'

const PANEL_SURFACE_CLASS = 'rounded-lg border border-gray-200 bg-white/90 p-6 shadow-sm backdrop-blur-[1px]'

const ENTITY_ICONS = {
    patients: User,
    providers: Stethoscope,
    suppliers: Package,
}

function resolveEntityIcon(key) {
    return ENTITY_ICONS[key] || Search
}

/**
 * Term input for the results page.
 *
 * Mounted with a `key` of the term currently in the URL, so navigating (a
 * submit, the clear button or the browser Back button) remounts it with the
 * current term instead of needing an effect to sync the typed value.
 */
function PracticeSearchForm({ initialQuery, scopeLabel, onSubmitQuery, onClear }) {
    const [value, setValue] = useState(initialQuery)

    return (
        <form
            onSubmit={(event) => {
                event.preventDefault()
                onSubmitQuery(value.trim())
            }}
            className="mt-4 flex flex-wrap items-center gap-2"
        >
            <div className="relative w-full max-w-md">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                    type="text"
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    aria-label={`Search practice${scopeLabel ? ` (${scopeLabel})` : ''}`}
                    placeholder="Search patients, providers and suppliers"
                    className="w-full rounded-md border border-gray-300 py-2 pl-8 pr-8 text-sm text-gray-900 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-200"
                />
                {value.length > 0 && (
                    <button
                        type="button"
                        onClick={() => {
                            setValue('')
                            onClear()
                        }}
                        aria-label="Clear practice search"
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-300"
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                )}
            </div>
            <button
                type="submit"
                className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700"
            >
                Search
            </button>
        </form>
    )
}

/**
 * Full practice search results page (`/admin/search?q=…`).
 *
 * The admin header search box only previews the top few matches per entity type;
 * its "See all results" action lands here, where every match for the term is
 * listed and each row links to the record's own admin destination.
 *
 * The page is driven entirely by the `q` query parameter so a result link,
 * a refresh or the browser Back button all restore the same listing.
 */
function PracticeSearchPageContent() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const queryParam = String(searchParams.get('q') || '').trim()

    const [status, setStatus] = useState('checking') // 'checking' | 'ready' | 'unavailable'
    const [entityTypes, setEntityTypes] = useState([])
    const [results, setResults] = useState([])
    const [typeErrors, setTypeErrors] = useState([])
    const [loading, setLoading] = useState(false)
    const [errorMessage, setErrorMessage] = useState('')

    useEffect(() => {
        document.title = 'Practice Search'
    }, [])

    // Resolve the session and ask the API whether practice search applies to
    // this domain (the same check the header box makes before rendering).
    useEffect(() => {
        let cancelled = false

        async function bootstrap() {
            const token = await getOrCreateAdminTokenForLocalhost()
            if (cancelled) return

            if (!token || !getCurrentUser()) {
                router.push('/login')
                return
            }

            const response = await fetch('/api/admin/practice-search', {
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store',
            }).catch(() => null)
            if (cancelled) return

            const data = response?.ok ? await response.json().catch(() => ({})) : {}
            if (data.enabled !== true || !Array.isArray(data.entityTypes)) {
                setEntityTypes([])
                setStatus('unavailable')
                return
            }

            setEntityTypes(data.entityTypes)
            setStatus('ready')
        }

        bootstrap()
        return () => {
            cancelled = true
        }
    }, [router])

    // Load the results for the term in the URL. Asking for the page limit keeps
    // the listing complete instead of the typeahead preview shown in the header.
    // A too-short term never reaches the API, and `showResults` below hides any
    // earlier listing, so there is nothing to clear synchronously here.
    useEffect(() => {
        if (status !== 'ready' || !isPracticeSearchQueryReady(queryParam)) return

        let cancelled = false

        async function runSearch() {
            setLoading(true)
            setErrorMessage('')

            try {
                const token = await getOrCreateAdminTokenForLocalhost()
                const params = new URLSearchParams({
                    q: queryParam,
                    limit: String(PRACTICE_SEARCH_PAGE_MAX_RESULTS_PER_TYPE),
                })
                const response = await fetch(`/api/admin/practice-search?${params}`, {
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                    cache: 'no-store',
                })
                const data = await response.json().catch(() => ({}))
                if (cancelled) return

                if (!response.ok || data.success === false) {
                    setResults([])
                    setTypeErrors([])
                    setErrorMessage(data.error || 'Search failed')
                    return
                }

                setResults(Array.isArray(data.results) ? data.results : [])
                setTypeErrors(Array.isArray(data.typeErrors) ? data.typeErrors : [])
            } catch {
                if (cancelled) return
                setResults([])
                setTypeErrors([])
                setErrorMessage('Search failed')
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        runSearch()
        return () => {
            cancelled = true
        }
    }, [queryParam, status])

    const scopeLabel = useMemo(
        () => entityTypes.map((entityType) => entityType.label).join(', '),
        [entityTypes]
    )

    const groupedResults = useMemo(() => {
        if (!Array.isArray(results) || results.length === 0) return []

        const itemsByType = new Map()
        for (const result of results) {
            const key = String(result?.type || '')
            if (!key) continue
            if (!itemsByType.has(key)) itemsByType.set(key, [])
            itemsByType.get(key).push(result)
        }

        // Keep the catalogue's display order, then any type the API adds later.
        const knownKeys = entityTypes.map((entityType) => entityType.key).filter((key) => itemsByType.has(key))
        const unknownKeys = Array.from(itemsByType.keys()).filter((key) => !knownKeys.includes(key))

        return [...knownKeys, ...unknownKeys].map((key) => ({
            key,
            label: getPracticeSearchEntityLabel(key),
            items: itemsByType.get(key) || [],
        }))
    }, [entityTypes, results])

    const submitQuery = useCallback((term) => {
        if (!isPracticeSearchQueryReady(term)) return
        if (term === queryParam) return

        // A new `queryParam` remounts the form, which refetches the listing.
        router.push(buildPracticeSearchResultsHref(term))
    }, [queryParam, router])

    const clearQuery = useCallback(() => {
        if (queryParam) router.push(PRACTICE_SEARCH_RESULTS_PATH)
    }, [queryParam, router])

    const term = queryParam
    const showResults = status === 'ready' && isPracticeSearchQueryReady(queryParam)
    // A group sitting on the per-category cap means the real match count is
    // higher, so the summary must not present the visible total as exact.
    const hasCappedGroup = groupedResults.some(
        (group) => group.items.length >= PRACTICE_SEARCH_PAGE_MAX_RESULTS_PER_TYPE
    )

    return (
        <div className="min-h-screen">
            <AdminHeader title="Practice Search" />

            <main className="mx-auto max-w-7xl px-4 py-8">
                <section className={PANEL_SURFACE_CLASS}>
                    <h1 className="text-2xl font-bold text-gray-900">Practice Search</h1>
                    <p className="mt-1 text-sm text-gray-600">
                        {status === 'unavailable'
                            ? 'Practice search is not enabled for this practice.'
                            : `Every ${scopeLabel || 'patient, provider and supplier'} record matching your search term.`}
                    </p>

                    {status === 'ready' && (
                        <PracticeSearchForm
                            key={queryParam}
                            initialQuery={queryParam}
                            scopeLabel={scopeLabel}
                            onSubmitQuery={submitQuery}
                            onClear={clearQuery}
                        />
                    )}

                    {/* Progress and result summary for the term in the URL. */}
                    <div className="mt-4 border-t border-gray-100 pt-3">
                        {status === 'checking' && (
                            <p className="flex items-center gap-2 text-sm text-gray-600">
                                <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                                Checking practice search…
                            </p>
                        )}

                        {status === 'unavailable' && (
                            <p className="text-sm text-gray-600">
                                Turn on the practice search box in Domain Settings to search this practice&apos;s records.
                            </p>
                        )}

                        {status === 'ready' && !isPracticeSearchQueryReady(queryParam) && (
                            <p className="text-sm text-gray-600">
                                Type at least 2 characters to search {scopeLabel || 'the practice'}.
                            </p>
                        )}

                        {showResults && loading && (
                            <p className="flex items-center gap-2 text-sm text-gray-600">
                                <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                                Searching {scopeLabel || 'the practice'}…
                            </p>
                        )}

                        {showResults && !loading && errorMessage && (
                            <p className="text-sm text-red-600">{errorMessage}</p>
                        )}

                        {showResults && !loading && !errorMessage && (
                            <>
                                <p className="text-sm text-gray-600">
                                    {groupedResults.length === 0
                                        ? `No matching records for “${term}”.`
                                        : hasCappedGroup
                                            ? `At least ${results.length} matches for “${term}” — showing the first ${PRACTICE_SEARCH_PAGE_MAX_RESULTS_PER_TYPE} per category.`
                                            : `${results.length} ${results.length === 1 ? 'match' : 'matches'} for “${term}”.`}
                                </p>

                                {typeErrors.length > 0 && (
                                    <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                                        {typeErrors.map((entry) => getPracticeSearchEntityLabel(entry?.type)).join(', ')} could not be searched.
                                    </p>
                                )}
                            </>
                        )}
                    </div>
                </section>

                {showResults && !loading && groupedResults.map((group) => {
                    const GroupIcon = resolveEntityIcon(group.key)

                    return (
                        <section key={group.key} className={`${PANEL_SURFACE_CLASS} mt-6`}>
                            <div className="flex items-center gap-2">
                                <GroupIcon className="h-4 w-4 text-gray-400" />
                                <h2 className="text-base font-semibold text-gray-900">{group.label}</h2>
                                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                                    {group.items.length}
                                </span>
                            </div>

                            <ul className="mt-3 divide-y divide-gray-100">
                                {group.items.map((result) => (
                                    <li key={`${result.type}-${result.id}`}>
                                        <Link
                                            href={result.href}
                                            className="group flex items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-gray-50"
                                        >
                                            <span className="min-w-0">
                                                <span className="block truncate text-sm text-gray-900">{result.title}</span>
                                                {result.subtitle && (
                                                    <span className="block truncate text-xs text-gray-500">{result.subtitle}</span>
                                                )}
                                            </span>
                                            <ArrowRight className="h-4 w-4 flex-none text-gray-300 group-hover:text-gray-500" />
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )
                })}
            </main>
        </div>
    )
}

export default function PracticeSearchPage() {
    return (
        <Suspense
            fallback={(
                <div className="min-h-screen flex items-center justify-center">
                    <div className="text-sm text-gray-600">Loading practice search...</div>
                </div>
            )}
        >
            <PracticeSearchPageContent />
        </Suspense>
    )
}
