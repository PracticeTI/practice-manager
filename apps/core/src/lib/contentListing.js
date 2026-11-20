// Shared queries over the `content` table.
//
// Extracted because src/app/[slug]/page.jsx and src/app/api/content/route.js each carried an
// identical copy of contentTableHasDomainColumn(), and the sitemap needs to enumerate the
// published content pages for a domain.
//
// listPublishedContentSlugs() deliberately mirrors findPublishedContentBySlug() in
// src/app/[slug]/page.jsx: a slug only belongs in the sitemap if /[slug] would actually resolve
// it. Change the filters in one place and the other needs the same change.

import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { getPrivateDomainModesWithFlag } from '@/lib/domainExtension'

// Domains whose published /[slug] content pages are listed in /sitemap.xml. Shared so the
// /presence verification panel reports the same policy the sitemap applies.
export const CONTENT_SITEMAP_MODES = getPrivateDomainModesWithFlag('contentSitemap')

export function isContentSitemapMode(mode) {
    return CONTENT_SITEMAP_MODES.includes(String(mode || '').trim().toLowerCase())
}

export async function contentTableHasDomainColumn(connection) {
    const result = await connection.query(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'content'
           AND column_name = 'domain'
         LIMIT 1`
    )
    return result.rows.length > 0
}

/**
 * Published, routable slugs for one domain — most recently updated first, deduped
 * case-insensitively (the lookups are case-insensitive, so two casings are one page).
 *
 * Returns [] instead of throwing when the database is unreachable or not PostgreSQL, so a
 * sitemap request can still serve the static routes.
 */
export async function listPublishedContentSlugs({ domain, limit = 1000 } = {}) {
    const normalizedDomain = String(domain || '').trim()
    if (!normalizedDomain) return []
    if (detectDatabaseType() !== 'postgresql') return []

    let connection
    try {
        connection = await getDatabaseConnection()
        const hasDomainColumn = await contentTableHasDomainColumn(connection)
        const domainExpression = hasDomainColumn
            ? "COALESCE(domain, attributes->>'domain', metadata->>'domain', '')"
            : "COALESCE(attributes->>'domain', metadata->>'domain', '')"

        const result = await connection.query(
            `SELECT COALESCE(NULLIF(metadata->>'slug', ''), NULLIF(slug, '')) AS slug, updated_at
             FROM content
             WHERE LOWER(${domainExpression}) = LOWER($1)
               AND type IN ('article', 'post', 'page')
               AND LOWER(COALESCE(subtype, '')) <> 'home'
               AND LOWER(COALESCE(status, '')) = 'published'
             ORDER BY updated_at DESC NULLS LAST
             LIMIT $2`,
            [normalizedDomain, limit]
        )

        const seen = new Set()
        const slugs = []
        for (const row of result.rows || []) {
            const slug = String(row?.slug || '').trim()
            if (!slug) continue
            const key = slug.toLowerCase()
            if (seen.has(key)) continue
            seen.add(key)
            slugs.push(slug)
        }
        return slugs
    } catch {
        return []
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
        else if (connection?.close) await connection.close().catch(() => { })
    }
}
