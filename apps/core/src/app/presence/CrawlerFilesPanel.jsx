import { isContentSitemapMode, listPublishedContentSlugs } from '@/lib/contentListing'
import { extractLocs, fetchFromSelf, resolveSelfBaseUrl } from './crawlerFetch'

function CheckRow({ ok, label, detail }) {
    return (
        <li className="flex items-start gap-2 py-1.5 text-sm">
            <span className={ok ? 'text-emerald-600' : 'text-amber-600'} aria-hidden="true">{ok ? '✓' : '⚠'}</span>
            <span className="font-medium text-slate-800">{label}</span>
            <span className="text-slate-600 break-all">{detail}</span>
        </li>
    )
}

/**
 * Verifies what this host actually serves at /robots.txt and /sitemap.xml.
 *
 * The two files resolve their brand from the request hostname (middleware.js excludes both from
 * its matcher, so the DOMAIN_MODE_OVERRIDE_HEADER is never set for them), which makes it easy to
 * ship a sitemap listing another brand's URLs without noticing. This panel fetches both files
 * back over HTTP and compares them against the canonical origin and the expected content pages.
 */
export default async function CrawlerFilesPanel({ mode, canonicalOrigin, hostHeader }) {
    const base = resolveSelfBaseUrl(hostHeader)

    const [robotsFile, sitemapFile] = await Promise.all([
        fetchFromSelf('/robots.txt', hostHeader),
        fetchFromSelf('/sitemap.xml', hostHeader),
    ])

    const sitemapUrls = extractLocs(sitemapFile.body)
    const robotsSitemapUrl = String(robotsFile.body).match(/^\s*Sitemap:\s*(\S+)/mi)?.[1] || ''
    const robotsHost = String(robotsFile.body).match(/^\s*Host:\s*(\S+)/mi)?.[1] || ''
    const disallowCount = (String(robotsFile.body).match(/^\s*Disallow:/gmi) || []).length

    const offOriginUrls = sitemapUrls.filter((url) => !url.startsWith(canonicalOrigin))
    const contentPagesEnabled = isContentSitemapMode(mode)
    const expectedContentUrls = contentPagesEnabled
        ? (await listPublishedContentSlugs({ domain: mode })).map((slug) => `${canonicalOrigin}/${encodeURIComponent(slug)}`)
        : []
    const missingContentUrls = expectedContentUrls.filter((url) => !sitemapUrls.includes(url))
    const listedContentCount = sitemapUrls.filter((url) => expectedContentUrls.includes(url)).length

    return (
        <>
            <h2 className="mt-8 text-lg font-semibold text-slate-900">Crawler Files</h2>
            <p className="mt-1 text-sm text-slate-600">
                Fetched live from <code className="break-all">{base}</code> — robots.txt and sitemap.xml resolve their brand from
                the request hostname (the middleware skips both paths), so this checks the served output rather than the intent.
            </p>

            <ul className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-2">
                <CheckRow
                    ok={robotsFile.ok}
                    label="robots.txt"
                    detail={robotsFile.ok
                        ? `${robotsFile.status} ${robotsFile.contentType} — ${disallowCount} disallow rule(s)`
                        : (robotsFile.error || `HTTP ${robotsFile.status}`)}
                />
                <CheckRow
                    ok={sitemapFile.ok}
                    label="sitemap.xml"
                    detail={sitemapFile.ok
                        ? `${sitemapFile.status} ${sitemapFile.contentType} — ${sitemapUrls.length} URL(s)`
                        : (sitemapFile.error || `HTTP ${sitemapFile.status}`)}
                />
                <CheckRow
                    ok={robotsSitemapUrl === `${canonicalOrigin}/sitemap.xml`}
                    label="robots Sitemap directive"
                    detail={robotsSitemapUrl || '(missing)'}
                />
                <CheckRow
                    ok={robotsHost === canonicalOrigin}
                    label="robots Host directive"
                    detail={robotsHost || '(missing)'}
                />
                <CheckRow
                    ok={offOriginUrls.length === 0}
                    label="sitemap URLs match canonical origin"
                    detail={offOriginUrls.length === 0
                        ? `all ${sitemapUrls.length} under ${canonicalOrigin}`
                        : `${offOriginUrls.length} cross-origin: ${offOriginUrls.join(', ')}`}
                />
                <CheckRow
                    ok={missingContentUrls.length === 0}
                    label={contentPagesEnabled ? 'content pages listed' : 'content pages (disabled for this brand)'}
                    detail={contentPagesEnabled
                        ? `${listedContentCount}/${expectedContentUrls.length} expected /[slug] URL(s) present${missingContentUrls.length > 0 ? ` — missing: ${missingContentUrls.join(', ')}` : ''}`
                        : 'landing page only'}
                />
            </ul>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div className="overflow-hidden rounded-xl border border-slate-200">
                    <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                        /robots.txt
                    </div>
                    <pre className="max-h-72 overflow-auto px-4 py-3 text-xs leading-relaxed text-slate-700">{robotsFile.body || (robotsFile.error || '(empty)')}</pre>
                </div>
                <div className="overflow-hidden rounded-xl border border-slate-200">
                    <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                        /sitemap.xml — {sitemapUrls.length} URL(s)
                    </div>
                    <pre className="max-h-72 overflow-auto px-4 py-3 text-xs leading-relaxed text-slate-700">{sitemapUrls.length > 0
                        ? sitemapUrls.join('\n')
                        : (sitemapFile.error || '(no <loc> entries)')}</pre>
                </div>
            </div>
        </>
    )
}
