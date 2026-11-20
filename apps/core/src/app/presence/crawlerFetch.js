// Shared helpers for the /presence crawler panels.
//
// Both panels verify what a crawler receives by fetching this app's own URLs back over HTTP
// rather than re-deriving the output from code, so they need the same base-URL and timeout
// handling.

const FETCH_TIMEOUT_MS = 8000

export function isLocalHostname(hostname) {
    const value = String(hostname || '').trim().toLowerCase()
    return value.startsWith('localhost') || value.startsWith('127.0.0.1') || value.includes('.localhost') || value.includes('.local')
}

/** Base URL for fetching this app back through the host the request arrived on. */
export function resolveSelfBaseUrl(hostHeader) {
    return `${isLocalHostname(hostHeader) ? 'http' : 'https'}://${hostHeader}`
}

/**
 * GET a path from this app. `x-forwarded-host` is set explicitly so the request resolves the
 * same brand as the page being viewed.
 *
 * The failure detail includes the attempted URL: a Host header without a port (common when
 * testing with `curl -H 'Host: mybrand.localhost'`) fails here for non-obvious reasons.
 */
export async function fetchFromSelf(path, hostHeader) {
    const url = `${resolveSelfBaseUrl(hostHeader)}${path}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
        const response = await fetch(url, {
            cache: 'no-store',
            signal: controller.signal,
            headers: { 'x-forwarded-host': hostHeader },
        })
        return {
            ok: response.ok,
            status: response.status,
            redirectUrl: response.redirected ? response.url : '',
            contentType: String(response.headers.get('content-type') || ''),
            body: await response.text(),
        }
    } catch (error) {
        const reason = error?.name === 'AbortError' ? `timed out after ${FETCH_TIMEOUT_MS}ms` : (error?.message || 'fetch failed')
        return { ok: false, status: 0, redirectUrl: '', contentType: '', body: '', error: `${reason} — ${url}` }
    } finally {
        clearTimeout(timer)
    }
}

/** Pull the <loc> values out of a sitemap without pulling in an XML parser. */
export function extractLocs(xml) {
    return Array.from(String(xml || '').matchAll(/<loc>([^<]+)<\/loc>/g)).map((match) => match[1].trim())
}
