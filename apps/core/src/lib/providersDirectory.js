export const PROVIDER_LIST_FIELDS = [
    'professions',
    'service_types',
    'age_groups',
    'funding',
    'geography',
    'languages_spoken',
]

export const PROVIDER_BOOLEAN_FIELDS = [
    'telehealth',
    'home_visits',
    'bulk_billing',
    'accepting_new_clients',
    'referral_required',
]

export const PROVIDER_FILTER_FIELDS = [
    ...PROVIDER_LIST_FIELDS,
    'ndis_status',
    ...PROVIDER_BOOLEAN_FIELDS,
]

export const PROFESSION_ALIASES = {
    ot: 'Occupational Therapy',
    physio: 'Physiotherapy',
    speech: 'Speech Pathology',
    podiatry: 'Podiatry',
    psychology: 'Psychology',
    dietetics: 'Dietetics',
    exercise: 'Exercise Physiology',
    social_work: 'Social Work',
    audiology: 'Audiology',
}

export const EMPTY_PROVIDER = {
    provider: '',
    description: '',
    professions: [],
    service_types: [],
    age_groups: [],
    ndis_status: '',
    funding: [],
    geography: [],
    languages_spoken: [],
    telehealth: false,
    home_visits: false,
    bulk_billing: false,
    accepting_new_clients: false,
    referral_required: false,
    registration_body: '',
    typical_wait_time: '',
    website_url: '',
    email: '',
    phone: '',
    last_verified_at: '',
    status: 'published',
    domain: '',
}

export function normalizeList(value) {
    const source = Array.isArray(value) ? value : String(value || '').split(',')
    return Array.from(new Set(source.map((item) => String(item || '').trim()).filter(Boolean)))
}

// Derives a small brand icon from a provider's own domain via Google's public
// favicon service (no API key required). Returns '' when there's no website.
export function getProviderLogoUrl(websiteUrl) {
    const value = String(websiteUrl || '').trim()
    if (!value) return ''
    try {
        const hostname = new URL(value.includes('://') ? value : `https://${value}`).hostname
        if (!hostname) return ''
        return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=128`
    } catch {
        return ''
    }
}

export function normalizeProfession(value) {
    const normalized = String(value || '').trim().toLowerCase()
    if (!normalized) return ''
    return PROFESSION_ALIASES[normalized] || String(value).trim()
}

export function normalizeProvider(value = {}) {
    const provider = { ...EMPTY_PROVIDER, ...value }

    for (const field of PROVIDER_LIST_FIELDS) {
        provider[field] = normalizeList(provider[field])
    }
    provider.professions = provider.professions.map(normalizeProfession)

    for (const field of PROVIDER_BOOLEAN_FIELDS) {
        provider[field] = provider[field] === true || provider[field] === 1 || provider[field] === '1'
    }

    provider.favorite_count = Number(provider.favorite_count || 0)
    provider.is_favorite = provider.is_favorite === true || provider.is_favorite === 1 || provider.is_favorite === '1'
    provider.logo_url = getProviderLogoUrl(provider.website_url)
    return provider
}

export function providerSearchScore(provider, query) {
    const terms = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (terms.length === 0) return 1

    const weightedValues = [
        [provider.provider, 8],
        [provider.professions, 5],
        [provider.service_types, 4],
        [provider.age_groups, 3],
        [provider.funding, 3],
        [provider.geography, 3],
        [provider.languages_spoken, 2],
        [provider.description, 1],
        [provider.ndis_status, 1],
        [provider.registration_body, 1],
        [provider.typical_wait_time, 1],
        [provider.website_url, 1],
        [provider.email, 1],
        [provider.phone, 1],
        [provider.last_verified_at, 1],
        [provider.status, 1],
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

export function matchesProviderField(provider, field, query) {
    const term = String(query || '').trim().toLowerCase()
    if (!field || !term) return true
    const value = provider?.[field]
    const text = Array.isArray(value) ? value.join(' ') : String(value ?? '')
    return text.toLowerCase().includes(term)
}

export function matchesProviderFilters(provider, filters = {}) {
    return PROVIDER_FILTER_FIELDS.every((field) => {
        const selected = filters[field]
        if (selected === '' || selected === undefined || selected === null) return true
        if (typeof provider[field] === 'boolean') return provider[field] === selected
        const values = Array.isArray(provider[field]) ? provider[field] : [provider[field]]
        return values.some((value) => String(value).toLowerCase() === String(selected).toLowerCase())
    })
}
