import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { getDomainLabel, resolveDomainModeFromHeaders } from '@/lib/domainMode'
import { normalizeMetadata, safeJsonParse } from '@/lib/contentNode'
import { contentTableHasDomainColumn } from '@/lib/contentListing'
import { getDomainSeoSettings, resolveCanonicalOrigin, resolveContentOgImage, resolveDomainOgImage, toAbsoluteUrl } from '@/lib/siteMetadata'
import { attachResolvedSinglePostBlocks, toPageBlockPostOption } from '@/lib/pageBlockPosts'
import { normalizePageBlocks } from '@/lib/pageBlocks'
import SlugPageReader from './SlugPageReader'

function splitParagraphs(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function humanizeToken(value) {
  return String(value || '')
    .trim()
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function buildSlugPath(slug) {
  const value = String(slug || '').trim()
  return value ? `/${encodeURIComponent(value)}` : '/'
}

async function findPublishedContentBySlug({ domain, slug }) {
  const dbType = detectDatabaseType()
  if (dbType !== 'postgresql') {
    return null
  }

  const connection = await getDatabaseConnection()
  try {
    const hasDomainColumn = await contentTableHasDomainColumn(connection, dbType)
    const result = await connection.query(
      `SELECT *
       FROM content
       WHERE LOWER(COALESCE(${hasDomainColumn ? 'domain, ' : ''}attributes->>'domain', metadata->>'domain', '')) = LOWER($1)
         AND LOWER(COALESCE(metadata->>'slug', slug, '')) = LOWER($2)
         AND type IN ('article', 'post', 'page')
         AND LOWER(COALESCE(subtype, '')) <> 'home'
         AND LOWER(COALESCE(status, '')) = 'published'
       ORDER BY updated_at DESC
       LIMIT 1`,
      [domain, slug]
    )
    return result.rows[0] || null
  } finally {
    if (connection?.end) {
      await connection.end().catch(() => { })
    }
  }
}

async function findPublishedPostsByReferences({ domain, ids = [], slugs = [] }) {
  const dbType = detectDatabaseType()
  if (dbType !== 'postgresql') {
    return []
  }

  const normalizedIds = Array.from(new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()).filter(Boolean)))
  const normalizedSlugs = Array.from(new Set((Array.isArray(slugs) ? slugs : []).map((slug) => String(slug || '').trim().toLowerCase()).filter(Boolean)))
  if (normalizedIds.length === 0 && normalizedSlugs.length === 0) {
    return []
  }

  const connection = await getDatabaseConnection()
  try {
    const hasDomainColumn = await contentTableHasDomainColumn(connection, dbType)
    const params = [domain]
    const referenceClauses = []

    if (normalizedIds.length > 0) {
      params.push(normalizedIds)
      referenceClauses.push(`CAST(id AS TEXT) = ANY($${params.length}::text[])`)
    }

    if (normalizedSlugs.length > 0) {
      params.push(normalizedSlugs)
      referenceClauses.push(`LOWER(COALESCE(metadata->>'slug', slug, '')) = ANY($${params.length}::text[])`)
    }

    const result = await connection.query(
      `SELECT *
       FROM content
       WHERE LOWER(COALESCE(${hasDomainColumn ? 'domain, ' : ''}attributes->>'domain', metadata->>'domain', '')) = LOWER($1)
         AND type IN ('post', 'article')
         AND LOWER(COALESCE(status, '')) = 'published'
         AND (${referenceClauses.join(' OR ')})`,
      params
    )

    return result.rows || []
  } finally {
    if (connection?.end) {
      await connection.end().catch(() => { })
    }
  }
}

