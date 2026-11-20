'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Clock, Loader2, Package, Search, Stethoscope, User, X } from 'lucide-react'
import AssistantAvatar from '@/admin-ui/components/AssistantAvatar'
import { getAdminDomainMode } from '@/lib/adminActiveDomain'
import { resolveAdminAuthToken } from '@/lib/clientAdminAuth'
import { loadAssistantStatus, looksLikeAssistantQuestion, requestAssistantPrompt } from '@/lib/assistantClient'
import {
    PRACTICE_SEARCH_DEBOUNCE_MS,
    PRACTICE_SEARCH_MAX_VISIBLE_PER_TYPE,
    buildPracticeSearchResultsHref,
    isPracticeSearchQueryReady,
} from '@/lib/practiceSearchCatalog'
import {
    PRACTICE_SEARCH_RECENTS_LIMIT,
    addRecentSearch,
    readRecentSearches,
    writeRecentSearches,
} from '@/lib/practiceSearchRecents'

const ENTITY_ICONS = {
    patients: User,
    providers: Stethoscope,
    suppliers: Package,
}

function resolveEntityIcon(key) {
    return ENTITY_ICONS[key] || Search
}

/**
 * Which entities the box searches is decided per domain, so the recent terms
 * belong to the active domain rather than to the browser.
 */
function recentsScope() {
    return getAdminDomainMode()
}

/** `localStorage` is missing during the server render and can be blocked in privacy mode. */
function recentsStorage() {
    try {
        return window.localStorage
    } catch {
        return null
    }
}

function readStoredRecents() {
    return readRecentSearches(recentsStorage(), recentsScope(), PRACTICE_SEARCH_RECENTS_LIMIT)
}

/** Remember `term` as the newest recent and return the list that was stored. */
function persistRecent(current, term) {
    const next = addRecentSearch(current, term, PRACTICE_SEARCH_RECENTS_LIMIT)
    return writeRecentSearches(recentsStorage(), recentsScope(), next, PRACTICE_SEARCH_RECENTS_LIMIT)
}

/**
 * Practice search box shown in the centre of the admin header.
 *
 * Rendered only when the active domain has the `practiceSearchEnabled` feature
 * flag on and at least one searchable entity type (Patients/Providers/Suppliers)
 * is enabled for that domain — the server decides both, so the box simply hides
 * itself when the API reports it is unavailable.
 *
 * When the domain also has the AI Assistant enabled and configured, the results
 * panel can hand the typed query to the assistant as a prompt instead. That
 * action is only offered when it is a sensible next step:
 *
 *  - nothing matched the term, so the assistant shows up as a "Suggested"
 *    search rather than competing with real results, or
 *  - the term reads like a question for the assistant (see
 *    `looksLikeAssistantQuestion`), where entity matches are incidental.
 *
 * While a lookup is still in flight the row is held back so it cannot flash in
 * and then jump once results land.
 *
 * An empty box has nothing to look up, so the panel offers the last few terms the
 * admin actually used instead (`practiceSearchRecents`). A term is remembered
 * when it is acted on — a result opened, the full results page opened, or the
 * term handed to the assistant — not while it is being typed.
 */
