import { NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'
import { detectDatabaseType } from '@/lib/database'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { DEFAULT_CONTENT_DOMAIN } from '@/lib/domainMode'
import { buildImageDomainClause, normalizeImageDomain } from '@/lib/imageDomains'
import { getSystemStateValue } from '@/lib/systemState'

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'])
const COMPANY_IMAGE_SEARCH_SERVICE_KEY = 'company_image_search_service'
const VALID_COMPANY_SERVICES = new Set(['wikimedia', 'brave'])
const DISABLE_LOCAL_IMAGE_LOOKUP = process.env.VERCEL === '1' || process.env.VERCEL === 'true'

function normalizeCompanySearchService(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return VALID_COMPANY_SERVICES.has(normalized) ? normalized : null
}

async function getCompanySearchServicePreference() {
  try {
    const stored = await getSystemStateValue(COMPANY_IMAGE_SEARCH_SERVICE_KEY)
    const normalized = normalizeCompanySearchService(stored)
    if (normalized) return normalized
  } catch {
    // Ignore preference lookup failures and use default.
  }
  return 'wikimedia'
}

function normalizeForMatch(value) {
  const base = String(value || '').trim().toLowerCase()
  return base
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(value) {
  const normalized = normalizeForMatch(value)
  if (!normalized) return []
  return normalized.split(' ').filter(token => token.length >= 2)
}

function matchScore(searchName, candidateName, candidateFilename) {
  const searchNormalized = normalizeForMatch(searchName)
  if (!searchNormalized) return 0

  const candidates = [candidateName, candidateFilename].filter(Boolean)
  let bestScore = 0

  for (const candidate of candidates) {
    const candidateNormalized = normalizeForMatch(candidate)
    if (!candidateNormalized) continue

    // Exact match: highest priority
    if (candidateNormalized === searchNormalized) return 100

    // Substring match: high priority
    if (candidateNormalized.includes(searchNormalized)) {
      bestScore = Math.max(bestScore, 80)
    }
    if (searchNormalized.includes(candidateNormalized)) {
      bestScore = Math.max(bestScore, 75)
    }

    // Token overlap: check if key tokens match
    const searchTokens = tokenize(searchNormalized)
    const candidateTokens = tokenize(candidateNormalized)

    if (searchTokens.length > 0 && candidateTokens.length > 0) {
      // Match first token (primary identifier)
      if (searchTokens[0] === candidateTokens[0]) {
        bestScore = Math.max(bestScore, 70)
      } else {
        // Check if any search token matches any candidate token
        const hasOverlap = searchTokens.some(token =>
          candidateTokens.includes(token)
        )
        if (hasOverlap) {
          bestScore = Math.max(bestScore, 40)
        }
      }
    }
  }

  return bestScore
}

function normalizeForFilename(value, stripDiacritics = true) {
  const base = String(value || '').trim().toLowerCase()
  const normalized = stripDiacritics
    ? base.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    : base

  return normalized
    .replace(/^file:/, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-_.]/g, '')
    .replace(/-+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
}

function resolveFolder(category) {
  const normalized = String(category || '').toLowerCase()
  if (normalized === 'actor' || normalized === 'actors') return 'actors'
  if (normalized === 'company' || normalized === 'companies') return 'companies'
  return null
}

function resolveDbCategory(category) {
  const normalized = String(category || '').toLowerCase()
  if (normalized === 'actor' || normalized === 'actors') return 'Actor'
  if (normalized === 'company' || normalized === 'companies') return 'Company'
  return null
}

function parseRowMetadata(value) {
  if (!value) return {}
  if (typeof value === 'object') return value
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return {}
    }
  }
  return {}
}

