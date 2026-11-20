import test from 'node:test'
import assert from 'node:assert/strict'
import {
    checkFunderLink,
    checkFunderLinks,
    classifyHttpStatus,
    describeLinkCheckSummary,
    getFunderLinkStatusLabel,
    isProblemLinkStatus,
    selectCheckableDocuments,
    summarizeLinkCheck,
} from '../src/lib/funderLinkCheck.js'

/** Minimal stand-in for a fetch Response: status, a location header, a cancellable body. */
function fakeResponse(status, location = '') {
    return {
        status,
        headers: {
            get: (name) => (String(name).toLowerCase() === 'location' ? (location || null) : null),
        },
        body: { cancel: async () => { } },
    }
}

/** Fetch stub that hands back scripted responses and records the calls it received. */
function scriptedFetch(responses) {
    const calls = []
    return {
        calls,
        fetchImpl: async (url, options) => {
            calls.push({ url, method: options?.method })
            const next = responses.shift()
            if (!next) throw new Error('No scripted response left')
            if (next instanceof Error) throw next
            return next
        },
    }
}

test('classifyHttpStatus separates blocked from broken', () => {
    assert.equal(classifyHttpStatus(200), 'ok')
    assert.equal(classifyHttpStatus(206), 'ok')
    assert.equal(classifyHttpStatus(301), 'redirect')
    assert.equal(classifyHttpStatus(302), 'redirect')
    assert.equal(classifyHttpStatus(403), 'blocked')
    assert.equal(classifyHttpStatus(429), 'blocked')
    assert.equal(classifyHttpStatus(404), 'broken')
    assert.equal(classifyHttpStatus(410), 'broken')
    assert.equal(classifyHttpStatus(451), 'broken')
    assert.equal(classifyHttpStatus(500), 'error')
    assert.equal(classifyHttpStatus(0), 'error')
})

test('checkFunderLink reports a healthy link after a single HEAD', async () => {
    const fetcher = scriptedFetch([fakeResponse(200)])
    const result = await checkFunderLink('https://example.com/a', { fetchImpl: fetcher.fetchImpl })

    assert.equal(result.status, 'ok')
    assert.equal(result.httpStatus, 200)
    assert.equal(result.error, '')
    assert.equal(fetcher.calls.length, 1)
    assert.equal(fetcher.calls[0].method, 'HEAD')
})

test('checkFunderLink retries with GET when HEAD is refused', async () => {
    // A CDN that serves GET but rejects HEAD must not be reported as broken.
    const fetcher = scriptedFetch([fakeResponse(403), fakeResponse(206)])
    const result = await checkFunderLink('https://www.ndis.gov.au/media/8841/download?attachment', {
        fetchImpl: fetcher.fetchImpl,
    })

    assert.equal(result.status, 'ok')
    assert.equal(result.httpStatus, 206)
    assert.deepEqual(fetcher.calls.map((call) => call.method), ['HEAD', 'GET'])
})

test('checkFunderLink keeps "blocked" when GET is refused too', async () => {
    const fetcher = scriptedFetch([fakeResponse(403), fakeResponse(403)])
    const result = await checkFunderLink('https://example.com/blocked', { fetchImpl: fetcher.fetchImpl })

    assert.equal(result.status, 'blocked')
    assert.equal(result.httpStatus, 403)
})

test('checkFunderLink trusts a GET 404 over a fenced HEAD 403', async () => {
    const fetcher = scriptedFetch([fakeResponse(403), fakeResponse(404)])
    const result = await checkFunderLink('https://example.com/gone', { fetchImpl: fetcher.fetchImpl })

    assert.equal(result.status, 'broken')
    assert.equal(result.httpStatus, 404)
})

test('checkFunderLink does not retry a plain 404', async () => {
    const fetcher = scriptedFetch([fakeResponse(404)])
    const result = await checkFunderLink('https://example.com/missing', { fetchImpl: fetcher.fetchImpl })

    assert.equal(result.status, 'broken')
    assert.equal(fetcher.calls.length, 1)
})

