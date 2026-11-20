// Suggestion helpers for a contact's `association` field.
//
// The field stays free text — a contact can belong to anything — but the admin
// editor also offers the organisations already tracked elsewhere on the platform
// (allied health providers, equipment suppliers and funding bodies) so common
// entries are spelled consistently instead of drifting into near-duplicates.
//
// Kept client-safe: the admin Contacts page builds its suggestion list from
// these helpers, and the lookup route reuses them server-side.

import { cleanString } from './contacts.js'

export const ASSOCIATION_SOURCE_LABELS = {
    provider: 'Provider',
    supplier: 'Supplier',
    funder: 'Funder',
}

// Presentation order, so an entry found in several directories always reads the
// same way (e.g. "Provider · Funder").
const SOURCE_ORDER = ['provider', 'supplier', 'funder']

function addCandidate(map, value, source) {
    const label = cleanString(value)
    if (!label) return

    const key = label.toLowerCase()
    const existing = map.get(key)
    if (existing) {
        if (!existing.sources.includes(source)) existing.sources.push(source)
        return
    }

    map.set(key, { value: label, sources: [source] })
}

/**
 * Merge provider / supplier / funder records into one alphabetised suggestion
 * list. Names are compared case-insensitively, so a name shared by more than one
 * directory keeps a single entry whose `sources` records every place it matched.
 */
export function buildAssociationOptions({ providers = [], suppliers = [], funders = [] } = {}) {
    const map = new Map()

    for (const provider of providers) addCandidate(map, provider?.provider, 'provider')
    for (const supplier of suppliers) addCandidate(map, supplier?.supplier, 'supplier')
    for (const funder of funders) {
        const name = cleanString(funder?.name)
        addCandidate(map, name, 'funder')

        // A funder often carries both a short name and its full legal title; both
        // are useful associations, so offer the full name when it says more.
        const fullName = cleanString(funder?.full_name)
        if (fullName && fullName.toLowerCase() !== name.toLowerCase()) addCandidate(map, fullName, 'funder')
    }

    return Array.from(map.values())
        .map((option) => ({
            value: option.value,
            sources: SOURCE_ORDER.filter((source) => option.sources.includes(source)),
        }))
        .sort((a, b) => a.value.localeCompare(b.value, 'en-AU', { sensitivity: 'base' }))
}

/** Secondary text shown beside a suggestion, e.g. "Provider · Funder". */
export function describeAssociationSources(sources) {
    return (Array.isArray(sources) ? sources : [])
        .map((source) => ASSOCIATION_SOURCE_LABELS[source] || cleanString(source))
        .filter(Boolean)
        .join(' · ')
}
