// Client-side access to the per-domain AI Assistant.
//
// Four concerns live here so any admin surface (the header search box, the
// floating launcher, future triggers) shares one implementation:
//   1. looking up whether the assistant is available for the active domain
//      (memoised per admin token, so N components = 1 request),
//   2. a window-event channel that opens the assistant and sends a prompt,
//   3. deciding whether a typed query is better handed to the assistant than
//      searched, and
//   4. resolving the domain's optional assistant artwork.
//
// Browser-only: assistantConfig.js holds the rules that server routes share.

import { resolveAdminAuthToken } from '@/lib/clientAdminAuth'
import { getDomainAssistantIconUrl, getDomainWorkerIconUrl } from '@/lib/assistantConfig'

/** Dedicated full-screen assistant app; the floating launcher hides there. */
export const ASSISTANT_FULL_APP_PATH = '/admin/assistant'

/** Fired with `{ prompt }` to open the assistant and send that prompt. */
export const ASSISTANT_PROMPT_EVENT = 'practice:assistant-prompt'

const UNAVAILABLE = { available: false, token: '', config: null }

let statusCache = null

export function isAssistantFullAppPath() {
    if (typeof window === 'undefined') return false
    return window.location.pathname.startsWith(ASSISTANT_FULL_APP_PATH)
}

/**
 * Ask the mounted assistant launcher to open and send `prompt`.
 * A no-op when no launcher is listening (assistant unavailable for the domain,
 * or the full-screen assistant app is already open).
 */
export function requestAssistantPrompt(prompt) {
    const value = String(prompt || '').trim()
    if (typeof window === 'undefined' || !value) return

    window.dispatchEvent(new CustomEvent(ASSISTANT_PROMPT_EVENT, { detail: { prompt: value } }))
}

/**
 * Verbs/questions that open a query meant for the assistant rather than a
 * lookup: "list this week's appointments", "how many visits in August".
 */
const ASSISTANT_QUERY_OPENERS = new Set([
    'can', 'compare', 'could', 'draft', 'explain', 'find', 'give', 'how',
    'list', 'show', 'summarise', 'summarize', 'tell', 'what', 'when',
    'where', 'which', 'who', 'why', 'write',
])

/**
 * Whether a typed query reads like something to *ask* the assistant rather than
 * a name to look up.
 *
 * Two signals, both deliberately conservative so ordinary name searches never
 * trip them:
 *   1. the query ends with a question mark, or
 *   2. it opens with an interrogative/instruction word *and* runs to more than
 *      one word — bare single words ("list", "who") are ignored because they are
 *      just as likely to be a name fragment.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function looksLikeAssistantQuestion(value) {
    const query = String(value || '').trim()
    if (!query) return false
    if (query.endsWith('?')) return true

    const words = query.toLowerCase().split(/\s+/)
    if (words.length < 2) return false

    return ASSISTANT_QUERY_OPENERS.has(words[0].replace(/[^a-z]/g, ''))
}

// Per-URL probe state, keyed by the artwork URL — both assistant.png and worker.png land
// here. `promise` memoises the in-flight probe so every surface asking for the same file
// (the launcher, the modal, the search box, the tab-strip group mark) shares one request,
// and `resolvedUrl` lets a later mount render the artwork without waiting for (or
// repeating) that probe.
const domainArtworkCache = new Map()

function probeDomainArtwork(url) {
    let entry = domainArtworkCache.get(url)
    if (entry) return entry

    entry = { resolvedUrl: '', promise: null }
    entry.promise = fetch(url, { method: 'HEAD', cache: 'no-store' })
        .then((response) => (response.ok ? url : ''))
        .catch(() => '')
        .then((resolvedUrl) => {
            entry.resolvedUrl = resolvedUrl
            return resolvedUrl
        })

    domainArtworkCache.set(url, entry)
    return entry
}

async function resolveDomainArtwork(url) {
    if (typeof window === 'undefined' || !url) return ''
    return probeDomainArtwork(url).promise
}

/** Synchronous read of an already-probed artwork; '' while unknown or missing. */
function getCachedDomainArtwork(url) {
    if (!url) return ''
    return domainArtworkCache.get(url)?.resolvedUrl || ''
}

/**
 * The domain's own assistant artwork (`assistant.png`) when the file exists, otherwise ''.
 * Resolved through `/api/settings/domain-artwork` (domain override, then practice-type
 * folder), memoised for the session.
 */
export async function resolveAssistantIconUrl(domainKey) {
    return resolveDomainArtwork(getDomainAssistantIconUrl(domainKey))
}

/** Synchronous read of an already-probed assistant icon; '' while unknown or missing. */
export function getCachedAssistantIconUrl(domainKey) {
    return getCachedDomainArtwork(getDomainAssistantIconUrl(domainKey))
}

/**
 * The domain's own worker artwork (`worker.png`) when the file exists, otherwise ''.
 * Shares the probe cache with the assistant icon, so a domain that ships both costs
 * at most two requests for the session.
 */
export async function resolveWorkerIconUrl(domainKey) {
    return resolveDomainArtwork(getDomainWorkerIconUrl(domainKey))
}

/** Synchronous read of an already-probed worker icon; '' while unknown or missing. */
export function getCachedWorkerIconUrl(domainKey) {
    return getCachedDomainArtwork(getDomainWorkerIconUrl(domainKey))
}

/**
 * Whether the active domain can actually run the assistant (enabled *and*
 * provider credentials configured), plus the config used to render the chat.
 *
 * Memoised per admin token so the launcher and the search box issue a single
 * request; failures are not cached so a retry can succeed.
 */
export async function loadAssistantStatus() {
    if (typeof window === 'undefined') return UNAVAILABLE
    if (isAssistantFullAppPath()) return UNAVAILABLE

    const token = await resolveAdminAuthToken()
    if (!token) return UNAVAILABLE
    if (statusCache?.token === token) return statusCache.value

    try {
        const response = await fetch('/api/admin/assistant', {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
        })
        const data = await response.json().catch(() => ({}))

        const value = {
            available: response.ok && data.enabled === true && data.configured === true,
            token,
            config: data,
        }
        statusCache = { token, value }
        return value
    } catch {
        return { available: false, token, config: null }
    }
}