export default function PracticeSearchBox() {
    const router = useRouter()
    const containerRef = useRef(null)
    const inputRef = useRef(null)

    const [status, setStatus] = useState('checking') // 'checking' | 'ready' | 'hidden'
    const [entityTypes, setEntityTypes] = useState([])
    const [assistantConfig, setAssistantConfig] = useState(null)
    const [query, setQuery] = useState('')
    const [results, setResults] = useState([])
    const [searching, setSearching] = useState(false)
    const [open, setOpen] = useState(false)
    const [activeIndex, setActiveIndex] = useState(-1)
    const [errorMessage, setErrorMessage] = useState('')
    const [recentSearches, setRecentSearches] = useState([])

    const scopeLabel = useMemo(
        () => entityTypes.map((entityType) => entityType.label).join(', '),
        [entityTypes]
    )

    // Results are only meaningful once the query is long enough; deriving this
    // (instead of clearing state in the debounce effect) keeps the effect free of
    // synchronous state updates.
    const queryReady = isPracticeSearchQueryReady(query)

    const groupedResults = useMemo(() => {
        if (!queryReady || !Array.isArray(results) || results.length === 0) return []

        const groups = new Map(entityTypes.map((entityType) => [entityType.key, []]))
        for (const result of results) {
            if (!groups.has(result.type)) groups.set(result.type, [])
            groups.get(result.type).push(result)
        }

        const labelByKey = new Map(entityTypes.map((entityType) => [entityType.key, entityType.label]))
        return Array.from(groups.entries())
            .filter(([, items]) => items.length > 0)
            .map(([key, items]) => ({
                key,
                label: labelByKey.get(key) || key,
                // Show only the top few per category so the panel stays compact.
                items: items.slice(0, PRACTICE_SEARCH_MAX_VISIBLE_PER_TYPE),
            }))
    }, [queryReady, results, entityTypes])

    const flatResults = useMemo(
        () => groupedResults.flatMap((group) => group.items),
        [groupedResults]
    )

    // The last few terms the admin used are offered while the box is empty, which
    // is the one state the panel used to have nothing to say about. Recents are
    // keyed on "empty" rather than "not yet searchable" so a first character gets
    // the typing hint alone instead of a list it would compete with. Every other
    // row needs a ready query, so the two sets cannot both be present; the index
    // math still counts the recents first so the ordering holds if that changes.
    const emptyQuery = !String(query || '').trim()
    const showRecentSearches = emptyQuery && recentSearches.length > 0
    const recentsCount = showRecentSearches ? recentSearches.length : 0

    // The panel previews only the top few rows per category, so once anything
    // matches we offer a jump to the full results page for the term. That row and
    // the Assistant row sit after the entity results and join keyboard navigation
    // as the last entries.
    const showViewAllResults = queryReady && flatResults.length > 0 && !errorMessage
    const viewAllIndex = showViewAllResults ? recentsCount + flatResults.length : -1

    // Two reasons to offer the assistant, checked in that order:
    //  - the term matched nothing, so it becomes a suggested search, or
    //  - the term reads like a question/instruction for the assistant.
    // A running lookup suppresses only the first, since "nothing matched" is not
    // yet known; a question-shaped term is offered immediately.
    const assistantAvailable = assistantConfig !== null
    const assistantIsFallback = queryReady && !searching && flatResults.length === 0
    const assistantIsAsked = queryReady && looksLikeAssistantQuestion(query)
    const showAssistant = assistantAvailable && !errorMessage && (assistantIsAsked || assistantIsFallback)
    const assistantIndex = showAssistant ? recentsCount + flatResults.length + (showViewAllResults ? 1 : 0) : -1
    const navigableCount = recentsCount + flatResults.length + (showViewAllResults ? 1 : 0) + (assistantIndex >= 0 ? 1 : 0)

    // Resolve an admin token and ask the APIs whether they apply here.
    useEffect(() => {
        let cancelled = false

        async function checkAvailability() {
            const token = await resolveAdminAuthToken()
            if (cancelled) return
            if (!token) {
                setStatus('hidden')
                return
            }

            const [searchResponse, assistantStatus] = await Promise.all([
                fetch('/api/admin/practice-search', {
                    headers: { Authorization: `Bearer ${token}` },
                    cache: 'no-store',
                }).catch(() => null),
                loadAssistantStatus(),
            ])
            if (cancelled) return

            let searchEnabled = false
            if (searchResponse?.ok) {
                const data = await searchResponse.json().catch(() => ({}))
                if (data.enabled === true && Array.isArray(data.entityTypes)) {
                    setEntityTypes(data.entityTypes)
                    searchEnabled = true
                }
            }

            setAssistantConfig(assistantStatus?.available === true ? assistantStatus.config : null)
            setStatus(searchEnabled ? 'ready' : 'hidden')
        }

        checkAvailability()
        return () => {
            cancelled = true
        }
    }, [])

    // Recent terms are read after mount rather than in the initial state: storage
    // does not exist during the server render, and reading it later cannot produce
    // a hydration mismatch. The deferred update keeps the effect free of the
    // synchronous setState that `react-hooks/set-state-in-effect` flags.
    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            setRecentSearches(readStoredRecents())
        }, 0)

        return () => window.clearTimeout(timeoutId)
    }, [])

    // Close the results panel when clicking anywhere outside the box.
    useEffect(() => {
        if (!open) return

        const handlePointerDown = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setOpen(false)
            }
        }

        document.addEventListener('mousedown', handlePointerDown)
        return () => document.removeEventListener('mousedown', handlePointerDown)
    }, [open])

    // Debounced lookup for the current query.
    useEffect(() => {
        if (status !== 'ready') return

        const term = query.trim()
        if (!isPracticeSearchQueryReady(term)) return

        const controller = new AbortController()
        const timeoutId = window.setTimeout(async () => {
            setSearching(true)
            setErrorMessage('')
            try {
                const token = await resolveAdminAuthToken({ attempts: 1 })

                const response = await fetch(`/api/admin/practice-search?q=${encodeURIComponent(term)}`, {
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                    cache: 'no-store',
                    signal: controller.signal,
                })
                const data = await response.json().catch(() => ({}))

                if (!response.ok || data.success === false) {
                    setResults([])
                    setErrorMessage(data.error || 'Search failed')
                    return
                }

                // Only apply results that still match what is typed.
                if (data.query === term) {
                    setResults(Array.isArray(data.results) ? data.results : [])
                    setActiveIndex(-1)
                }
            } catch (error) {
                if (error?.name !== 'AbortError') {
                    setResults([])
                    setErrorMessage('Search failed')
                }
            } finally {
                if (!controller.signal.aborted) setSearching(false)
            }
        }, PRACTICE_SEARCH_DEBOUNCE_MS)

        return () => {
            window.clearTimeout(timeoutId)
            controller.abort()
        }
    }, [query, status])

    const closeSearch = useCallback(() => {
        setOpen(false)
        setActiveIndex(-1)
    }, [])

    const clearSearch = useCallback(() => {
        setQuery('')
        setResults([])
        setActiveIndex(-1)
        setErrorMessage('')
        inputRef.current?.focus()
    }, [])

    // A term is remembered once it has been acted on, which is what makes the
    // list read as "searches I made" rather than "things I typed". The current
    // list is read from this render's state rather than a state updater, because
    // the write to storage is a side effect and updaters may run during render.
    const rememberSearch = useCallback((term) => {
        setRecentSearches(persistRecent(recentSearches, term))
    }, [recentSearches])

    // Choosing a recent term puts it back in the box and runs the normal lookup,
    // rather than navigating straight to a remembered destination — the term is
    // the thing being reused, and the results are what the admin picks from.
    const applyRecentSearch = useCallback((term) => {
        const next = String(term || '').trim()
        if (!next) return

        setQuery(next)
        setResults([])
        setActiveIndex(-1)
        setErrorMessage('')
        setOpen(true)
        inputRef.current?.focus()
    }, [])

    const clearRecentSearches = useCallback(() => {
        writeRecentSearches(recentsStorage(), recentsScope(), [], PRACTICE_SEARCH_RECENTS_LIMIT)
        setRecentSearches([])
    }, [])

    const openResult = useCallback((result) => {
        if (!result?.href) return
        rememberSearch(query)
        closeSearch()
        setQuery('')
        setResults([])
        router.push(result.href)
    }, [closeSearch, query, rememberSearch, router])

    // Hand the typed query to the assistant as a prompt. The query is consumed
    // either way, so the box resets just like a normal result selection.
    const askAssistant = useCallback(() => {
        const prompt = query.trim()
        if (!prompt) return

        rememberSearch(prompt)
        closeSearch()
        setQuery('')
        setResults([])
        setErrorMessage('')
        requestAssistantPrompt(prompt)
    }, [closeSearch, query, rememberSearch])

    // Jump to the full results page for the typed term, which lists every match
    // rather than the handful previewed here. The query is consumed on the way
    // out, matching how a result selection resets the box.
    const openResultsPage = useCallback(() => {
        const term = query.trim()
        if (!isPracticeSearchQueryReady(term)) return

        rememberSearch(term)
        closeSearch()
        setQuery('')
        setResults([])
        setErrorMessage('')
        router.push(buildPracticeSearchResultsHref(term))
    }, [closeSearch, query, rememberSearch, router])

    const handleKeyDown = (event) => {
        if (event.key === 'Escape') {
            closeSearch()
            inputRef.current?.blur()
            return
        }

        if (event.key === 'ArrowDown' && navigableCount > 0) {
            event.preventDefault()
            setOpen(true)
            setActiveIndex((current) => (current + 1) % navigableCount)
            return
        }

        if (event.key === 'ArrowUp' && navigableCount > 0) {
            event.preventDefault()
            setOpen(true)
            setActiveIndex((current) => (current <= 0 ? navigableCount - 1 : current - 1))
            return
        }

        if (event.key === 'Enter') {
            if (activeIndex >= 0 && activeIndex < recentsCount) {
                event.preventDefault()
                applyRecentSearch(recentSearches[activeIndex])
                return
            }

            if (viewAllIndex >= 0 && activeIndex === viewAllIndex) {
                event.preventDefault()
                openResultsPage()
                return
            }

            if (assistantIndex >= 0 && activeIndex === assistantIndex) {
                event.preventDefault()
                askAssistant()
                return
            }

            const active = flatResults[activeIndex - recentsCount]
            if (active) {
                event.preventDefault()
                openResult(active)
                return
            }

            // Nothing highlighted yet: Enter opens the full results page so the
            // box can always reach every match for the term.
            if (showViewAllResults) {
                event.preventDefault()
                openResultsPage()
            }
        }
    }

    if (status !== 'ready') return null

    const term = query.trim()
    const showPanel = open && (term.length > 0 || recentsCount > 0)
    const showSpinner = searching && queryReady
    let runningIndex = recentsCount - 1

    return (
        <div ref={containerRef} className="relative hidden sm:block">
            <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                    ref={inputRef}
                    type="search"
                    value={query}
                    onChange={(event) => {
                        setQuery(event.target.value)
                        setOpen(true)
                    }}
                    onFocus={() => setOpen(true)}
                    onKeyDown={handleKeyDown}
                    aria-label={`Search practice${scopeLabel ? ` (${scopeLabel})` : ''}`}
                    className={`w-40 rounded-lg border border-gray-200/80 bg-white py-1.5 pl-8! pr-7! text-sm text-gray-900 shadow-md transition-shadow duration-150 hover:shadow-lg focus:border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-200/70 lg:w-64 [&::-webkit-search-cancel-button]:hidden ${showPanel ? 'shadow-lg' : ''}`}
                />
                {showSpinner && (
                    <Loader2 className="absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-gray-400" />
                )}
                {!showSpinner && term.length > 0 && (
                    <button
                        type="button"
                        onClick={clearSearch}
                        aria-label="Clear practice search"
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-300"
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                )}
            </div>

            {showPanel && (
                <div className="absolute right-0 z-50 mt-2 max-h-96 w-80 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                    {errorMessage && queryReady && (
                        <p className="px-3 py-3 text-sm text-red-600">{errorMessage}</p>
                    )}

                    {showRecentSearches && (
                        <div className="pb-1">
                            <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-2">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Recent</p>
                                <button
                                    type="button"
                                    onClick={clearRecentSearches}
                                    className="rounded text-[11px] text-gray-400 hover:text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-300"
                                >
                                    Clear
                                </button>
                            </div>
                            {recentSearches.map((recent, index) => (
                                <button
                                    key={recent}
                                    type="button"
                                    onMouseEnter={() => setActiveIndex(index)}
                                    onClick={() => applyRecentSearch(recent)}
                                    title={`Search for “${recent}”`}
                                    className={`flex w-full items-center gap-2 px-3 py-2 text-left ${index === activeIndex ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
                                >
                                    <Clock className="h-4 w-4 flex-none text-gray-400" />
                                    <span className="min-w-0 truncate text-sm text-gray-900">{recent}</span>
                                </button>
                            ))}
                        </div>
                    )}

                    {!errorMessage && queryReady && !showSpinner && flatResults.length === 0 && (
                        <p className="px-3 py-3 text-sm text-gray-500">
                            No matching {scopeLabel || 'records'}.
                            {showAssistant ? ' Try asking the assistant instead.' : ''}
                        </p>
                    )}

                    {!errorMessage && queryReady && showSpinner && flatResults.length === 0 && (
                        <p className="px-3 py-3 text-sm text-gray-500">Searching…</p>
                    )}

                    {/* The hint belongs to a term that has been started but is
                        still too short; an empty box is showing recents instead. */}
                    {!errorMessage && !emptyQuery && !queryReady && (
                        <p className="px-3 py-3 text-sm text-gray-500">
                            Keep typing to search {scopeLabel || 'the practice'}.
                        </p>
                    )}

                    {!errorMessage && groupedResults.map((group) => (
                        <div key={group.key} className="pb-1">
                            <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                                {group.label}
                            </p>
                            {group.items.map((result) => {
                                runningIndex += 1
                                const index = runningIndex
                                const Icon = resolveEntityIcon(result.type)

                                return (
                                    <button
                                        key={`${result.type}-${result.id}`}
                                        type="button"
                                        onMouseEnter={() => setActiveIndex(index)}
                                        onClick={() => openResult(result)}
                                        className={`flex w-full items-start gap-2 px-3 py-2 text-left ${index === activeIndex ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
                                    >
                                        <Icon className="mt-0.5 h-4 w-4 flex-none text-gray-400" />
                                        <span className="min-w-0">
                                            <span className="block truncate text-sm text-gray-900">{result.title}</span>
                                            {result.subtitle && (
                                                <span className="block truncate text-xs text-gray-500">{result.subtitle}</span>
                                            )}
                                        </span>
                                    </button>
                                )
                            })}
                        </div>
                    ))}

                    {/* Pinned to the bottom edge so the "See all results" and
                        Assistant actions stay reachable when a term fills the
                        panel with results. */}
                    <div className={(assistantIndex >= 0 || viewAllIndex >= 0) ? 'sticky bottom-0 z-10 bg-white' : ''}>
                        {viewAllIndex >= 0 && (
                            <div className={groupedResults.length > 0 ? 'border-t border-gray-100' : ''}>
                                <button
                                    type="button"
                                    onMouseEnter={() => setActiveIndex(viewAllIndex)}
                                    onClick={openResultsPage}
                                    title={`See all results for “${term}”`}
                                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left ${viewAllIndex === activeIndex ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
                                >
                                    <span className="truncate text-sm font-medium text-gray-700">See all results</span>
                                    <ArrowRight className="h-4 w-4 flex-none text-gray-400" />
                                </button>
                            </div>
                        )}

                        {showAssistant && (
                            <div className={`pb-1 ${groupedResults.length > 0 || viewAllIndex >= 0 ? 'border-t border-gray-100' : ''}`}>
                                {/* With no entity matches the row is the whole
                                    panel, so it reads as a suggestion. */}
                                <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                                    {assistantIsFallback ? 'Suggested' : 'Assistant'}
                                </p>
                                <button
                                    type="button"
                                    onMouseEnter={() => setActiveIndex(assistantIndex)}
                                    onClick={askAssistant}
                                    title={`Send “${term}” to the assistant`}
                                    className={`flex w-full items-start gap-2 px-3 py-2 text-left ${assistantIndex === activeIndex ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
                                >
                                    <AssistantAvatar
                                        domainKey={assistantConfig?.domainKey || ''}
                                        iconClassName="mt-0.5 h-4 w-4 flex-none text-gray-400"
                                        imageClassName="mt-0.5 h-4 w-4 flex-none"
                                    />
                                    <span className="min-w-0">
                                        <span className="block truncate text-sm text-gray-900">Ask the assistant</span>
                                        <span className="block truncate text-xs text-gray-500">“{term}”</span>
                                    </span>
                                </button>
                            </div>
                        )}

                        <p className="border-t border-gray-100 px-3 py-2 text-[11px] text-gray-400">
                            Searches {entityTypes.map((entityType) => entityType.label).join(', ')}
                        </p>
                    </div>
                </div>
            )}
        </div>
    )
}
