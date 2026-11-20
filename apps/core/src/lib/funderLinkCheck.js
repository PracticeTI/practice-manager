/**
 * Funder link health — checks that the documentation URLs on a funder record are
 * still live.
 *
 * The NDIA republishes its pricing schedule and support catalogue each financial
 * year under NEW media URLs, so the links a funder record holds rot on a 1 July
 * cadence. This module is the shared check used by both the CLI
 * (`scripts/check-funder-links.mjs`) and the superadmin-only Dev Tools button.
 *
 * Runs **server-side only**: it relies on `redirect: 'manual'` returning the real
 * 3xx response (browsers hand back an opaque redirect instead).
 *
 * "Blocked" is deliberately distinct from "Broken": ndis.gov.au sits behind
 * Cloudflare and answers automated requests for `/media/*` downloads with 403, so
 * collapsing the two would report every pricing schedule as dead.
 *
 * Deliberately free of Node-only imports and of `@/` aliases (the CLI loads it
 * with plain `node`), so imports here use relative paths with explicit `.js`.
 */

import { isValidExternalUrl, normalizeFunderDocument } from './funders.js'

/** Link states a check can record. Persisted to `funder_documents.link_status`. */
export const FUNDER_LINK_STATUS_VALUES = ['ok', 'redirect', 'blocked', 'broken', 'error', 'skipped']

export const FUNDER_LINK_STATUS_LABELS = {
    ok: 'OK',
    redirect: 'Redirected',
    blocked: 'Blocked',
    broken: 'Broken',
    error: 'Error',
    skipped: 'Not checked',
}

export const DEFAULT_LINK_CHECK_TIMEOUT_MS = 12000
export const DEFAULT_LINK_CHECK_CONCURRENCY = 5

/** A descriptive UA: some government hosts reject requests without one. */
export const LINK_CHECK_USER_AGENT = `PracticeFunderLinkCheck/1.0 (+${String(process.env.NEXT_PUBLIC_SITE_URL || 'https://example.com').trim()})`

/** Human label for a recorded link status (falls back to "Not checked"). */
export function getFunderLinkStatusLabel(value) {
    const key = String(value || '').trim().toLowerCase()
    return FUNDER_LINK_STATUS_LABELS[key] || (key || FUNDER_LINK_STATUS_LABELS.skipped)
}

/** True when a recorded status is one an admin should look at. */
export function isProblemLinkStatus(value) {
    const key = String(value || '').trim().toLowerCase()
    return key === 'broken' || key === 'error' || key === 'blocked'
}

/**
 * Map an HTTP status to a link state.
 *
 * @param {number} status
 * @returns {'ok'|'redirect'|'blocked'|'broken'|'error'}
 */
export function classifyHttpStatus(status) {
    const code = Number(status) || 0
    if (code >= 200 && code < 300) return 'ok'
    if (code >= 300 && code < 400) return 'redirect'
    // 403/429 are "the server refused us", not "the page is gone".
    if (code === 403 || code === 429) return 'blocked'
    if (code >= 400 && code < 500) return 'broken'
    return 'error'
}

function resolveLocation(location, baseUrl) {
    if (!location) return ''
    try {
        return new URL(location, baseUrl).toString()
    } catch {
        return String(location)
    }
}

