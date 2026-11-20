'use client'

import { useEffect, useMemo, useState } from 'react'
import {
    BadgeDollarSign,
    BookMarked,
    ClipboardCheck,
    ClipboardList,
    Compass,
    ExternalLink,
    FileDown,
    Link2,
    LibraryBig,
    Scale,
    Search,
    ShieldCheck,
    StickyNote,
    X,
} from 'lucide-react'
import {
    FUNDER_DOCUMENT_CATEGORIES,
    getFunderDocumentCategoryLabel,
    getFunderDocumentTypeLabel,
    groupFunderDocumentsByCategory,
} from '@/lib/funders'
import { getFunderLinkStatusLabel, isProblemLinkStatus } from '@/lib/funderLinkCheck'

/**
 * Read-only "reference library" view of the Funders entity.
 *
 * Domain admins never write this data — it is maintained in
 * `src/lib/funderRegistry.js` and refreshed by the link-check tooling — so the
 * page is presented as a browsable library: pick a funder, filter, and open the
 * published documentation. The editing UI lives behind a superadmin "Manage"
 * toggle in the page shell (`/admin/funders`).
 */

const EMPTY_DOCUMENTS = []

/** Each category gets its own glyph and tint so the groups read at a glance. */
const CATEGORY_ICONS = {
    pricing: BadgeDollarSign,
    catalogue: LibraryBig,
    registration: ClipboardCheck,
    standards: ShieldCheck,
    policy: Scale,
    guidance: Compass,
    forms: ClipboardList,
    reference: BookMarked,
}

const CATEGORY_TONES = {
    pricing: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    catalogue: 'bg-indigo-50 text-indigo-700 ring-indigo-100',
    registration: 'bg-sky-50 text-sky-700 ring-sky-100',
    standards: 'bg-violet-50 text-violet-700 ring-violet-100',
    policy: 'bg-rose-50 text-rose-700 ring-rose-100',
    guidance: 'bg-amber-50 text-amber-700 ring-amber-100',
    forms: 'bg-teal-50 text-teal-700 ring-teal-100',
    reference: 'bg-slate-100 text-slate-700 ring-slate-200',
}
const DEFAULT_TONE = 'bg-slate-100 text-slate-700 ring-slate-200'

const DOCUMENT_TYPE_ICONS = { link: Link2, file: FileDown, note: StickyNote }

/**
 * Funder marks are optional assets: drop `public/funders/<key>.png` in and it is
 * used automatically, otherwise the record falls back to a monogram.
 *
 * Two caches, mirroring `resolveAssistantIconUrl`: the promise map means the
 * selector card and the hero mark for the same funder share ONE request, and the
 * resolved map gives a synchronous hit so a remount never flashes the monogram.
 */
const FUNDER_LOGO_PROMISES = new Map()
const FUNDER_LOGO_RESOLVED = new Map()

function loadFunderLogo(funderKey) {
    if (!FUNDER_LOGO_PROMISES.has(funderKey)) {
        const path = `/funders/${funderKey}.png`
        FUNDER_LOGO_PROMISES.set(funderKey, fetch(path, { method: 'HEAD', cache: 'no-store' })
            .then((response) => {
                const resolved = response.ok ? path : null
                FUNDER_LOGO_RESOLVED.set(funderKey, resolved)
                return resolved
            })
            .catch(() => {
                FUNDER_LOGO_RESOLVED.set(funderKey, null)
                return null
            }))
    }
    return FUNDER_LOGO_PROMISES.get(funderKey)
}

/** Render the mark with `key={funder.key}` so a new funder remounts with the right state. */
function useFunderLogo(funderKey) {
    const [logoUrl, setLogoUrl] = useState(() => FUNDER_LOGO_RESOLVED.get(funderKey) ?? null)

    useEffect(() => {
        // Already known — the mount state above is correct, and setState in the
        // effect body is not allowed here.
        if (!funderKey || FUNDER_LOGO_RESOLVED.has(funderKey)) return undefined

        let cancelled = false
        loadFunderLogo(funderKey).then((resolved) => {
            if (!cancelled) setLogoUrl(resolved)
        })

        return () => {
            cancelled = true
        }
    }, [funderKey])

    return logoUrl
}

