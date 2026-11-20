'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Loader2, Search, X } from 'lucide-react'
import { getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'

// The picker only looks patients up once a couple of letters are typed. A native
// datalist would open on focus and drop the whole patient list onto the field,
// which is unhelpful in a practice with hundreds of records.
export const PATIENT_SEARCH_MIN_CHARS = 2

const SEARCH_DEBOUNCE_MS = 250
const SUGGESTION_LIMIT = 20

async function searchPatients(domain, query) {
    const token = await getOrCreateAdminTokenForLocalhost()
    const params = new URLSearchParams({ domain, search: query, limit: String(SUGGESTION_LIMIT) })
    const response = await fetch(`/api/database/patients?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: 'no-store',
    })
    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
        throw new Error(data?.error || 'Failed to search patients')
    }

    return (Array.isArray(data?.data) ? data.data : [])
        .map((row) => ({
            id: row?.id,
            name: String(row?.patient_name || '').trim() || `Patient #${row?.id}`,
        }))
        .filter((row) => row.id)
}

function patientName(patient) {
    return String(patient?.name || '').trim() || (patient?.id ? `Patient #${patient.id}` : '')
}

/**
 * Multi-select for the patients a contact is linked to.
 *
 * `value` / `onChange` follow the usual controlled shape: an array of
 * `{ id, name }` in the order they were linked. Names are carried alongside the
 * ids so a saved row can render its links without a lookup, and the search
 * response supplies the name for anything added.
 */
export default function PatientLinkPicker({ domain, value, onChange, disabled = false }) {
    const selected = useMemo(() => (Array.isArray(value) ? value : []), [value])
    const [query, setQuery] = useState('')
    const [results, setResults] = useState([])
    const [searching, setSearching] = useState(false)
    const [searchFailed, setSearchFailed] = useState(false)
    const [open, setOpen] = useState(false)
    const [highlight, setHighlight] = useState(0)
    const containerRef = useRef(null)
    const listboxId = useId()

    const trimmedQuery = query.trim()
    const hasEnoughText = trimmedQuery.length >= PATIENT_SEARCH_MIN_CHARS

    const selectedIds = useMemo(() => new Set(selected.map((patient) => patient?.id)), [selected])
    // Already-linked patients are left out: re-adding one would be a no-op and
    // would push the useful suggestions off the list.
    const suggestions = useMemo(
        () => (hasEnoughText ? results.filter((patient) => !selectedIds.has(patient.id)) : []),
        [hasEnoughText, results, selectedIds]
    )

    useEffect(() => {
        if (!domain || !hasEnoughText) return undefined

        let cancelled = false
        const handle = setTimeout(async () => {
            setSearching(true)
            try {
                const rows = await searchPatients(domain, trimmedQuery)
                if (cancelled) return
                setResults(rows)
                setHighlight(0)
                setSearchFailed(false)
                setOpen(true)
            } catch {
                if (cancelled) return
                setResults([])
                setSearchFailed(true)
                setOpen(true)
            } finally {
                if (!cancelled) setSearching(false)
            }
        }, SEARCH_DEBOUNCE_MS)

        return () => {
            cancelled = true
            clearTimeout(handle)
        }
    }, [domain, hasEnoughText, trimmedQuery])

    useEffect(() => {
        if (!open) return undefined

        const handleMouseDown = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false)
        }

        document.addEventListener('mousedown', handleMouseDown)
        return () => document.removeEventListener('mousedown', handleMouseDown)
    }, [open])

    const addPatient = useCallback((patient) => {
        if (!patient?.id || selectedIds.has(patient.id)) return
        onChange([...selected, { id: patient.id, name: patientName(patient) }])
        setQuery('')
        setResults([])
        setOpen(false)
        setHighlight(0)
    }, [onChange, selected, selectedIds])

    const removePatient = useCallback((patientId) => {
        onChange(selected.filter((patient) => patient?.id !== patientId))
    }, [onChange, selected])

    const handleKeyDown = (event) => {
        if (event.key === 'Escape' && open) {
            // Keep the editor modal open — this Escape only closes the suggestions.
            event.stopPropagation()
            setOpen(false)
            return
        }

        if (!open || suggestions.length === 0) return

        if (event.key === 'ArrowDown') {
            event.preventDefault()
            setHighlight((prev) => (prev + 1) % suggestions.length)
        } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setHighlight((prev) => (prev - 1 + suggestions.length) % suggestions.length)
        } else if (event.key === 'Enter') {
            // Enter would otherwise submit the contact form.
            event.preventDefault()
            addPatient(suggestions[highlight] || suggestions[0])
        }
    }

    const showEmptyState = open && !searching && suggestions.length === 0

    return (
        <div ref={containerRef} className="relative">
            {selected.length > 0 && (
                <ul className="mb-2 flex flex-wrap gap-1.5">
                    {selected.map((patient) => (
                        <li
                            key={patient.id}
                            className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-gray-50 py-1 pl-2.5 pr-1.5 text-xs text-gray-800"
                        >
                            <span className="max-w-[16rem] truncate">{patientName(patient)}</span>
                            <button
                                type="button"
                                onClick={() => removePatient(patient.id)}
                                disabled={disabled}
                                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-gray-500 hover:bg-gray-200 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                                aria-label={`Unlink ${patientName(patient)}`}
                            >
                                <X className="h-3 w-3" aria-hidden="true" />
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
                <input
                    type="text"
                    role="combobox"
                    aria-expanded={open}
                    aria-controls={listboxId}
                    aria-autocomplete="list"
                    autoComplete="off"
                    value={query}
                    disabled={disabled}
                    onChange={(event) => setQuery(event.target.value)}
                    onFocus={() => { if (hasEnoughText) setOpen(true) }}
                    onKeyDown={handleKeyDown}
                    placeholder={`Type ${PATIENT_SEARCH_MIN_CHARS}+ letters of a patient name`}
                    className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-9 text-sm disabled:cursor-not-allowed disabled:bg-gray-50"
                />
                {searching && (
                    <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-400" aria-hidden="true" />
                )}
            </div>

            {open && (
                <ul
                    id={listboxId}
                    role="listbox"
                    className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg"
                >
                    {suggestions.map((patient, index) => (
                        <li key={patient.id}>
                            <button
                                type="button"
                                role="option"
                                aria-selected={index === highlight}
                                onMouseEnter={() => setHighlight(index)}
                                onClick={() => addPatient(patient)}
                                className={`block w-full px-3 py-2 text-left text-sm ${index === highlight ? 'bg-gray-100 text-gray-900' : 'text-gray-700'}`}
                            >
                                {patientName(patient)}
                            </button>
                        </li>
                    ))}

                    {showEmptyState && (
                        <li className="px-3 py-2 text-sm text-gray-500">
                            {searchFailed ? 'Could not search patients.' : `No patients match “${trimmedQuery}”.`}
                        </li>
                    )}
                </ul>
            )}
        </div>
    )
}
