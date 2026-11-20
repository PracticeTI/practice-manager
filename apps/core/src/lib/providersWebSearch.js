import { requestOpenAiChatCompletion } from '@/lib/openaiClient'
import { resolveAiConfig } from '@/lib/ai/credentials'

const BRAVE_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search'
const MAX_RESULTS_CONSIDERED = 8
const MAX_PROVIDERS_ADDED_PER_SEARCH = 5

// Baseline guardrail: independent of AI availability, a result must match this
// vocabulary before it is even considered a candidate allied health provider.
const ALLOWED_KEYWORDS = [
    'ndis', 'allied health', 'occupational therap', 'physiotherap', 'speech patholog', 'podiatr',
    'psycholog', 'dietit', 'dietetic', 'exercise physiolog', 'social work', 'audiolog',
    'rehab', 'disability', 'therapy', 'clinic', 'telehealth', 'paediatric',
]
const BLOCKED_KEYWORDS = [
    'wikipedia', 'reddit.com', 'youtube.com', 'facebook.com', 'linkedin.com', 'instagram.com',
    'news article', 'job vacancy', 'careers at', 'recipe', 'real estate',
]

// Directory/aggregator sites that describe a provider but aren't the provider's own site.
// Small/local practices often only rank via these listings, so rather than reject them we
// try to recover the practice's own domain mentioned in the listing text (see extractEmbeddedDomain).
const AGGREGATOR_HOSTNAMES = new Set([
    'zoominfo.com', 'healthdirect.gov.au', 'whitepages.com.au', 'yellowpages.com.au',
    'truelocal.com.au', 'hotfrog.com.au', 'wordofmouth.com.au', 'oneflare.com.au',
    'ratemds.com', 'mapquest.com', 'crunchbase.com', 'similarweb.com', 'healthengine.com.au',
])

function normalizeText(value) {
    return String(value || '').toLowerCase()
}

function passesKeywordGuardrail(result, { requireAllowedKeywords = true } = {}) {
    const haystack = normalizeText(`${result.title} ${result.description} ${result.url}`)
    if (BLOCKED_KEYWORDS.some((blocked) => haystack.includes(blocked))) return false
    if (!requireAllowedKeywords) return true
    return ALLOWED_KEYWORDS.some((allowed) => haystack.includes(allowed))
}

export function isBraveSearchConfigured() {
    return Boolean(String(process.env.BRAVE_API_KEY || '').trim())
}

export async function searchBraveWeb(query) {
    const apiKey = String(process.env.BRAVE_API_KEY || '').trim()
    if (!apiKey) return []

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    try {
        const params = new URLSearchParams({ q: query, count: String(MAX_RESULTS_CONSIDERED) })
        const response = await fetch(`${BRAVE_SEARCH_URL}?${params}`, {
            headers: { 'X-Subscription-Token': apiKey, Accept: 'application/json' },
            signal: controller.signal,
        })
        if (!response.ok) return []

        const data = await response.json().catch(() => ({}))
        const results = Array.isArray(data?.web?.results) ? data.web.results : []
        return results.map((result) => ({
            title: String(result?.title || '').trim(),
            url: String(result?.url || '').trim(),
            description: String(result?.description || '').replace(/<\/?[^>]+>/g, '').trim(),
        })).filter((result) => result.title && result.url)
    } catch {
        return []
    } finally {
        clearTimeout(timeout)
    }
}

function safeHostname(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
    } catch {
        return ''
    }
}

function normalizeForNameMatch(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

// True when the search query is essentially the business's own name (e.g. the user
// searched "acme therapy" and the recovered domain is acme.com.au). In that
// case we trust the match directly rather than requiring the AI/keyword guardrails to
// re-confirm it, since thin aggregator blurbs often lack enough detail for either check.
function queryMatchesHostname(query, hostname) {
    const normalizedQuery = normalizeForNameMatch(query)
    return normalizedQuery.length >= 4 && normalizeForNameMatch(hostname).includes(normalizedQuery)
}

// Aggregator titles often look like "Acme Therapy - Overview, News ... | ZoomInfo.com";
// take the leading segment before such separators, falling back to the query itself.
function cleanFallbackProviderName(title, query) {
    const firstSegment = String(title || '').split(/\s[-|—]\s/)[0].trim()
    if (firstSegment) return firstSegment
    return String(query || '').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

// Finds a bare domain (e.g. "www.acme.com.au") mentioned in an aggregator
// listing's title/description so the practice's own site can still be used.
function extractEmbeddedDomain(text, excludeHostname) {
    const matches = String(text || '').matchAll(/\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com\.au|org\.au|net\.au|com|org|net))\b/gi)
    for (const match of matches) {
        const candidate = String(match[1] || '').toLowerCase()
        if (candidate && candidate !== excludeHostname && !AGGREGATOR_HOSTNAMES.has(candidate)) return candidate
    }
    return ''
}

// Search snippets are usually too short to mention funding pathways or NDIS registration,
// so fetch a short excerpt of the provider's own homepage to give the classifier a chance
// to find that detail directly (best-effort; failures just fall back to snippet-only).
const MAX_PAGE_EXCERPT_LENGTH = 4000

async function fetchPageExcerpt(hostname) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 6000)
    try {
        const response = await fetch(`https://${hostname}`, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AlliedHealthDirectoryBot/1.0)' },
        })
        if (!response.ok) return ''
        const html = await response.text()
        const text = html
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<\/?[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        return text.slice(0, MAX_PAGE_EXCERPT_LENGTH)
    } catch {
        return ''
    } finally {
        clearTimeout(timeout)
    }
}