function initialsFor(value) {
    return String(value || '')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 3)
        .map((word) => word[0])
        .join('')
        .toUpperCase() || '?'
}

/**
 * Funder mark: the logo asset when present, a monogram otherwise. Render with
 * `key={funder.key}` so a different funder remounts with the right initial state.
 */
function FunderMark({ funder, size = 'md' }) {
    const logoUrl = useFunderLogo(funder?.key)
    const dimensions = size === 'lg' ? 'h-16 w-16 text-lg' : 'h-11 w-11 text-sm'
    const radius = size === 'lg' ? 'rounded-2xl' : 'rounded-xl'

    return (
        <span className={`${dimensions} ${radius} inline-flex shrink-0 items-center justify-center overflow-hidden bg-slate-900 font-semibold text-white ring-1 ring-inset ring-slate-900/10`}>
            {logoUrl ? (
                // A plain <img> keeps this working for any raster the practice drops in.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="" className="h-full w-full object-contain" />
            ) : (
                <span aria-hidden="true">{initialsFor(funder?.name)}</span>
            )}
        </span>
    )
}

function StatTile({ label, value, hint }) {
    return (
        <div className="rounded-xl border border-slate-200 bg-white/80 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-0.5 text-xl font-bold text-slate-900">{value}</p>
            {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
        </div>
    )
}

function FunderSelectorCard({ funder, isActive, onSelect }) {
    const documentCount = (funder.documents || []).length

    return (
        <button
            type="button"
            onClick={() => onSelect(funder.key)}
            aria-pressed={isActive}
            className={`group flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all ${isActive
                ? 'border-slate-900 bg-slate-900 text-white shadow-md'
                : 'border-slate-200 bg-white hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md'
                }`}
        >
            <FunderMark key={funder.key} funder={funder} />
            <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{funder.name}</span>
                <span className={`block truncate text-xs ${isActive ? 'text-slate-300' : 'text-slate-500'}`}>
                    {funder.full_name || funder.jurisdiction || 'Funder'}
                </span>
            </span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${isActive ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-600'}`}>
                {documentCount}
            </span>
        </button>
    )
}

function DocumentCard({ document }) {
    const category = document.category
    const CategoryIcon = CATEGORY_ICONS[category] || BookMarked
    const TypeIcon = DOCUMENT_TYPE_ICONS[document.doc_type] || Link2
    const linkProblem = isProblemLinkStatus(document.link_status)
    const isLinkable = Boolean(document.url)

    const inner = (
        <>
            <div className="flex items-start justify-between gap-3">
                <span className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ring-1 ring-inset ${CATEGORY_TONES[category] || DEFAULT_TONE}`}>
                    <CategoryIcon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="flex flex-wrap items-center justify-end gap-1">
                    {document.is_primary && (
                        <span className="inline-flex rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                            Primary
                        </span>
                    )}
                    {document.effective_period && (
                        <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                            {document.effective_period}
                        </span>
                    )}
                    {linkProblem && (
                        <span
                            className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${document.link_status === 'blocked' ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-red-300 bg-red-50 text-red-700'}`}
                            title={`Last link check: ${getFunderLinkStatusLabel(document.link_status)}${document.http_status ? ` (HTTP ${document.http_status})` : ''}`}
                        >
                            {getFunderLinkStatusLabel(document.link_status)}
                        </span>
                    )}
                </span>
            </div>

            <p className="mt-3 font-semibold leading-snug text-slate-900 group-hover:text-slate-700">
                {document.title}
            </p>

            {document.description && (
                <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-slate-600">{document.description}</p>
            )}

            <span className="mt-auto flex items-center gap-1 pt-3 text-[11px] font-medium text-slate-500 group-hover:text-slate-700">
                <TypeIcon className="h-3 w-3" aria-hidden="true" />
                {getFunderDocumentTypeLabel(document.doc_type)}
                {isLinkable && <ExternalLink className="ml-auto h-3.5 w-3.5" aria-hidden="true" />}
            </span>
        </>
    )

    const cardClass = 'group flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all'
    const interactiveClass = `${cardClass} hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500`

    if (!isLinkable) {
        return (
            <div className={cardClass} aria-label={`${document.title} (no link)`}>
                {inner}
            </div>
        )
    }

    return (
        <a href={document.url} target="_blank" rel="noreferrer" className={interactiveClass}>
            {inner}
        </a>
    )
}