async function findLocalImage(name, category, origin) {
  if (DISABLE_LOCAL_IMAGE_LOOKUP) return null

  const folder = resolveFolder(category)
  if (!folder) return null

  const baseDirs = ['content', 'media']
  const targets = [
    normalizeForFilename(name, true),
    normalizeForFilename(name, false)
  ].filter(Boolean)

  for (const baseDir of baseDirs) {
    const basePath = path.join(process.cwd(), baseDir, folder)

    try {
      const manifestPath = path.join(basePath, 'manifest.json')
      const manifestContents = await fs.readFile(manifestPath, 'utf8')
      const manifest = JSON.parse(manifestContents)
      const manifestImages = Array.isArray(manifest?.images) ? manifest.images : []

      const manifestMatch = manifestImages.reduce((best, entry) => {
        const score = matchScore(name, entry?.name, entry?.filename)
        if (score > (best?.score || 0)) {
          return { entry, score }
        }
        return best
      }, null)?.entry

      if (manifestMatch && matchScore(name, manifestMatch?.name, manifestMatch?.filename) > 0) {
        if (manifestMatch.filename) {
          const url = new URL('/api/images/local', origin)
          url.searchParams.set('category', category)
          url.searchParams.set('file', manifestMatch.filename)
          return {
            url: url.toString(),
            title: manifestMatch.name || name,
            source: 'local-manifest',
            file: manifestMatch.filename
          }
        }

        if (manifestMatch.url) {
          return {
            url: manifestMatch.url,
            title: manifestMatch.name || name,
            source: 'local-manifest'
          }
        }
      }
    } catch (error) {
      // Ignore manifest read issues and continue
    }

    let files = []
    try {
      files = await fs.readdir(basePath)
    } catch (error) {
      continue
    }

    if (targets.length === 0) continue

    const candidate = files.find(file => {
      if (file.toLowerCase() === 'manifest.json') return false
      const ext = path.extname(file).toLowerCase()
      if (!IMAGE_EXTENSIONS.has(ext)) return false
      const base = file.toLowerCase()
      if (targets.some(target => base.startsWith(target) || base.includes(target))) {
        return true
      }
      return matchScore(name, file, file) > 60
    })

    if (!candidate) continue

    const url = new URL('/api/images/local', origin)
    url.searchParams.set('category', category)
    url.searchParams.set('file', candidate)

    return {
      url: url.toString(),
      title: name,
      source: 'local',
      file: candidate
    }
  }

  return null
}

async function findCuratedImage(name, category, domain) {
  const dbType = detectDatabaseType()
  const normalizedDbType = dbType?.toLowerCase()
  const dbCategory = resolveDbCategory(category)
  const normalizedCategory = String(category || '').toLowerCase()
  const normalizedDomain = normalizeImageDomain(domain)

  if (!normalizedDbType || !dbCategory) return null

  let connection
  try {
    connection = await getDomainBoundConnection(normalizedDomain || DEFAULT_CONTENT_DOMAIN)

    const searchValue = `%${name}%`
    const isActorCategory = normalizedCategory === 'actor' || normalizedCategory === 'actors'
    const isCompanyCategory = normalizedCategory === 'company' || normalizedCategory === 'companies'
    const isKeyArtCategory = !isActorCategory && !isCompanyCategory
    const domainFilter = buildImageDomainClause({
      dbType: normalizedDbType,
      domain: normalizedDomain,
      includeLegacy: true,
      metadataOnly: true,
      paramIndex: 2
    })
    let rows = []

    if (normalizedDbType === 'postgresql') {
      if (isActorCategory) {
        const result = await connection.query(
          `SELECT name, metadata FROM "content"
           WHERE "subtype" = $1
             ${domainFilter.clause ? `AND ${domainFilter.clause}` : ''}
             AND (
               ("type" = 'image' AND LOWER(COALESCE("metadata"->>'image_category', "metadata"->>'category', '')) IN ('actor', 'actors'))
               OR "type" = 'actor'
             )
             AND ("metadata"->>'search_phrase' ILIKE $${domainFilter.params.length + 2} OR "name" ILIKE $${domainFilter.params.length + 2})
           ORDER BY "published_at" DESC LIMIT 5`,
          ['image', ...domainFilter.params, searchValue]
        )
        rows = result.rows
      } else if (isCompanyCategory) {
        const result = await connection.query(
          `SELECT name, metadata FROM "content"
           WHERE "subtype" = $1
             ${domainFilter.clause ? `AND ${domainFilter.clause}` : ''}
             AND (
               ("type" = 'image' AND LOWER(COALESCE("metadata"->>'image_category', "metadata"->>'category', '')) IN ('company', 'companies'))
               OR "type" = 'company'
             )
             AND ("metadata"->>'search_phrase' ILIKE $${domainFilter.params.length + 2} OR "name" ILIKE $${domainFilter.params.length + 2})
           ORDER BY "published_at" DESC LIMIT 5`,
          ['image', ...domainFilter.params, searchValue]
        )
        rows = result.rows
      } else if (isKeyArtCategory) {
        const result = await connection.query(
          `SELECT name, metadata FROM "content"
           WHERE "subtype" = $1
             ${domainFilter.clause ? `AND ${domainFilter.clause}` : ''}
             AND (
               ("type" = 'image' AND LOWER(COALESCE("metadata"->>'image_category', "metadata"->>'category', '')) IN ('key_art', 'keyart', 'general'))
               OR "type" IN ('key_art', 'general')
             )
             AND ("metadata"->>'search_phrase' ILIKE $${domainFilter.params.length + 2} OR "name" ILIKE $${domainFilter.params.length + 2})
           ORDER BY "published_at" DESC LIMIT 5`,
          ['image', ...domainFilter.params, searchValue]
        )
        rows = result.rows
      }
    }

    if (!rows || rows.length === 0) return null

    const parsedRows = rows.map((row) => ({
      ...row,
      metadata: parseRowMetadata(row.metadata)
    }))
    const image = normalizedDomain
      ? parsedRows.find((row) => String(row.metadata?.domain || '').trim().toLowerCase() === normalizedDomain)
      || parsedRows.find((row) => !String(row.metadata?.domain || '').trim())
      || parsedRows[0]
      : parsedRows[0]
    const url = image.metadata?.source_url
    if (!url) return null

    return {
      url,
      title: image.name || image.metadata?.search_phrase || name,
      source: 'content'
    }
  } catch (error) {
    return null
  } finally {
    if (connection && typeof connection.end === 'function') {
      await connection.end()
    }
  }
}