async function classifyWithAi(result, pageExcerpt, aiConfig) {
    if (!aiConfig?.hasApiKey) return null

    const prompt = [
        'You verify whether a web search result is a genuine Australian Allied Health provider',
        '(a practice or clinician delivering services such as occupational therapy, physiotherapy,',
        'speech pathology, podiatry, psychology, dietetics, exercise physiology, social work, or audiology).',
        'Reject news articles, directories, forums, job listings, government pages, equipment suppliers, and unrelated businesses.',
        'If the provided page content mentions NDIS registration or funding/payment pathways',
        '(e.g. NDIS, Medicare, DVA, private health insurance, aged care HCP/CHSP, self-funded, workers compensation),',
        'extract them; otherwise leave those fields empty rather than guessing.',
        '',
        `Title: ${result.title}`,
        `URL: ${result.url}`,
        `Search snippet: ${result.description || 'none'}`,
        `Homepage excerpt: ${pageExcerpt || 'none'}`,
        '',
        'Respond with ONLY compact JSON, no markdown: ',
        '{"isProvider": boolean, "providerName": string, "professions": string[], "serviceTypes": string[],',
        ' "ndisStatus": string, "funding": string[]}',
    ].join('\n')

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
        const completion = await requestOpenAiChatCompletion({
            ...aiConfig,
            messages: [
                { role: 'system', content: 'You strictly classify businesses and respond with JSON only.' },
                { role: 'user', content: prompt },
            ],
            maxOutputTokens: 600,
            signal: controller.signal,
        })
        if (!completion.ok) return null

        const text = String(completion?.text || '')
            .replace(/^```[a-zA-Z]*\s*/g, '').replace(/\s*```$/g, '').trim()
        if (!text) return null
        const parsed = JSON.parse(text)
        if (parsed?.isProvider !== true) return null

        return {
            provider: String(parsed.providerName || '').trim(),
            professions: Array.isArray(parsed.professions) ? parsed.professions.map(String).filter(Boolean) : [],
            service_types: Array.isArray(parsed.serviceTypes) ? parsed.serviceTypes.map(String).filter(Boolean) : [],
            ndis_status: String(parsed.ndisStatus || '').trim(),
            funding: Array.isArray(parsed.funding) ? parsed.funding.map(String).filter(Boolean) : [],
        }
    } catch {
        return null
    } finally {
        clearTimeout(timeout)
    }
}

/**
 * Search-term variants to try, in priority order. A quoted exact-phrase search
 * ranks a specific business name (e.g. "acme therapy") above generic NDIS
 * boilerplate pages, which otherwise dominate once broad keywords are appended.
 * The broader, keyword-suffixed query then fills in when the exact phrase is
 * too narrow to return enough results on its own.
 */
function buildSearchQueries(query) {
    return [
        `"${query}" Australia`,
        `${query} allied health provider Australia NDIS`,
    ]
}

/**
 * Search the web for allied health providers matching `query`, applying
 * keyword + AI guardrails, and returning only accepted candidates whose
 * domain isn't already present in `existingHostnames`.
 */
export async function findNewProviderCandidates(query, existingHostnames = new Set()) {
    const accepted = []
    const seenHostnames = new Set()
    const aiConfig = resolveAiConfig()

    for (const searchQuery of buildSearchQueries(query)) {
        if (accepted.length >= MAX_PROVIDERS_ADDED_PER_SEARCH) break
        const results = await searchBraveWeb(searchQuery)

        for (const result of results) {
            if (accepted.length >= MAX_PROVIDERS_ADDED_PER_SEARCH) break

            const resultHostname = safeHostname(result.url)
            const isAggregatorListing = AGGREGATOR_HOSTNAMES.has(resultHostname)
            const hostname = isAggregatorListing
                ? extractEmbeddedDomain(`${result.title} ${result.description}`, resultHostname)
                : resultHostname
            if (!hostname || existingHostnames.has(hostname) || seenHostnames.has(hostname)) continue

            const isNameMatch = queryMatchesHostname(query, hostname)
            if (!isNameMatch) {
                // Aggregator blurbs rarely mention allied-health keywords even for genuine
                // providers, so only relax that check when AI classification can still verify them.
                const requireAllowedKeywords = !(isAggregatorListing && aiConfig.hasApiKey)
                if (!passesKeywordGuardrail(result, { requireAllowedKeywords })) continue
            }
            seenHostnames.add(hostname)

            const pageExcerpt = await fetchPageExcerpt(hostname)
            const aiClassification = await classifyWithAi(result, pageExcerpt, aiConfig)
            if (!isNameMatch && aiConfig.hasApiKey && !aiClassification) continue

            // An aggregator's own blurb describes the directory listing, not the practice,
            // so drop it unless AI classification produced something more meaningful.
            const description = isAggregatorListing && !aiClassification ? '' : result.description

            accepted.push({
                provider: aiClassification?.provider || cleanFallbackProviderName(result.title, query),
                description,
                website_url: `https://${hostname}`,
                professions: aiClassification?.professions || [],
                service_types: aiClassification?.service_types || [],
                ndis_status: aiClassification?.ndis_status || '',
                funding: aiClassification?.funding || [],
            })
            existingHostnames.add(hostname)
        }
    }

    return accepted
}