test('checkFunderLink records redirects with the resolved target', async () => {
    const fetcher = scriptedFetch([fakeResponse(301, '/providers/pricing')])
    const result = await checkFunderLink('https://www.ndis.gov.au/providers', { fetchImpl: fetcher.fetchImpl })

    assert.equal(result.status, 'redirect')
    assert.equal(result.httpStatus, 301)
    assert.equal(result.finalUrl, 'https://www.ndis.gov.au/providers/pricing')
})

test('checkFunderLink reports timeouts and network failures as errors', async () => {
    const timeout = Object.assign(new Error('aborted'), { name: 'TimeoutError' })
    const timedOut = await checkFunderLink('https://example.com/slow', {
        timeoutMs: 50,
        fetchImpl: scriptedFetch([timeout]).fetchImpl,
    })
    assert.equal(timedOut.status, 'error')
    assert.equal(timedOut.error, 'Request timed out after 50ms')

    const failed = await checkFunderLink('https://example.com/down', {
        fetchImpl: scriptedFetch([new Error('fetch failed')]).fetchImpl,
    })
    assert.equal(failed.status, 'error')
    assert.equal(failed.error, 'fetch failed')
})

test('checkFunderLink skips anything that is not an absolute http(s) URL', async () => {
    const fetcher = scriptedFetch([])
    const result = await checkFunderLink('ndis.gov.au/pricing', { fetchImpl: fetcher.fetchImpl })

    assert.equal(result.status, 'skipped')
    assert.equal(result.error, 'Not an absolute http(s) URL')
    assert.equal(fetcher.calls.length, 0, 'nothing was requested')
})

test('checkFunderLinks only checks linkable documents and keeps their order', async () => {
    const funder = {
        key: 'ndis',
        documents: [
            { id: 1, title: 'Pricing', url: 'https://example.com/1', doc_type: 'link' },
            { id: 2, title: 'Internal note', doc_type: 'note' },
            { id: 3, title: 'No URL', doc_type: 'link' },
            { id: 4, title: 'Catalogue', url: 'https://example.com/4', doc_type: 'file' },
        ],
    }

    assert.deepEqual(selectCheckableDocuments(funder).map((document) => document.id), [1, 4])

    const fetcher = scriptedFetch([fakeResponse(200), fakeResponse(404)])
    const results = await checkFunderLinks({ funders: [funder], concurrency: 1, fetchImpl: fetcher.fetchImpl })

    assert.deepEqual(results.map((result) => result.documentId), [1, 4])
    assert.deepEqual(results.map((result) => result.status), ['ok', 'broken'])
    assert.deepEqual(results.map((result) => result.funderKey), ['ndis', 'ndis'])
    assert.ok(results.every((result) => Boolean(result.checkedAt)))
})

test('summarizeLinkCheck counts each status and the ones worth acting on', () => {
    const summary = summarizeLinkCheck([
        { status: 'ok' }, { status: 'ok' }, { status: 'redirect' },
        { status: 'blocked' }, { status: 'broken' }, { status: 'error' }, { status: 'skipped' },
    ])

    assert.deepEqual(summary, {
        total: 7, ok: 2, redirect: 1, blocked: 1, broken: 1, error: 1, skipped: 1, problems: 3,
    })
    assert.equal(summarizeLinkCheck().total, 0)
})

test('describeLinkCheckSummary only mentions the states that occurred', () => {
    assert.equal(
        describeLinkCheckSummary({ total: 25, ok: 25 }),
        '25 checked · 25 ok'
    )
    assert.equal(
        describeLinkCheckSummary({ total: 4, ok: 2, blocked: 1, broken: 1 }),
        '4 checked · 2 ok · 1 blocked · 1 broken'
    )
})

test('link status labels and problem detection fall back safely', () => {
    assert.equal(getFunderLinkStatusLabel('broken'), 'Broken')
    assert.equal(getFunderLinkStatusLabel(''), 'Not checked')
    assert.equal(getFunderLinkStatusLabel('nonsense'), 'nonsense')

    assert.equal(isProblemLinkStatus('broken'), true)
    assert.equal(isProblemLinkStatus('error'), true)
    assert.equal(isProblemLinkStatus('blocked'), true)
    assert.equal(isProblemLinkStatus('ok'), false)
    assert.equal(isProblemLinkStatus(''), false)
})
