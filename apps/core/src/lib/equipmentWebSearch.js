import { requestOpenAiChatCompletion } from '@/lib/openaiClient'
import { resolveAiConfig } from '@/lib/ai/credentials'

const BRAVE_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search'
const MAX_RESULTS_CONSIDERED = 8
const MAX_SUPPLIERS_ADDED_PER_SEARCH = 5

// Baseline guardrail: independent of AI availability, a result must match this
// vocabulary before it is even considered a candidate allied health supplier.
const ALLOWED_KEYWORDS = [
    'ndis', 'allied health', 'occupational therap', 'physiotherap', 'mobility', 'wheelchair',
    'disability', 'equipment', 'aids', 'assistive technology', 'rehab', 'orthotic', 'prosthetic',
    'hoist', 'pressure care', 'continence', 'paediatric', 'home modification', 'walking frame',
    'shower commode', 'bathroom aid', 'seating', 'sensory', 'medical supplies', 'daily living',
]
const BLOCKED_KEYWORDS = [
    'wikipedia', 'reddit.com', 'youtube.com', 'facebook.com', 'linkedin.com', 'instagram.com',
    'news article', 'job vacancy', 'careers at', 'recipe', 'real estate',
]

function normalizeText(value) {
    return String(value || '').toLowerCase()
}

function passesKeywordGuardrail(result) {
    const haystack = normalizeText(`${result.title} ${result.description} ${result.url}`)
    if (BLOCKED_KEYWORDS.some((blocked) => haystack.includes(blocked))) return false
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

async function classifyWithAi(result, aiConfig) {
    if (!aiConfig?.hasApiKey) return null

    const prompt = [
        'You verify whether a web search result is a genuine Australian Allied Health equipment supplier',
        '(a business selling/hiring physical equipment such as mobility aids, wheelchairs, bathroom aids,',
        'seating, hoists, orthotics, continence aids, paediatric therapy equipment, or similar).',
        'Reject news articles, directories, forums, job listings, government pages, and unrelated businesses.',
        '',
        `Title: ${result.title}`,
        `URL: ${result.url}`,
        `Description: ${result.description || 'none'}`,
        '',
        'Respond with ONLY compact JSON, no markdown: ',
        '{"isSupplier": boolean, "supplierName": string, "equipmentCategories": string[], "productTypes": string[]}',
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
        if (parsed?.isSupplier !== true) return null

        return {
            supplier: String(parsed.supplierName || '').trim(),
            equipment_categories: Array.isArray(parsed.equipmentCategories) ? parsed.equipmentCategories.map(String).filter(Boolean) : [],
            product_types: Array.isArray(parsed.productTypes) ? parsed.productTypes.map(String).filter(Boolean) : [],
        }
    } catch {
        return null
    } finally {
        clearTimeout(timeout)
    }
}

/**
 * Search the web for allied health equipment suppliers matching `query`,
 * applying keyword + AI guardrails, and returning only accepted candidates
 * whose domain isn't already present in `existingHostnames`.
 */
export async function findNewSupplierCandidates(query, existingHostnames = new Set()) {
    const results = await searchBraveWeb(`${query} allied health equipment supplier Australia NDIS`)
    const accepted = []
    const aiConfig = resolveAiConfig()

    for (const result of results) {
        if (accepted.length >= MAX_SUPPLIERS_ADDED_PER_SEARCH) break
        if (!passesKeywordGuardrail(result)) continue

        const hostname = safeHostname(result.url)
        if (!hostname || existingHostnames.has(hostname)) continue

        const aiClassification = await classifyWithAi(result, aiConfig)
        if (aiConfig.hasApiKey && !aiClassification) continue

        accepted.push({
            supplier: aiClassification?.supplier || result.title,
            description: result.description,
            website_url: `https://${hostname}`,
            equipment_categories: aiClassification?.equipment_categories || [],
            product_types: aiClassification?.product_types || [],
        })
        existingHostnames.add(hostname)
    }

    return accepted
}