async function searchWikimedia(name, category, thumbWidth = 300) {
  let searchQuery = name
  const normalized = String(category || '').toLowerCase()
  if (normalized === 'actor' || normalized === 'actors') {
    searchQuery = `${name} actor`
  } else if (normalized === 'company' || normalized === 'companies') {
    searchQuery = `${name} production company logo`
  }

  const searchUrl = new URL('https://commons.wikimedia.org/w/api.php')
  searchUrl.searchParams.set('action', 'query')
  searchUrl.searchParams.set('format', 'json')
  searchUrl.searchParams.set('list', 'search')
  searchUrl.searchParams.set('srsearch', searchQuery)
  searchUrl.searchParams.set('srnamespace', '6')
  searchUrl.searchParams.set('srlimit', '10')
  searchUrl.searchParams.set('origin', '*')

  const response = await fetch(searchUrl.toString())
  if (!response.ok) return []

  const data = await response.json()
  if (!data.query || !data.query.search || data.query.search.length === 0) {
    return []
  }

  const titles = data.query.search.slice(0, 5).map(item => item.title).join('|')
  const infoUrl = new URL('https://commons.wikimedia.org/w/api.php')
  infoUrl.searchParams.set('action', 'query')
  infoUrl.searchParams.set('format', 'json')
  infoUrl.searchParams.set('titles', titles)
  infoUrl.searchParams.set('prop', 'imageinfo')
  infoUrl.searchParams.set('iiprop', 'url|size|mime')
  infoUrl.searchParams.set('iiurlwidth', String(thumbWidth))
  infoUrl.searchParams.set('origin', '*')

  const infoResponse = await fetch(infoUrl.toString())
  if (!infoResponse.ok) return []
  const infoData = await infoResponse.json()

  if (!infoData.query || !infoData.query.pages) return []

  return Object.values(infoData.query.pages)
    .filter(page => page.imageinfo && page.imageinfo.length > 0)
    .map(page => {
      const info = page.imageinfo[0]
      return {
        url: info.thumburl || info.url,
        width: info.thumbwidth || info.width,
        height: info.thumbheight || info.height,
        title: page.title,
        pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
        mime: info.mime,
        source: 'wikimedia'
      }
    })
    .filter(img => img.mime && img.mime.startsWith('image/'))
}

