import { headers } from 'next/headers'
import { resolveDomainModeFromHeaders } from '@/lib/domainMode'
import { resolveCanonicalOrigin } from '@/lib/siteMetadata'
import { isContentSitemapMode, listPublishedContentSlugs } from '@/lib/contentListing'
import { getPrivateSitemapPaths } from '@/lib/domainExtension'

// Served at /sitemap.xml on every host. Like robots.js this resolves the brand from the request
// hostname, because middleware.js excludes sitemap.xml from its matcher. A sitemap must only
// list URLs on the origin that serves it, so the paths are resolved against that brand's
// canonical origin rather than a hardcoded one.
export const dynamic = 'force-dynamic'

// Public pages per brand. The Allied Health directories are the directory operator's own
// pages and are canonicalised to that origin (see src/lib/alliedHealthMetadata.js), so they are listed under
// that origin and are not duplicated onto every client host.
const PUBLIC_PATHS_BY_MODE = {
    ...getPrivateSitemapPaths(),
}

const DEFAULT_PUBLIC_PATHS = ['/']

// Each brand's landing page, plus /[slug] content pages for the brands that publish them
// (see CONTENT_SITEMAP_MODES).
export default async function sitemap() {
    const headerStore = await headers()
    const mode = resolveDomainModeFromHeaders(headerStore)
    const origin = await resolveCanonicalOrigin({ mode, headerStore })
    const paths = PUBLIC_PATHS_BY_MODE[mode] || DEFAULT_PUBLIC_PATHS

    // No lastModified: the directory data changes without a per-page timestamp, and Google only
    // honours lastmod when it is consistently accurate.
    const entries = paths.map((path) => ({
        url: `${origin}${path}`,
        changeFrequency: path === '/' ? 'weekly' : 'daily',
    }))

    // /[slug] content pages canonicalise to this host's own origin, so they belong here rather
    // than under the directory operator's origin.
    if (isContentSitemapMode(mode)) {
        const slugs = await listPublishedContentSlugs({ domain: mode })
        const seen = new Set(entries.map((entry) => entry.url))
        for (const slug of slugs) {
            const url = `${origin}/${encodeURIComponent(slug)}`
            if (seen.has(url)) continue
            seen.add(url)
            entries.push({ url, changeFrequency: 'monthly' })
        }
    }

    return entries
}
