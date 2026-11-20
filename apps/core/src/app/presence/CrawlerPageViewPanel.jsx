import { extractLocs, fetchFromSelf, resolveSelfBaseUrl } from './crawlerFetch'

// Below this much crawlable text an indexable page is effectively empty to a crawler. The usual
// cause is content that only exists after client-side hydration, which is invisible to any
// consumer that does not execute JavaScript.
const THIN_PAGE_WORDS = 150

const FETCH_CONCURRENCY = 4
const MAX_PAGES = 15

// Never indexable, and cheap to fetch. Checked alongside the sitemap URLs so a correct noindex
// appears for contrast.
const CONTROL_PATHS = ['/login']

// This page performs its own self-fetches, so requesting it from here recurses (each nested
// render issues another round of fetches) until the request timeouts cascade. Never crawl it.
const SELF_PATH = '/presence'

/** Body text a crawler sees without executing JavaScript (scripts and styles removed). */
function textOf(html) {
    return String(html || '')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

function firstMatch(html, pattern) {
    return String(html || '').match(pattern)?.[1]?.trim() || ''
}

function analysePage(html, { canonicalOrigin, expectNoindex = false } = {}) {
    const source = String(html || '')
    const text = textOf(source)
    const words = text ? text.split(' ').length : 0
    const robots = firstMatch(source, /<meta name="robots" content="([^"]*)"/i)
    const canonical = firstMatch(source, /<link rel="canonical" href="([^"]*)"/i)
    const ogUrl = firstMatch(source, /<meta property="og:url" content="([^"]*)"/i)
    const title = firstMatch(source, /<title[^>]*>([\s\S]*?)<\/title>/i)
    const noindex = /noindex/i.test(robots)
    const h1Count = (source.match(/<h1[\s>]/gi) || []).length
    const jsonLdCount = (source.match(/application\/ld\+json/gi) || []).length

    const warnings = []
    if (!robots) warnings.push('no robots directive')
    if (expectNoindex) {
        // A control page exists to prove noindex is applied, so only its absence is notable.
        if (!noindex) warnings.push('expected noindex but the page is indexable')
    } else {
        if (noindex) warnings.push('noindex')
        else if (words < THIN_PAGE_WORDS) warnings.push(`only ${words} words reach a crawler`)
        if (h1Count === 0) warnings.push('no <h1>')
    }
    if (!canonical) warnings.push('no canonical')
    else if (!canonical.startsWith(canonicalOrigin)) warnings.push('canonical points off this origin')
    if (canonical && ogUrl && ogUrl !== canonical) warnings.push('og:url differs from canonical')

    return { words, robots, canonical, ogUrl, title, h1Count, jsonLdCount, noindex, warnings }
}

function StatusCell({ response }) {
    if (!response.ok) {
        return <span className="text-amber-700">⚠ {response.status || 'error'}</span>
    }
    return (
        <span className="text-emerald-700">
            {response.status}
            {response.redirectUrl ? <span className="text-slate-500"> ↳</span> : null}
        </span>
    )
}

/**
 * Shows what a crawler receives for every page this host advertises.
 *
 * The target list comes from the live /sitemap.xml rather than a hardcoded set, so this checks the
 * URLs search engines have actually been told about. Each is fetched back over HTTP (no JavaScript
 * execution, mirroring a non-rendering crawler) and reported with the crawlable word count —
 * the fastest way to spot a page whose content never leaves the client.
 */