async function fetchOnce(url, { method, timeoutMs, fetchImpl }) {
    const response = await fetchImpl(url, {
        method,
        redirect: 'manual',
        headers: {
            'user-agent': LINK_CHECK_USER_AGENT,
            accept: '*/*',
            // Ask for one byte so a GET fallback against a large PDF cannot stream
            // the whole file; the body is cancelled immediately regardless.
            ...(method === 'GET' ? { range: 'bytes=0-0' } : {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
    })

    const result = {
        status: Number(response.status) || 0,
        finalUrl: resolveLocation(response.headers.get('location'), url),
    }

    // Discard the body: nothing here reads it, and this releases the socket.
    try {
        await response.body?.cancel()
    } catch {
        // Already closed/consumed — nothing to do.
    }

    return result
}

/**
 * Check one URL.
 *
 * @param {string} url
 * @param {{ timeoutMs?: number, fetchImpl?: Function }} [options]
 * @returns {Promise<{ url: string, status: string, httpStatus: number|null, finalUrl: string, error: string }>}
 */
export async function checkFunderLink(url, {
    timeoutMs = DEFAULT_LINK_CHECK_TIMEOUT_MS,
    fetchImpl = fetch,
} = {}) {
    const checkedAtUrl = String(url || '').trim()
    if (!isValidExternalUrl(checkedAtUrl)) {
        return {
            url: checkedAtUrl,
            status: 'skipped',
            httpStatus: null,
            finalUrl: '',
            error: 'Not an absolute http(s) URL',
        }
    }

    try {
        let response = await fetchOnce(checkedAtUrl, { method: 'HEAD', timeoutMs, fetchImpl })

        // A HEAD-specific refusal (or a CDN that only serves GET) is not a dead link,
        // so retry once with GET before believing the status code.
        if (response.status === 403 || response.status === 405 || response.status === 501) {
            const retry = await fetchOnce(checkedAtUrl, { method: 'GET', timeoutMs, fetchImpl })

            if (retry.status >= 200 && retry.status < 400) {
                // HEAD was refused but the page itself is fine.
                response = retry
            } else if (retry.status === 404 || retry.status === 410) {
                // Same URL, but the resource really is gone.
                response = retry
            } else if (response.status === 405 || response.status === 501) {
                // HEAD was not allowed at all, so GET's answer is the better one.
                response = retry
            }
            // Otherwise HEAD said 403 and the retry did not succeed: keep the 403,
            // which classifies as "blocked" rather than "broken".
        }

        return {
            url: checkedAtUrl,
            status: classifyHttpStatus(response.status),
            httpStatus: response.status || null,
            finalUrl: response.finalUrl,
            error: '',
        }
    } catch (error) {
        const message = error?.name === 'TimeoutError'
            ? `Request timed out after ${timeoutMs}ms`
            : (error?.cause?.message || error?.message || 'Request failed')

        return {
            url: checkedAtUrl,
            status: 'error',
            httpStatus: null,
            finalUrl: '',
            error: message,
        }
    }
}

/**
 * The checkable documents on a funder (a document with no URL, or a `note`, has
 * nothing to check).
 *
 * @param {object} funder
 */
export function selectCheckableDocuments(funder) {
    const documents = Array.isArray(funder?.documents) ? funder.documents : []
    return documents
        .map(normalizeFunderDocument)
        .filter((document) => document.doc_type !== 'note' && isValidExternalUrl(document.url))
}

/**
 * Check every document URL across a list of funders.
 *
 * Requests run in ordered batches rather than a worker pool so results keep a
 * stable order and no shared array is mutated from a callback.
 *
 * @param {{ funders: object[], concurrency?: number, timeoutMs?: number, fetchImpl?: Function }} options
 * @returns {Promise<Array>} one result per document, with `funderKey`/`documentId` attached
 */
export async function checkFunderLinks({
    funders = [],
    concurrency = DEFAULT_LINK_CHECK_CONCURRENCY,
    timeoutMs = DEFAULT_LINK_CHECK_TIMEOUT_MS,
    fetchImpl = fetch,
} = {}) {
    const targets = []
    for (const funder of funders) {
        for (const document of selectCheckableDocuments(funder)) {
            targets.push({ funderKey: funder?.key || '', documentId: document.id, url: document.url })
        }
    }

    const batchSize = Math.max(1, Number.parseInt(String(concurrency), 10) || DEFAULT_LINK_CHECK_CONCURRENCY)
    const results = []

    for (let index = 0; index < targets.length; index += batchSize) {
        const batch = targets.slice(index, index + batchSize)
        const batchResults = await Promise.all(batch.map(async (target) => {
            const outcome = await checkFunderLink(target.url, { timeoutMs, fetchImpl })
            return {
                ...outcome,
                funderKey: target.funderKey,
                documentId: target.documentId,
                checkedAt: new Date().toISOString(),
            }
        }))
        results.push(...batchResults)
    }

    return results
}

/**
 * Count a result set by status.
 *
 * @param {Array} results
 */
export function summarizeLinkCheck(results) {
    const list = Array.isArray(results) ? results : []
    const summary = {
        total: list.length,
        ok: 0,
        redirect: 0,
        blocked: 0,
        broken: 0,
        error: 0,
        skipped: 0,
        problems: 0,
    }

    for (const result of list) {
        const status = String(result?.status || '').trim().toLowerCase()
        if (Object.prototype.hasOwnProperty.call(summary, status)) summary[status] += 1
        if (isProblemLinkStatus(status)) summary.problems += 1
    }

    return summary
}

/** Human one-liner for a summary, used in the CLI and the Dev Tools result panel. */
export function describeLinkCheckSummary(summary) {
    const value = summary || {}
    const parts = [`${value.total ?? 0} checked`, `${value.ok ?? 0} ok`]
    if (value.redirect) parts.push(`${value.redirect} redirected`)
    if (value.blocked) parts.push(`${value.blocked} blocked`)
    if (value.broken) parts.push(`${value.broken} broken`)
    if (value.error) parts.push(`${value.error} error`)
    if (value.skipped) parts.push(`${value.skipped} skipped`)
    return parts.join(' · ')
}
