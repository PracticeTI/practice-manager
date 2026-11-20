export const EQUIPMENT_LIST_FIELDS = [
    'equipment_categories',
    'product_types',
    'professions',
    'geography',
    'funding',
    'specialist_equipment',
    'brands',
]

export const EQUIPMENT_BOOLEAN_FIELDS = [
    'home_trials',
    'hire_rental',
    'quotes',
    'repairs',
    'delivery',
]

export const EQUIPMENT_FILTER_FIELDS = [
    ...EQUIPMENT_LIST_FIELDS,
    'ndis_status',
    ...EQUIPMENT_BOOLEAN_FIELDS,
]

export const PROFESSION_ALIASES = {
    ot: 'Occupational Therapy',
    physio: 'Physiotherapy',
    speech: 'Speech Pathology',
    podiatry: 'Podiatry',
    psychology: 'Psychology',
    dietetics: 'Dietetics',
    exercise: 'Exercise Physiology',
}

export const EMPTY_EQUIPMENT_SUPPLIER = {
    supplier: '',
    description: '',
    equipment_categories: [],
    product_types: [],
    professions: [],
    ndis_status: '',
    geography: [],
    home_trials: false,
    hire_rental: false,
    quotes: false,
    product_catalogue_url: '',
    referral_contact: '',
    typical_response_time: '',
    funding: [],
    specialist_equipment: [],
    repairs: false,
    website_url: '',
    email: '',
    phone: '',
    brands: [],
    delivery: false,
    trial_area: '',
    last_verified_at: '',
    status: 'published',
    domain: '',
}

export function normalizeList(value) {
    const source = Array.isArray(value) ? value : String(value || '').split(',')
    return Array.from(new Set(source.map((item) => String(item || '').trim()).filter(Boolean)))
}

// Derives a small brand icon from a supplier's own domain via Google's public
// favicon service (no API key required). Returns '' when there's no website.
// `size` lets callers request a larger tile (e.g. for decorative card backdrops).
export function getSupplierLogoUrl(websiteUrl, size = 128) {
    const value = String(websiteUrl || '').trim()
    if (!value) return ''
    try {
        const hostname = new URL(value.includes('://') ? value : `https://${value}`).hostname
        if (!hostname) return ''
        return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=${size}`
    } catch {
        return ''
    }
}

// Bare hostname for a supplier's website, e.g.
// "https://www.gmsrehab.com.au/shop" -> "gmsrehab.com.au". The sourcing wizard
// records this when a quote request is sent so the supplier's favicon can be
// resolved from it later (see `getSupplierLogoUrl`).
export function getSupplierDomain(websiteUrl) {
    const value = String(websiteUrl || '').trim()
    if (!value) return ''
    try {
        const hostname = new URL(value.includes('://') ? value : `https://${value}`).hostname
        return hostname.toLowerCase().replace(/^www\./, '')
    } catch {
        return ''
    }
}

export function normalizeProfession(value) {
    const normalized = String(value || '').trim().toLowerCase()
    if (!normalized) return ''
    return PROFESSION_ALIASES[normalized] || String(value).trim()
}

export function normalizeEquipmentSupplier(value = {}) {
    const supplier = { ...EMPTY_EQUIPMENT_SUPPLIER, ...value }

    for (const field of EQUIPMENT_LIST_FIELDS) {
        supplier[field] = normalizeList(supplier[field])
    }
    supplier.professions = supplier.professions.map(normalizeProfession)

    for (const field of EQUIPMENT_BOOLEAN_FIELDS) {
        supplier[field] = supplier[field] === true || supplier[field] === 1 || supplier[field] === '1'
    }

    supplier.favorite_count = Number(supplier.favorite_count || 0)
    supplier.is_favorite = supplier.is_favorite === true || supplier.is_favorite === 1 || supplier.is_favorite === '1'
    supplier.logo_url = getSupplierLogoUrl(supplier.website_url)
    return supplier
}