function CategorySection({ group }) {
    const CategoryIcon = CATEGORY_ICONS[group.category] || BookMarked
    const description = FUNDER_DOCUMENT_CATEGORIES.find((category) => category.value === group.category)?.description || ''

    return (
        <section className="space-y-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-700">
                    <CategoryIcon className="h-4 w-4 text-slate-500" aria-hidden="true" />
                    {group.label}
                </h3>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                    {group.documents.length}
                </span>
                {description && <p className="text-xs text-slate-500">{description}</p>}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {group.documents.map((document) => (
                    <DocumentCard key={document.id ?? `${group.category}-${document.key}`} document={document} />
                ))}
            </div>
        </section>
    )
}

export default function FunderLibrary({ funders = [], selectedFunderKey = '', onSelectFunder }) {
    const [documentQuery, setDocumentQuery] = useState('')
    const [categoryFilter, setCategoryFilter] = useState('all')

    const selectedFunder = useMemo(
        () => funders.find((funder) => funder.key === selectedFunderKey) || funders[0] || null,
        [funders, selectedFunderKey]
    )

    const documents = selectedFunder?.documents || EMPTY_DOCUMENTS
    const query = documentQuery.trim().toLowerCase()

    const categoryCounts = useMemo(() => {
        const counts = new Map()
        for (const document of documents) {
            counts.set(document.category, (counts.get(document.category) || 0) + 1)
        }
        return counts
    }, [documents])

    const filteredDocuments = useMemo(() => {
        return documents.filter((document) => {
            if (categoryFilter !== 'all' && document.category !== categoryFilter) return false
            if (!query) return true

            return [
                document.title,
                document.description,
                document.effective_period,
                getFunderDocumentCategoryLabel(document.category),
            ].some((value) => String(value || '').toLowerCase().includes(query))
        })
    }, [documents, categoryFilter, query])

    const groupedDocuments = useMemo(
        () => groupFunderDocumentsByCategory(filteredDocuments),
        [filteredDocuments]
    )

    const totals = useMemo(() => {
        const all = funders.flatMap((funder) => funder.documents || [])
        const lastChecked = all
            .map((document) => document.link_checked_at)
            .filter(Boolean)
            .sort()
            .pop()

        return {
            funders: funders.length,
            documents: all.length,
            checked: all.filter((document) => Boolean(document.link_status)).length,
            lastCheckedAt: lastChecked || '',
        }
    }, [funders])

    // Categories with documents, in the registry's order.
    const availableCategories = useMemo(
        () => FUNDER_DOCUMENT_CATEGORIES
            .filter((category) => categoryCounts.has(category.value))
            .map((category) => ({ ...category, count: categoryCounts.get(category.value) || 0 })),
        [categoryCounts]
    )

    const isFiltered = Boolean(query) || categoryFilter !== 'all'

    return (
        <div className="space-y-8">
            {/* Library overview */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatTile label="Funders" value={totals.funders} hint={funders.map((funder) => funder.name).join(' · ')} />
                <StatTile label="Documents" value={totals.documents} hint="Published reference material" />
                <StatTile label="Link checked" value={`${totals.checked}/${totals.documents}`} hint="URLs verified by the link check" />
                <StatTile
                    label="Last check"
                    value={totals.lastCheckedAt ? totals.lastCheckedAt.slice(0, 10) : '—'}
                    hint={totals.lastCheckedAt ? 'Most recent verification' : 'Never run'}
                />
            </div>

            {/* Funder picker */}
            {funders.length > 1 && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {funders.map((funder) => (
                        <FunderSelectorCard
                            key={funder.key}
                            funder={funder}
                            isActive={funder.key === (selectedFunder?.key || '')}
                            onSelect={onSelectFunder}
                        />
                    ))}
                </div>
            )}

            {selectedFunder ? (
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    {/* Funder hero */}
                    <div className="flex flex-wrap items-start gap-5 border-b border-slate-100 bg-gradient-to-br from-slate-50 via-white to-white p-6">
                        <FunderMark key={selectedFunder.key} funder={selectedFunder} size="lg" />

                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                                <h2 className="text-2xl font-bold text-slate-900">{selectedFunder.name}</h2>
                                {selectedFunder.jurisdiction && (
                                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600">
                                        {selectedFunder.jurisdiction}
                                    </span>
                                )}
                                {selectedFunder.status !== 'published' && (
                                    <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                                        {selectedFunder.status}
                                    </span>
                                )}
                            </div>

                            {selectedFunder.full_name && (
                                <p className="mt-0.5 text-sm font-medium text-slate-600">{selectedFunder.full_name}</p>
                            )}
                            {selectedFunder.description && (
                                <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">{selectedFunder.description}</p>
                            )}

                            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                                <span className="text-slate-500">
                                    {documents.length} document{documents.length === 1 ? '' : 's'} across{' '}
                                    {availableCategories.length} categor{availableCategories.length === 1 ? 'y' : 'ies'}
                                </span>
                                {selectedFunder.website_url && (
                                    <a
                                        href={selectedFunder.website_url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-1 font-medium text-slate-700 underline decoration-slate-300 underline-offset-2 hover:text-slate-900"
                                    >
                                        {selectedFunder.website_url.replace(/^https?:\/\//, '')}
                                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                                    </a>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Toolbar: search + category filter */}
                    <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-6 py-3">
                        <label className="relative min-w-[220px] flex-1 sm:max-w-xs">
                            <span className="sr-only">Search {selectedFunder.name} documents</span>
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                            <input
                                type="search"
                                value={documentQuery}
                                onChange={(event) => setDocumentQuery(event.target.value)}
                                placeholder="Search documents…"
                                className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-8 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                            />
                            {documentQuery && (
                                <button
                                    type="button"
                                    onClick={() => setDocumentQuery('')}
                                    aria-label="Clear search"
                                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700"
                                >
                                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                            )}
                        </label>

                        <div className="flex flex-wrap items-center gap-1.5">
                            <button
                                type="button"
                                onClick={() => setCategoryFilter('all')}
                                aria-pressed={categoryFilter === 'all'}
                                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${categoryFilter === 'all' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'}`}
                            >
                                All ({documents.length})
                            </button>
                            {availableCategories.map((category) => (
                                <button
                                    key={category.value}
                                    type="button"
                                    onClick={() => setCategoryFilter(category.value)}
                                    aria-pressed={categoryFilter === category.value}
                                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${categoryFilter === category.value ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'}`}
                                >
                                    {category.label} ({category.count})
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Grouped document cards */}
                    <div className="space-y-8 p-6">
                        {isFiltered && (
                            <p className="text-xs text-slate-500">
                                Showing {filteredDocuments.length} of {documents.length} documents
                                {query ? ` matching “${documentQuery.trim()}”` : ''}
                                {categoryFilter !== 'all' ? ` in ${getFunderDocumentCategoryLabel(categoryFilter)}` : ''}
                            </p>
                        )}

                        {groupedDocuments.map((group) => (
                            <CategorySection key={group.category} group={group} />
                        ))}

                        {groupedDocuments.length === 0 && (
                            <p className="rounded-2xl border border-dashed border-slate-300 px-6 py-12 text-center text-sm text-slate-500">
                                {documents.length === 0
                                    ? `${selectedFunder.name} has no documents yet.`
                                    : 'No documents match those filters.'}
                            </p>
                        )}
                    </div>
                </div>
            ) : (
                <p className="rounded-2xl border border-dashed border-slate-300 px-6 py-12 text-center text-sm text-slate-500">
                    No funders have been configured yet.
                </p>
            )}
        </div>
    )
}