async function searchBraveCompanyImages(name) {
  const apiKey = process.env.BRAVE_API_KEY
  if (!apiKey) return []

  const query = `${name} production company logo`
  const url = new URL('https://api.search.brave.com/res/v1/images/search')
  url.searchParams.set('q', query)
  url.searchParams.set('count', '12')
  url.searchParams.set('search_lang', 'en')
  url.searchParams.set('safesearch', 'off')

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey
    }
  })

  if (!response.ok) {
    return []
  }

  const data = await response.json().catch(() => ({}))
  const results = Array.isArray(data?.results) ? data.results : []

  return results
    .map((result) => ({
      url: result?.properties?.url || result?.url || null,
      width: result?.properties?.width || null,
      height: result?.properties?.height || null,
      title: result?.title || result?.description || `${name} Logo`,
      pageUrl: result?.url || result?.source || null,
      mime: result?.properties?.format || null,
      source: 'brave'
    }))
    .filter((image) => typeof image.url === 'string' && image.url.length > 0)
    .slice(0, 10)
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const name = searchParams.get('name')
    const category = searchParams.get('category') || 'actor'
    const thumbWidthParam = searchParams.get('thumbWidth')
    const parsedThumbWidth = Number.parseInt(thumbWidthParam || '', 10)
    const thumbWidth = Number.isFinite(parsedThumbWidth) && parsedThumbWidth > 0
      ? parsedThumbWidth
      : 300

    if (!name) {
      return NextResponse.json(
        { success: false, error: 'Name parameter is required' },
        { status: 400 }
      )
    }

    const origin = new URL(request.url).origin

    const normalizedCategory = String(category || '').toLowerCase()
    const isCompanyCategory = normalizedCategory === 'company' || normalizedCategory === 'companies'
    const domain = normalizeImageDomain(searchParams.get('domain'))
    const requestedCompanyService = normalizeCompanySearchService(searchParams.get('service'))

    // Production company image priority:
    // 1) curated DB image
    // 2) configured search service from system_settings (brave|wikimedia)
    // 3) local manifest/files
    // 4) alternate search service fallback
    if (isCompanyCategory) {
      const curatedImage = await findCuratedImage(name, category, domain)
      if (curatedImage) {
        return NextResponse.json({
          success: true,
          images: [curatedImage],
          count: 1,
          source: 'content',
          provider: 'content'
        })
      }

      const configuredService = requestedCompanyService || await getCompanySearchServicePreference()

      const primaryImages = configuredService === 'brave'
        ? await searchBraveCompanyImages(name)
        : await searchWikimedia(name, category, thumbWidth)

      if (primaryImages.length > 0) {
        return NextResponse.json({
          success: true,
          images: primaryImages,
          count: primaryImages.length,
          source: configuredService,
          provider: configuredService
        })
      }
      const localImage = await findLocalImage(name, category, origin)
      if (localImage) {
        return NextResponse.json({
          success: true,
          images: [localImage],
          count: 1,
          source: 'local',
          provider: 'local'
        })
      }

      const fallbackService = configuredService === 'brave' ? 'wikimedia' : 'brave'
      const fallbackImages = fallbackService === 'brave'
        ? await searchBraveCompanyImages(name)
        : await searchWikimedia(name, category, thumbWidth)

      return NextResponse.json({
        success: true,
        images: fallbackImages,
        count: fallbackImages.length,
        source: fallbackService,
        provider: fallbackService
      })
    } else {
      const localImage = await findLocalImage(name, category, origin)
      if (localImage) {
        return NextResponse.json({
          success: true,
          images: [localImage],
          count: 1,
          source: 'local',
          provider: 'local'
        })
      }

      const curatedImage = await findCuratedImage(name, category, domain)
      if (curatedImage) {
        return NextResponse.json({
          success: true,
          images: [curatedImage],
          count: 1,
          source: 'content',
          provider: 'content'
        })
      }
    }

    const images = await searchWikimedia(name, category, thumbWidth)
    return NextResponse.json({
      success: true,
      images,
      count: images.length,
      source: 'wikimedia',
      provider: 'wikimedia'
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  })
}