export function equipmentSearchScore(supplier, query) {
    const terms = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (terms.length === 0) return 1

    const weightedValues = [
        [supplier.supplier, 8],
        [supplier.product_types, 5],
        [supplier.equipment_categories, 4],
        [supplier.specialist_equipment, 4],
        [supplier.brands, 3],
        [supplier.professions, 3],
        [supplier.geography, 2],
        [supplier.funding, 2],
        [supplier.description, 1],
        [supplier.referral_contact, 1],
        [supplier.ndis_status, 1],
        [supplier.typical_response_time, 1],
        [supplier.product_catalogue_url, 1],
        [supplier.website_url, 1],
        [supplier.email, 1],
        [supplier.phone, 1],
        [supplier.trial_area, 1],
        [supplier.last_verified_at, 1],
        [supplier.status, 1],
    ]

    let score = 0
    for (const term of terms) {
        let termScore = 0
        for (const [value, weight] of weightedValues) {
            const text = (Array.isArray(value) ? value.join(' ') : String(value || '')).toLowerCase()
            if (text.includes(term)) termScore += weight
        }
        if (termScore === 0) return 0
        score += termScore
    }
    return score
}

// ---- Sourcing-wizard matcher ("Top catalog matches" in the equipment sourcing wizard) ----
//
// Unlike equipmentSearchScore (substring, directory search), this matcher is tuned for
// short product requests: it matches whole catalogue terms (with simple plural tolerance)
// and only counts terms that hit a specific "what they stock" field, so a supplier can't be
// surfaced on prose alone. Whole-term matching stops substring noise ("chair" vs
// "wheelchairs", "Aidacare" vs "aids"). Catalogue term-frequency (idf) is used purely for
// ranking: rare terms rank higher, while a genuinely common item still matches its (many)
// real suppliers.

const EQUIPMENT_QUERY_STOPWORDS = new Set([
    // Grammatical/generic words that add noise when the wizard sends a free-text
    // description alongside the item name.
    'and', 'for', 'the', 'with', 'you', 'your', 'are', 'was', 'can', 'has', 'had', 'not',
    'but', 'its', 'all', 'any', 'use', 'used', 'using', 'also', 'via', 'who', 'whom',
    'patient', 'client', 'people', 'person', 'needs', 'need', 'support', 'supports',
    'provide', 'provides', 'ensure', 'designed', 'allows', 'enabling', 'suitable',
    'during', 'after', 'before', 'between',
])

// Field -> weight. Specific fields describing what a supplier actually stocks dominate;
// prose fields (description/professions) only nudge.
export const EQUIPMENT_MATCH_FIELDS = [
    ['product_types', 8],
    ['specialist_equipment', 7],
    ['equipment_categories', 6],
    ['supplier', 5],
    ['brands', 4],
    ['description', 2],
    ['professions', 1],
]

// Fields that say what a supplier actually stocks. Term-frequency (idf) is computed over
// these only, so prose fields (description/professions) can't make a genuinely specific
// product term look common or surface a supplier on their own.
const EQUIPMENT_MATCH_SPECIFIC_FIELDS = EQUIPMENT_MATCH_FIELDS
    .filter(([, weight]) => weight >= 4)
    .map(([field]) => field)

function equipmentQueryTerms(query) {
    const terms = new Set()
    for (const match of String(query || '').toLowerCase().matchAll(/[a-z0-9]+/g)) {
        const term = match[0]
        if (term.length > 2 && !EQUIPMENT_QUERY_STOPWORDS.has(term)) terms.add(term)
    }
    return Array.from(terms)
}