export async function generateMetadata({ params }) {
  const resolvedParams = await Promise.resolve(params)
  const slug = String(resolvedParams?.slug || '').trim()
  if (!slug) {
    return {}
  }

  const headerStore = await headers()
  const mode = resolveDomainModeFromHeaders(headerStore)
  const seo = await getDomainSeoSettings(mode)
  const label = getDomainLabel(mode)
  const canonicalOrigin = await resolveCanonicalOrigin({ mode, headerStore })
  const canonicalUrl = `${canonicalOrigin}${buildSlugPath(slug)}`

  let row = null
  try {
    row = await findPublishedContentBySlug({ domain: mode, slug })
  } catch {
    row = null
  }

  if (!row) {
    const fallbackTitle = humanizeToken(slug)
    const fallbackDescription = seo.metaDescription || `Explore ${fallbackTitle} on ${label}.`
    const fallbackImage = resolveDomainOgImage({ mode, origin: canonicalOrigin, configuredImageUrl: seo.ogImageUrl })
      || resolveContentOgImage({ metadata: {}, mode, origin: canonicalOrigin })

    return {
      title: fallbackTitle,
      description: fallbackDescription,
      metadataBase: new URL(canonicalOrigin),
      alternates: { canonical: canonicalUrl },
      openGraph: {
        title: fallbackTitle,
        description: fallbackDescription,
        url: canonicalUrl,
        siteName: label,
        type: 'article',
        images: fallbackImage ? [{ url: fallbackImage, width: 1200, height: 630, alt: `${fallbackTitle} preview` }] : [],
      },
      twitter: {
        card: seo.twitterCard,
        title: fallbackTitle,
        description: fallbackDescription,
        images: fallbackImage ? [fallbackImage] : [],
      },
    }
  }

  const metadata = normalizeMetadata(row.metadata, row)
  const presentation = metadata?.presentation?.default || {}
  const title = presentation.title || row.title || row.name || humanizeToken(slug)
  const description = presentation.summary || row.summary || seo.metaDescription || `Explore ${title} on ${label}.`
  const imageUrl = toAbsoluteUrl(canonicalOrigin, presentation.image_url)
    || resolveDomainOgImage({ mode, origin: canonicalOrigin, configuredImageUrl: seo.ogImageUrl })
    || resolveContentOgImage({ metadata, mode, origin: canonicalOrigin })

  return {
    title,
    description,
    metadataBase: new URL(canonicalOrigin),
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title,
      description,
      url: canonicalUrl,
      siteName: label,
      type: 'article',
      images: imageUrl ? [{ url: imageUrl, width: 1200, height: 630, alt: `${title} preview` }] : [],
    },
    twitter: {
      card: seo.twitterCard,
      title,
      description,
      images: imageUrl ? [imageUrl] : [],
    },
  }
}

export default async function SlugPage({ params }) {
  const resolvedParams = await Promise.resolve(params)
  const slug = String(resolvedParams?.slug || '').trim()
  if (!slug) notFound()

  const headerStore = await headers()
  const mode = resolveDomainModeFromHeaders(headerStore)

  let row = null
  try {
    row = await findPublishedContentBySlug({ domain: mode, slug })
  } catch (error) {
    console.error('Error resolving slug page:', error)
    notFound()
  }

  if (!row) notFound()

  const metadata = normalizeMetadata(row.metadata, row)
  const attributes = safeJsonParse(row.attributes, {})
  const presentation = metadata?.presentation?.default || {}
  const blocks = normalizePageBlocks(metadata?.blocks)
  const singlePostIds = blocks
    .filter((block) => block?.type === 'single_post')
    .map((block) => String(block?.postId || '').trim())
    .filter(Boolean)
  const singlePostSlugs = blocks
    .filter((block) => block?.type === 'single_post')
    .map((block) => String(block?.postSlug || '').trim().toLowerCase())
    .filter(Boolean)
  const singlePostRows = await findPublishedPostsByReferences({
    domain: mode,
    ids: singlePostIds,
    slugs: singlePostSlugs
  })
  const displayBlocks = attachResolvedSinglePostBlocks(blocks, singlePostRows.map((item) => toPageBlockPostOption(item)))

  const pageTitle = presentation.title || row.title || row.name || humanizeToken(slug)
  const summary = presentation.summary || row.summary || ''
  const body = String(row.body || '').trim()
  const category = String(metadata?.category || attributes?.category || row.subtype || row.type || 'post').trim()
  const label = getDomainLabel(mode)

  const bodyParagraphs = splitParagraphs(body)
  const summaryParagraphs = splitParagraphs(summary)

  return (
    <SlugPageReader
      mode={mode}
      label={label}
      categoryLabel={humanizeToken(category)}
      pageTitle={pageTitle}
      summaryParagraphs={summaryParagraphs}
      bodyParagraphs={bodyParagraphs}
      blocks={displayBlocks}
    />
  )
}