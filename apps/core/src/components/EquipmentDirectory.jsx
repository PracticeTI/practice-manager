'use client'

import { forwardRef, useDeferredValue, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import {
    EMPTY_EQUIPMENT_SUPPLIER,
    EQUIPMENT_BOOLEAN_FIELDS,
    EQUIPMENT_LIST_FIELDS,
    PROFESSION_ALIASES,
    equipmentSearchScore,
    getSupplierLogoUrl,
    matchesEquipmentField,
    matchesEquipmentFilters,
    normalizeEquipmentSupplier,
    normalizeProfession,
} from '@/lib/equipmentDirectory'
import { getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import {
    ALLIED_HEALTH_ENQUIRIES_EMAIL,
    AlliedHealthBrandBar,
    AlliedHealthPageHero,
    AlliedHealthUtilityBar,
    FOCUS_RING,
    PAGE_WASH,
} from '@/components/AlliedHealthShell'

const FIELD_LABELS = {
    supplier: 'Supplier', description: 'Description',
    equipment_categories: 'Equipment categories', product_types: 'Product types', professions: 'Specialisation',
    ndis_status: 'NDIS', geography: 'Geography', home_trials: 'Home trials', hire_rental: 'Hire / rental',
    quotes: 'Quotes', product_catalogue_url: 'Product catalogue', referral_contact: 'Referral / contact',
    typical_response_time: 'Typical response time', funding: 'Funding', specialist_equipment: 'Specialist equipment',
    repairs: 'Repairs', website_url: 'Website', email: 'Email', phone: 'Phone', brands: 'Brands',
    delivery: 'Delivery', trial_area: 'Trial area', last_verified_at: 'Last verified', status: 'Status',
}

const FORM_ROWS = [
    ['equipment_categories', 'product_types'], ['professions', 'geography'], ['ndis_status', 'funding'],
    ['specialist_equipment', 'brands'], ['product_catalogue_url', 'website_url'], ['referral_contact', 'typical_response_time'],
    ['email', 'phone'], ['trial_area', 'last_verified_at'],
]

const PROFESSION_SHORT_CODES = Object.fromEntries(Object.entries(PROFESSION_ALIASES).map(([key, value]) => [value, key]))
const ALL_FIELD_OPTIONS = ['supplier', 'description', ...EQUIPMENT_LIST_FIELDS, 'ndis_status', ...EQUIPMENT_BOOLEAN_FIELDS,
    'product_catalogue_url', 'referral_contact', 'typical_response_time', 'website_url', 'email', 'phone',
    'trial_area', 'last_verified_at', 'status']

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
function SupplierLogo({ name, logoUrl, size = 32 }) {
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

// Decorative blurred wash behind a supplier card, painted with the supplier's own
// favicon colours for subtle per-brand variety. The card body stays readable because
// the image is heavily blurred at low opacity behind opaque content.
// It only paints once the image really loads — Google's fallback 16x16 generic globe
// is treated as "no logo" so those cards keep a plain background.
function SupplierCardBackdrop({ websiteUrl, size = 256 }) {
    const [state, setState] = useState('loading') // 'loading' | 'ready' | 'hidden'
    const faviconUrl = getSupplierLogoUrl(websiteUrl, size)
    if (!faviconUrl || state === 'hidden') return null
    return (
        <Image
            src={faviconUrl}
            alt=""
            fill
            sizes="640px"
            unoptimized
            aria-hidden
            className={`pointer-events-none select-none object-cover blur-2xl saturate-150 transition-opacity duration-500 ${state === 'ready' ? 'opacity-10' : 'opacity-0'}`}
            onLoad={(event) => {
                const image = event.currentTarget
                if (image.naturalWidth <= 16 && image.naturalHeight <= 16) { setState('hidden'); return }
                setState('ready')
            }}
            onError={() => setState('hidden')}
        />
    )
}

function authHeaders(token, json = false) {
    return {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(json ? { 'Content-Type': 'application/json' } : {}),
    }
}

const EquipmentDirectory = forwardRef(function EquipmentDirectory({ manage = false, initialProfession = '', showHeader = true, superadminReview = false, embedded = false }, ref) {
    const router = useRouter()
    const [suppliers, setSuppliers] = useState([])
    const [deletedSuppliers, setDeletedSuppliers] = useState([])
    const [token, setToken] = useState('')
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [query, setQuery] = useState('')
    const [filters, setFilters] = useState(() => ({ professions: normalizeProfession(initialProfession) }))
    const [showAdvanced, setShowAdvanced] = useState(Boolean(initialProfession))
    const [favoritesOnly, setFavoritesOnly] = useState(false)
    const [fieldFilter, setFieldFilter] = useState({ field: 'supplier', value: '' })
    const [editing, setEditing] = useState(null)
    const [saving, setSaving] = useState(false)
    const [webSearching, setWebSearching] = useState(false)
    const [webSearchMessage, setWebSearchMessage] = useState('')
    const deferredQuery = useDeferredValue(query)

    useImperativeHandle(ref, () => ({
        openCreateForm: () => setEditing({ ...EMPTY_EQUIPMENT_SUPPLIER }),
    }))

    const loadSuppliers = async (adminToken = token, onlyFavorites = favoritesOnly) => {
        setLoading(true)
        setError('')
        try {
            const params = new URLSearchParams()
            if (manage && !superadminReview) params.set('admin', '1')
            if (manage && onlyFavorites) params.set('favorites', '1')
            const response = await fetch(superadminReview ? '/api/equipment/review' : `/api/equipment?${params}`, {
                cache: 'no-store',
                headers: authHeaders(adminToken),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data?.error || 'Unable to load suppliers')
            setSuppliers((data.suppliers || []).map(normalizeEquipmentSupplier))
            setDeletedSuppliers(data.deletions || [])
        } catch (loadError) {
            setError(loadError.message || 'Unable to load suppliers')
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
            await loadSuppliers(adminToken, false)
        }
        start()
        return () => { cancelled = true }
        // Initial load only; subsequent refreshes are triggered by actions.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [manage])

    useEffect(() => {
        if (!manage || suppliers.length === 0 || typeof window === 'undefined') return
        const supplierId = new URLSearchParams(window.location.search).get('supplier')
        if (!supplierId) return
        const supplier = suppliers.find((item) => String(item.id) === supplierId)
        if (!supplier) return
        const url = new URL(window.location.href)
        url.searchParams.delete('supplier')
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
        const timeoutId = window.setTimeout(() => setEditing({ ...supplier }), 0)
        return () => window.clearTimeout(timeoutId)
    }, [manage, suppliers])

    const filterOptions = useMemo(() => {
        const options = {}
        for (const field of [...EQUIPMENT_LIST_FIELDS, 'ndis_status']) {
            const selectedValue = filters[field]
            options[field] = Array.from(new Set([...suppliers.flatMap((supplier) => {
                const value = supplier[field]
                return Array.isArray(value) ? value : value ? [value] : []
            }), ...(selectedValue ? [selectedValue] : [])])).sort((left, right) => left.localeCompare(right))
        }
        return options
    }, [suppliers, filters])

    const visibleSuppliers = useMemo(() => suppliers
        .map((supplier) => ({ supplier, score: equipmentSearchScore(supplier, deferredQuery) }))
        .filter(({ supplier, score }) => score > 0 && matchesEquipmentFilters(supplier, filters) && matchesEquipmentField(supplier, fieldFilter.field, fieldFilter.value))
        .sort((left, right) => right.score - left.score || right.supplier.favorite_count - left.supplier.favorite_count || left.supplier.supplier.localeCompare(right.supplier.supplier))
        .map(({ supplier }) => supplier), [suppliers, deferredQuery, filters, fieldFilter])

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

    const toggleFavorite = async (supplier) => {
        if (!token) {
            router.push(`/login?returnTo=${encodeURIComponent('/allied-health/suppliers')}`)
            return
        }
        const favorite = !supplier.is_favorite
        setSuppliers((current) => current.map((item) => item.id === supplier.id ? {
            ...item,
            is_favorite: favorite,
            favorite_count: Math.max(0, item.favorite_count + (favorite ? 1 : -1)),
        } : item))
        const response = await fetch('/api/equipment/favorites', {
            method: 'POST', headers: authHeaders(token, true),
            body: JSON.stringify({ supplier_id: supplier.id, favorite }),
        })
        if (!response.ok) await loadSuppliers(token, favoritesOnly)
    }

    const saveSupplier = async (event) => {
        event.preventDefault()
        setSaving(true)
        setError('')
        const payload = normalizeEquipmentSupplier(editing)
        const isExisting = Boolean(payload.id)
        try {
            const response = await fetch(isExisting ? `/api/equipment/${payload.id}` : '/api/equipment', {
                method: isExisting ? 'PATCH' : 'POST',
                headers: authHeaders(token, true), body: JSON.stringify(payload),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data?.error || 'Unable to save supplier')
            setEditing(null)
            await loadSuppliers(token, favoritesOnly)
        } catch (saveError) {
            setError(saveError.message || 'Unable to save supplier')
        } finally {
            setSaving(false)
        }
    }

    const removeSupplier = async (supplier) => {
        if (!window.confirm(`Delete ${supplier.supplier}?`)) return
        const response = await fetch(`/api/equipment/${supplier.id}`, { method: 'DELETE', headers: authHeaders(token) })
        if (response.ok) {
            if (superadminReview) await loadSuppliers(token, favoritesOnly)
            else setSuppliers((current) => current.filter((item) => item.id !== supplier.id))
        }
    }

    const hideSupplier = async (supplier) => {
        if (!window.confirm(`Hide ${supplier.supplier} from all catalogs?`)) return
        const response = await fetch(`/api/equipment/review/${supplier.id}`, {
            method: 'PATCH',
            headers: authHeaders(token, true),
            body: JSON.stringify({ status: 'hidden' }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
            setError(data?.error || 'Unable to hide supplier')
            return
        }
        setSuppliers((current) => current.map((item) => item.id === supplier.id ? { ...item, status: 'hidden' } : item))
        setDeletedSuppliers((current) => current.map((item) => item.supplier_id === supplier.id ? { ...item, status: 'hidden' } : item))
    }

    const hardAddSupplier = async (supplier) => {
        const response = await fetch(`/api/equipment/review/${supplier.id}`, {
            method: 'PATCH',
            headers: authHeaders(token, true),
            body: JSON.stringify({ status: 'published' }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
            setError(data?.error || 'Unable to publish supplier')
            return
        }
        setSuppliers((current) => current.map((item) => item.id === supplier.id ? { ...item, status: 'published' } : item))
    }

    const searchWebForMoreSuppliers = async () => {
        const searchTerm = query.trim()
        if (!searchTerm || !token) return
        setWebSearching(true)
        setWebSearchMessage('')
        try {
            const response = await fetch('/api/equipment/web-search', {
                method: 'POST', headers: authHeaders(token, true),
                body: JSON.stringify({ query: searchTerm }),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data?.error || 'Web search failed')
            const addedNames = Array.isArray(data.added) ? data.added.map((supplier) => supplier.supplier).filter(Boolean) : []
            setWebSearchMessage(addedNames.length > 0
                ? `Added ${addedNames.length} new supplier${addedNames.length === 1 ? '' : 's'} from the web: ${addedNames.join(', ')}.`
                : 'No new allied health equipment suppliers found on the web.')
            if (addedNames.length > 0) await loadSuppliers(token, favoritesOnly)
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
            {showHeader && <AlliedHealthUtilityBar />}

            <div className={showHeader ? 'mx-auto w-full max-w-6xl px-6 pb-20 pt-6 sm:px-10 lg:px-14' : 'mx-auto max-w-7xl px-4 py-7 sm:px-6 lg:px-8'}>
                {showHeader && (
                    <>
                        <AlliedHealthBrandBar currentPath="/allied-health/suppliers" />
                        <AlliedHealthPageHero
                            eyebrow="Equipment supplier directory"
                            title="Allied health equipment supplier directory"
                            summary="Find suppliers by product, clinical need, funding pathway, trial availability, and service area."
                            trail={[{ label: 'Home', href: '/' }, { label: 'Allied health', href: '/allied-health' }, { label: 'Equipment suppliers' }]}
                            facts={[
                                { label: 'Coverage', value: 'Australia-wide' },
                                { label: 'Listings', value: loading ? 'Loading listings' : `${visibleSuppliers.length} matching listing${visibleSuppliers.length === 1 ? '' : 's'}` },
                                { label: 'Maintenance', value: 'Reviewed as information changes' },
                                { label: 'Enquiries', value: ALLIED_HEALTH_ENQUIRIES_EMAIL },
                            ]}
                            factsNote="Entries are compiled from publicly published supplier and product information."
                            action={manage ? <button type="button" onClick={() => setEditing({ ...EMPTY_EQUIPMENT_SUPPLIER })} className="rounded-full bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">Add supplier</button> : null}
                        />
                    </>
                )}

                <div className="mt-8 rounded-[1.5rem] border border-slate-200 bg-white/90 p-4 shadow-[0_20px_60px_-50px_rgba(15,23,42,0.45)] backdrop-blur-sm">
                    <div className="flex flex-col gap-3 md:flex-row">
                        <label className="min-w-0 flex-1">
                            <span className="sr-only">Search suppliers</span>
                            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search suppliers, products, brands or clinical needs" className={`w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-500 ${FOCUS_RING}`} />
                        </label>
                        <button type="button" onClick={() => setShowAdvanced((value) => !value)} className={`rounded-full border border-slate-300 bg-white px-5 py-2 text-sm font-semibold text-slate-800 hover:border-slate-400 hover:bg-slate-50 ${FOCUS_RING}`}>{showAdvanced ? 'Hide filters' : 'Advanced search'}</button>
                        {manage && <button type="button" onClick={() => { const next = !favoritesOnly; setFavoritesOnly(next); loadSuppliers(token, next) }} className={`rounded-full border px-5 py-2 text-sm font-semibold ${FOCUS_RING} ${favoritesOnly ? 'border-amber-400 bg-amber-50 text-amber-900' : 'border-slate-300 bg-white text-slate-800 hover:border-slate-400 hover:bg-slate-50'}`}>My favourites</button>}
                    </div>

                    {showAdvanced && (
                        <div className="mt-4 grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-2 lg:grid-cols-4">
                            {[...EQUIPMENT_LIST_FIELDS, 'ndis_status'].map((field) => (
                                <label key={field} className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-600">{FIELD_LABELS[field]}
                                    <select value={filters[field] || ''} onChange={(event) => setFilter(field, event.target.value)} className={`mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm font-normal normal-case tracking-normal text-slate-900 ${FOCUS_RING}`}>
                                        <option value="">Any</option>
                                        {(filterOptions[field] || []).map((option) => <option key={option} value={option}>{option}</option>)}
                                    </select>
                                </label>
                            ))}
                            {EQUIPMENT_BOOLEAN_FIELDS.map((field) => (
                                <label key={field} className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-600">{FIELD_LABELS[field]}
                                    <select value={filters[field] === undefined ? '' : String(filters[field])} onChange={(event) => setFilter(field, event.target.value === '' ? undefined : event.target.value === 'true')} className={`mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm font-normal normal-case tracking-normal text-slate-900 ${FOCUS_RING}`}>
                                        <option value="">Any</option><option value="true">Yes</option><option value="false">No</option>
                                    </select>
                                </label>
                            ))}
                            <label className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-600">Filter any field
                                <select value={fieldFilter.field} onChange={(event) => setFieldFilter((current) => ({ ...current, field: event.target.value }))} className={`mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm font-normal normal-case tracking-normal text-slate-900 ${FOCUS_RING}`}>
                                    {ALL_FIELD_OPTIONS.map((field) => <option key={field} value={field}>{FIELD_LABELS[field] || 'Supplier'}</option>)}
                                </select>
                            </label>
                            <label className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-600">Contains
                                <input value={fieldFilter.value} onChange={(event) => setFieldFilter((current) => ({ ...current, value: event.target.value }))} className={`mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm font-normal normal-case tracking-normal text-slate-900 ${FOCUS_RING}`} placeholder="Enter a value" />
                            </label>
                            {hasFilters && <button type="button" onClick={() => { setFilters({}); setFieldFilter({ field: 'supplier', value: '' }); setFilter('professions', '') }} className={`self-end rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400 hover:bg-slate-50 ${FOCUS_RING}`}>Clear filters</button>}
                        </div>
                    )}
                </div>

                <div className="my-5 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
                    <p>{loading ? 'Loading suppliers…' : `${visibleSuppliers.length} listing${visibleSuppliers.length === 1 ? '' : 's'} shown`}</p>
                    {initialProfession && <p>Specialisation filter: <span className="font-semibold text-slate-800">{normalizeProfession(initialProfession)}</span></p>}
                </div>
                {error && <div className="mb-5 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

                {superadminReview ? (
                    <>
                        <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                            <div className="border-b border-slate-200 px-5 py-4"><h2 className="text-lg font-semibold text-slate-900">Suppliers</h2></div>
                            <table className="w-full min-w-[760px] text-left text-sm">
                                <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-600"><tr><th className="px-5 py-3">Supplier</th><th className="px-5 py-3">Website</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Domain</th><th className="px-5 py-3">Updated</th><th className="px-5 py-3 text-right">Actions</th></tr></thead>
                                <tbody className="divide-y divide-slate-200">{visibleSuppliers.map((supplier) => <tr key={supplier.id} className="text-slate-700"><td className="px-5 py-3 font-semibold text-slate-900"><div className="flex items-center gap-2"><SupplierLogo name={supplier.supplier} logoUrl={supplier.logo_url} size={20} />{supplier.supplier}</div></td><td className="max-w-xs truncate px-5 py-3">{supplier.website_url || 'Not listed'}</td><td className="px-5 py-3 capitalize">{supplier.status}</td><td className="px-5 py-3">{supplier.domain || 'Global'}</td><td className="px-5 py-3">{supplier.updated_at ? new Date(supplier.updated_at).toLocaleDateString() : 'Not listed'}</td><td className="px-5 py-3 text-right"><div className="flex justify-end gap-3 font-semibold"><button type="button" onClick={() => setEditing({ ...supplier })} className="text-slate-700 underline underline-offset-2 hover:text-slate-950">Edit</button>{supplier.status === 'admin_added' && <button type="button" onClick={() => hardAddSupplier(supplier)} className="text-slate-700 underline underline-offset-2 hover:text-slate-950">Hard add</button>}{supplier.status !== 'hidden' && <button type="button" onClick={() => hideSupplier(supplier)} className="text-amber-700 underline underline-offset-2">Hide</button>}<button type="button" onClick={() => removeSupplier(supplier)} className="text-red-700 underline underline-offset-2">Delete</button></div></td></tr>)}</tbody>
                            </table>
                            {!loading && visibleSuppliers.length === 0 && <p className="px-5 py-8 text-sm text-slate-500">No suppliers found.</p>}
                        </section>
                        <section className="mt-6 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                            <div className="border-b border-slate-200 px-5 py-4"><h2 className="text-lg font-semibold text-slate-900">Admin-deleted records</h2><p className="mt-1 text-sm text-slate-500">Review records removed from an individual admin&apos;s view and hide them globally when appropriate.</p></div>
                            {deletedSuppliers.length === 0 ? <p className="px-5 py-8 text-sm text-slate-500">No admin-deleted records to review.</p> : <table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-amber-100 text-xs uppercase tracking-wide text-amber-800"><tr><th className="px-5 py-3">Supplier</th><th className="px-5 py-3">Admin</th><th className="px-5 py-3">Deleted</th><th className="px-5 py-3">Status</th><th className="px-5 py-3 text-right">Action</th></tr></thead><tbody className="divide-y divide-slate-200">{deletedSuppliers.map((item) => <tr key={item.id} className="text-slate-700"><td className="px-5 py-3 font-semibold text-slate-900">{item.supplier}</td><td className="px-5 py-3">{item.admin_key}</td><td className="px-5 py-3">{item.created_at ? new Date(item.created_at).toLocaleDateString() : 'Not listed'}</td><td className="px-5 py-3 capitalize">{item.status || 'Unknown'}</td><td className="px-5 py-3 text-right">{item.status === 'hidden' ? <span className="text-slate-500">Hidden globally</span> : <button type="button" onClick={() => hideSupplier({ id: item.supplier_id, supplier: item.supplier })} className="font-semibold text-amber-700 underline underline-offset-2">Hide globally</button>}</td></tr>)}</tbody></table>}
                        </section>
                    </>
                ) : !loading && visibleSuppliers.length === 0 ? (
                    <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
                        <h2 className="text-lg font-semibold text-slate-900">No matching suppliers</h2>
                        <p className="mt-1 text-sm text-slate-500">Try a broader search or clear one of the filters.</p>
                    </div>
                ) : (
                    <div className="grid gap-4 lg:grid-cols-2">
                        {visibleSuppliers.map((supplier) => <SupplierCard key={supplier.id} supplier={supplier} canFavorite={Boolean(token)} manage={manage} embedded={embedded} onFavorite={toggleFavorite} onEdit={setEditing} onDelete={removeSupplier} />)}
                    </div>
                )}

                {Boolean(token) && manage && !superadminReview && (
                    <div className="mt-6 flex flex-col items-center gap-2">
                        <button
                            type="button"
                            onClick={searchWebForMoreSuppliers}
                            disabled={webSearching || !query.trim()}
                            className={`rounded-full border border-slate-300 bg-white px-6 py-2 text-sm font-semibold text-slate-800 hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
                            title={query.trim() ? 'Search the web for more suppliers matching your search' : 'Enter a search term above to search the web'}
                        >
                            {webSearching ? 'Searching the web...' : 'More'}
                        </button>
                        {webSearchMessage && <p className="text-xs text-slate-500">{webSearchMessage}</p>}
                    </div>
                )}
            </div>

            {editing && <SupplierEditor supplier={editing} saving={saving} allowHidden={superadminReview} onChange={setEditing} onClose={() => setEditing(null)} onSubmit={saveSupplier} />}
        </div>
    )
})

export default EquipmentDirectory

function SupplierCard({ supplier, canFavorite, manage, embedded, onFavorite, onEdit, onDelete }) {
    const serviceFlags = EQUIPMENT_BOOLEAN_FIELDS.filter((field) => supplier[field]).map((field) => FIELD_LABELS[field])
    return (
        <article className={`relative flex flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-[0_20px_60px_-52px_rgba(15,23,42,0.45)] transition ${embedded ? '' : 'hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_28px_70px_-50px_rgba(15,23,42,0.55)]'}`}>
            {manage && <SupplierCardBackdrop websiteUrl={supplier.website_url} />}
            <div className="relative flex flex-1 flex-col">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                        <SupplierLogo name={supplier.supplier} logoUrl={supplier.logo_url} size={32} />
                        <div><h2 className="text-lg font-semibold text-slate-900">{supplier.supplier}</h2><p className="mt-1 text-sm text-slate-500">{supplier.geography.join(' · ') || 'Service area not listed'}</p></div>
                    </div>
                    <button type="button" onClick={() => onFavorite(supplier)} className={`shrink-0 rounded-full px-2 py-1 text-xl leading-none ${FOCUS_RING} ${supplier.is_favorite ? 'text-amber-600' : 'text-slate-300 hover:text-slate-400'}`} title={canFavorite ? 'Toggle favourite' : 'Admin sign-in required'} aria-label={supplier.is_favorite ? 'Remove favourite' : 'Add favourite'}>{supplier.is_favorite ? '★' : '☆'}</button>
                </div>
                {supplier.description && <p className="mt-3 text-sm leading-6 text-slate-600">{supplier.description}</p>}
                <div className="mt-4 flex flex-wrap gap-2">
                    {[...new Set([...supplier.equipment_categories, ...supplier.product_types])].slice(0, 8).map((item) => <span key={item} className={`rounded-full border px-2.5 py-1 text-xs ${embedded ? 'border-gray-200 bg-gray-50 text-gray-700' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>{item}</span>)}
                </div>
                <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-100 pt-4 text-sm">
                    <div><dt className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Specialisation</dt><dd className="mt-0.5 text-slate-700">{supplier.professions.join(', ') || 'All'}</dd></div>
                    <div><dt className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">NDIS</dt><dd className="mt-0.5 text-slate-700">{supplier.ndis_status || 'Not listed'}</dd></div>
                    <div><dt className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Funding</dt><dd className="mt-0.5 text-slate-700">{supplier.funding.join(', ') || 'Not listed'}</dd></div>
                    <div><dt className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Response</dt><dd className="mt-0.5 text-slate-700">{supplier.typical_response_time || 'Not listed'}</dd></div>
                </dl>
                {serviceFlags.length > 0 && <p className="mt-4 text-xs text-slate-500">{serviceFlags.join(' · ')}</p>}
                <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 text-sm">
                    {supplier.favorite_count > 0 && <p className="text-xs font-semibold text-amber-800">Favourited by {supplier.favorite_count} provider{supplier.favorite_count === 1 ? '' : 's'}</p>}
                    <div className="flex items-center gap-4 font-semibold">
                        {supplier.product_catalogue_url && <a href={supplier.product_catalogue_url} target="_blank" rel="noreferrer" className={`rounded text-slate-700 underline underline-offset-2 hover:text-slate-950 ${FOCUS_RING}`}>Catalogue</a>}
                        {supplier.website_url && <a href={supplier.website_url} target="_blank" rel="noreferrer" className={`rounded text-slate-700 underline underline-offset-2 hover:text-slate-950 ${FOCUS_RING}`}>Website</a>}
                        {manage && <button type="button" onClick={() => onEdit({ ...supplier })} className={`rounded text-slate-700 underline underline-offset-2 hover:text-slate-950 ${FOCUS_RING}`}>Edit</button>}
                        {manage && <button type="button" onClick={() => onDelete(supplier)} className={`rounded text-red-700 underline underline-offset-2 hover:text-red-800 ${FOCUS_RING}`}>Delete</button>}
                    </div>
                </div>
            </div>
        </article>
    )
}

function SupplierEditor({ supplier, saving, allowHidden = false, onChange, onClose, onSubmit }) {
    const update = (field, value) => onChange({ ...supplier, [field]: value })
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
            <form onSubmit={onSubmit} className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-[1.5rem] bg-white p-6 shadow-xl">
                <div className="mb-5 flex items-center justify-between"><h2 className="text-xl font-semibold text-slate-900">{supplier.id ? 'Supplier' : 'Add supplier'}</h2><button type="button" onClick={onClose} className={`rounded-full px-2 text-2xl leading-none text-slate-500 hover:text-slate-900 ${FOCUS_RING}`} aria-label="Close">x</button></div>
                <div className="grid gap-4 md:grid-cols-2">
                    <label className="text-sm font-semibold md:col-span-2">Supplier<input required value={supplier.supplier || ''} onChange={(event) => update('supplier', event.target.value)} className="mt-1 w-full font-normal" /></label>
                    <label className="text-sm font-semibold md:col-span-2">Description<textarea value={supplier.description || ''} onChange={(event) => update('description', event.target.value)} rows="3" className="mt-1 w-full font-normal" /></label>
                    {FORM_ROWS.flat().map((field) => <label key={field} className="text-sm font-semibold">{FIELD_LABELS[field]}<input type={field.includes('url') ? 'url' : field === 'email' ? 'email' : field === 'last_verified_at' ? 'date' : 'text'} value={EQUIPMENT_LIST_FIELDS.includes(field) ? listText(supplier[field]) : supplier[field] || ''} onChange={(event) => update(field, EQUIPMENT_LIST_FIELDS.includes(field) ? event.target.value.split(',').map((item) => item.trim()).filter(Boolean) : event.target.value)} placeholder={EQUIPMENT_LIST_FIELDS.includes(field) ? 'Comma separated' : ''} className="mt-1 w-full font-normal" /></label>)}
                    <label className="text-sm font-semibold">Status<select value={supplier.status || 'published'} onChange={(event) => update('status', event.target.value)} className="mt-1 w-full font-normal"><option value="published">Published</option><option value="draft">Draft</option><option value="archived">Archived</option>{allowHidden && <option value="admin_added">Admin added</option>}{allowHidden && <option value="hidden">Hidden</option>}</select></label>
                    <div className="flex flex-wrap items-end gap-4 md:col-span-2">{EQUIPMENT_BOOLEAN_FIELDS.map((field) => <label key={field} className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={Boolean(supplier[field])} onChange={(event) => update(field, event.target.checked)} />{FIELD_LABELS[field]}</label>)}</div>
                </div>
                <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className={`rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 ${FOCUS_RING}`}>Cancel</button><button disabled={saving} type="submit" className={`rounded-full bg-slate-950 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 ${FOCUS_RING}`}>{saving ? 'Saving...' : 'Save supplier'}</button></div>
            </form>
        </div>
    )
}