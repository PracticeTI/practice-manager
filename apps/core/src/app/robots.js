import { headers } from 'next/headers'
import { resolveDomainModeFromHeaders } from '@/lib/domainMode'
import { resolveCanonicalOrigin } from '@/lib/siteMetadata'

// Served at /robots.txt on every host. middleware.js deliberately excludes robots.txt (and
// sitemap.xml) from its matcher, so the mode and canonical origin are resolved from the request
// hostname instead of the DOMAIN_MODE_OVERRIDE_HEADER the middleware sets.
export const dynamic = 'force-dynamic'

// Never public. /admin and /api are the ones that matter for crawl budget. The rest are already
// noindexed, so listing them here is belt-and-braces against them being discovered at all:
// * /login and /presence set robots noindex in their own metadata
// * /settings and /domains re-export src/app/admin/layout.jsx (including its generateMetadata),
//   so they inherit the admin noindex rather than rendering the admin UI without it
// * /og is a 307 to /presence
// * /admin/settings/hero-review and its /settings/hero-review alias sit under /admin and /settings,
//   both disallowed above (superadmin-only review tool)
const DISALLOWED_PATHS = [
    '/admin',
    '/api',
    '/login',
    '/presence',
    '/settings',
    '/domains',
    '/og',
]

export default async function robots() {
    const headerStore = await headers()
    const mode = resolveDomainModeFromHeaders(headerStore)
    const origin = await resolveCanonicalOrigin({ mode, headerStore })

    return {
        rules: [
            {
                userAgent: '*',
                allow: '/',
                disallow: DISALLOWED_PATHS,
            },
        ],
        sitemap: `${origin}/sitemap.xml`,
        host: origin,
    }
}