export default async function CrawlerPageViewPanel({ canonicalOrigin, hostHeader }) {
    const base = resolveSelfBaseUrl(hostHeader)
    const sitemapFile = await fetchFromSelf('/sitemap.xml', hostHeader)
    const sitemapUrls = extractLocs(sitemapFile.body)

    const targets = [
        ...sitemapUrls.map((url) => ({ url, path: url.replace(/^[a-z]+:\/\/[^/]+/i, '') || '/', source: 'sitemap' })),
        ...CONTROL_PATHS.map((path) => ({ url: `${canonicalOrigin}${path}`, path, source: 'control' })),
    ].filter((target) => target.path !== SELF_PATH).slice(0, MAX_PAGES)

    // Fetched in batches so a host with a long sitemap does not open every request at once, and
    // results are collected by return value rather than by mutating a shared array.
    const pages = []
    for (let index = 0; index < targets.length; index += FETCH_CONCURRENCY) {
        const batch = targets.slice(index, index + FETCH_CONCURRENCY)
        pages.push(...await Promise.all(batch.map(async (target) => {
            const response = await fetchFromSelf(target.path, hostHeader)
            return {
                target,
                response,
                analysis: response.ok
                    ? analysePage(response.body, { canonicalOrigin, expectNoindex: target.source === 'control' })
                    : null,
            }
        })))
    }

    const withWarnings = pages.filter((page) => page.analysis?.warnings.length > 0)

    return (
        <>
            <h2 className="mt-8 text-lg font-semibold text-slate-900">Crawler Page View</h2>
            <p className="mt-1 text-sm text-slate-600">
                Every URL this host advertises in <code>sitemap.xml</code>, fetched back without executing JavaScript — so this is
                what a crawler that does not render sees. <strong className="font-semibold">Words</strong> counts body text with
                scripts and styles removed; a low number on an indexable page means the content only exists after hydration.
            </p>

            {targets.length === 0 ? (
                <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    No URLs could be read from {base}/sitemap.xml{sitemapFile.error ? ` (${sitemapFile.error})` : ''}.
                </p>
            ) : (
                <>
                    <p className="mt-3 text-sm text-slate-600">
                        {pages.length} page(s) checked
                        {withWarnings.length > 0 ? ` — ${withWarnings.length} with notes` : ' — no issues found'}
                    </p>
                    <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200">
                        <table className="min-w-full border-collapse bg-white text-sm">
                            <thead className="bg-slate-100 text-slate-700">
                                <tr>
                                    <th className="px-3 py-2 text-left font-semibold">Page</th>
                                    <th className="px-3 py-2 text-left font-semibold">Status</th>
                                    <th className="px-3 py-2 text-right font-semibold">Words</th>
                                    <th className="px-3 py-2 text-right font-semibold">H1</th>
                                    <th className="px-3 py-2 text-right font-semibold">LD+JSON</th>
                                    <th className="px-3 py-2 text-left font-semibold">robots</th>
                                    <th className="px-3 py-2 text-left font-semibold">canonical</th>
                                    <th className="px-3 py-2 text-left font-semibold">notes</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                                {pages.map((page) => {
                                    const { target, response, analysis } = page
                                    return (
                                        <tr key={target.path} className="align-top text-slate-700">
                                            <td className="px-3 py-2">
                                                <code className="break-all">{target.path}</code>
                                                {target.source === 'control' ? <span className="ml-2 text-xs text-slate-400">control</span> : null}
                                                {analysis?.title ? <div className="mt-1 text-xs text-slate-500">{analysis.title}</div> : null}
                                            </td>
                                            <td className="px-3 py-2"><StatusCell response={response} /></td>
                                            <td className={`px-3 py-2 text-right font-medium ${analysis && !analysis.noindex && analysis.words < THIN_PAGE_WORDS ? 'text-amber-700' : 'text-slate-800'}`}>
                                                {analysis ? analysis.words : '—'}
                                            </td>
                                            <td className="px-3 py-2 text-right">{analysis ? analysis.h1Count : '—'}</td>
                                            <td className="px-3 py-2 text-right">{analysis ? analysis.jsonLdCount : '—'}</td>
                                            <td className="px-3 py-2">{analysis ? (analysis.robots || '—') : '—'}</td>
                                            <td className="px-3 py-2">
                                                <code className="break-all text-xs">{analysis ? (analysis.canonical || '—') : (response.error || '—')}</code>
                                            </td>
                                            <td className="px-3 py-2 text-xs">
                                                {analysis && analysis.warnings.length > 0
                                                    ? <span className="text-amber-700">{analysis.warnings.join('; ')}</span>
                                                    : <span className="text-emerald-700">ok</span>}
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            <p className="mt-3 text-xs text-slate-500">
                Nothing here can tell you whether Google <em>rendered</em> the JavaScript. For that, use Search Console → URL
                Inspection → &ldquo;Test live URL&rdquo; → &ldquo;View crawled page&rdquo;.
            </p>
        </>
    )
}