function tokenizeField(value) {
    const text = Array.isArray(value) ? value.join(' ') : String(value || '')
    return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

// Whole-term match with simple plural/derivation tolerance ("commode" ~ "commodes",
// "walkers" ~ "walker") but no mid-word substring hits ("chair" does NOT match
// "wheelchair", "aidacare" does NOT match "aids"). Prefix tolerance only applies to
// short suffixes (+/- a couple of letters), so proper nouns or unrelated words with a
// shared stem don't match everything.
function hasWordMatch(tokens, term) {
    return tokens.some((token) => {
        if (token === term) return true
        if (token.length < 3 || term.length < 3) return false
        const longer = token.length > term.length ? token : term
        const shorter = token.length > term.length ? term : token
        if (longer.length - shorter.length > 2) return false
        return longer.startsWith(shorter)
    })
}

function supplierFieldTokens(supplier, fields) {
    const tokens = []
    for (const field of fields) tokens.push(...tokenizeField(supplier?.[field]))
    return tokens
}

function supplierSpecificTokens(supplier) {
    return supplierFieldTokens(supplier, EQUIPMENT_MATCH_SPECIFIC_FIELDS)
}

// How many suppliers in `suppliers` carry each query term in a specific field. Used to
// discount generic terms shared by whole seed groups.
export function equipmentTermFrequency(suppliers, query) {
    const terms = equipmentQueryTerms(query)
    const frequency = Object.fromEntries(terms.map((term) => [term, 0]))
    if (terms.length === 0) return frequency
    for (const supplier of suppliers) {
        const tokens = supplierSpecificTokens(supplier)
        for (const term of terms) {
            if (hasWordMatch(tokens, term)) frequency[term] += 1
        }
    }
    return frequency
}

export function equipmentMatchScore(supplier, query, { termFrequency = null, total = 0 } = {}) {
    const terms = equipmentQueryTerms(query)
    if (terms.length === 0) return 0

    const specificTokens = supplierSpecificTokens(supplier)

    let score = 0
    for (const term of terms) {
        // Terms only count when they hit a specific "what they stock" field; a term that
        // only appears in prose (description/professions) is too weak to surface a supplier.
        if (!hasWordMatch(specificTokens, term)) continue

        let termWeight = 0
        for (const [field, weight] of EQUIPMENT_MATCH_FIELDS) {
            if (hasWordMatch(tokenizeField(supplier?.[field]), term)) termWeight += weight
        }

        if (termFrequency) {
            // Rare terms rank higher; terms shared by many suppliers rank lower but still
            // match (a common item such as "shower commode" legitimately has many suppliers).
            const df = Math.max(1, termFrequency[term] ?? 1)
            const rarity = Math.log((total + 1) / (df + 1)) + 1
            score += termWeight * rarity
        } else {
            score += termWeight
        }
    }

    if (score === 0) return 0
    return Math.round(score * 10) / 10
}

// Field -> label used when explaining why a supplier matched. Ordered so the most
// meaningful reason (what they actually stock) is shown first.
const EQUIPMENT_MATCH_REASON_FIELDS = [
    ['product_types', 'Stocks'],
    ['specialist_equipment', 'Specialist equipment'],
    ['equipment_categories', 'Category'],
    ['brands', 'Brand'],
    ['supplier', 'Name'],
]

// Compact "why this matched" explanation for the sourcing wizard. Uses the same
// whole-term + specific-field rules as equipmentMatchScore, but instead of a numeric
// score it surfaces the real catalogue values a query term hit (e.g. Stocks:
// "Shower Commodes"), so an admin can see at a glance why a supplier was surfaced
// without reading its full profile. Returns null when nothing specific matched
// (in which case equipmentMatchScore would also be 0).
export function equipmentMatchReason(supplier, query, { maxValues = 3 } = {}) {
    const terms = equipmentQueryTerms(query)
    if (terms.length === 0) return null
    const matchedTerms = terms.filter((term) => hasWordMatch(supplierSpecificTokens(supplier), term))
    if (matchedTerms.length === 0) return null

    const groups = []
    for (const [field, label] of EQUIPMENT_MATCH_REASON_FIELDS) {
        const raw = Array.isArray(supplier?.[field]) ? supplier[field] : (supplier?.[field] ? [supplier[field]] : [])
        const values = raw.filter((value) => {
            const tokens = tokenizeField(value)
            return matchedTerms.some((term) => hasWordMatch(tokens, term))
        })
        if (values.length === 0) continue
        groups.push({ label, values: values.slice(0, maxValues) })
    }
    return { terms: matchedTerms, groups }
}

export function matchesEquipmentField(supplier, field, query) {
    const term = String(query || '').trim().toLowerCase()
    if (!field || !term) return true
    const value = supplier?.[field]
    const text = Array.isArray(value) ? value.join(' ') : String(value ?? '')
    return text.toLowerCase().includes(term)
}

export function matchesEquipmentFilters(supplier, filters = {}) {
    return EQUIPMENT_FILTER_FIELDS.every((field) => {
        const selected = filters[field]
        if (selected === '' || selected === undefined || selected === null) return true
        if (typeof supplier[field] === 'boolean') return supplier[field] === selected
        const values = Array.isArray(supplier[field]) ? supplier[field] : [supplier[field]]
        return values.some((value) => String(value).toLowerCase() === String(selected).toLowerCase())
    })
}