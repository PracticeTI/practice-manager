import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { getPrivateContentTypeOwner } from '@/lib/domainExtension'
import {
  buildNodeResponse,
  ensureSlug,
  normalizeContentType,
  normalizeMetadata,
  resolveLegacyPresentation,
  safeJsonParse
} from '@/lib/contentNode'
import { getEffectiveContentDomain, markDomainsCacheInvalidated } from '@/lib/domainCacheInvalidation'
import { contentTableHasDomainColumn } from '@/lib/contentListing'
import { requestOpenAiChatCompletion } from '@/lib/openaiClient'
import { resolveAiChatConfig } from '@/lib/ai/serverConfig'
import { DEFAULT_CONTENT_DOMAIN } from '@/lib/domainMode'

async function generateProductionSummary(body) {
  const aiConfig = await resolveAiChatConfig()
  if (!aiConfig.hasApiKey) return null

  const title = String(body?.title || body?.name || '').trim()
  if (!title) return null

  const attrs = safeJsonParse(body?.attributes, {})
  const company = typeof attrs?.company === 'string' ? attrs.company.trim() : ''
  const actors = Array.isArray(attrs?.actors)
    ? attrs.actors.map((actor) => String(actor || '').trim()).filter(Boolean).slice(0, 5)
    : []
  const producers = Array.isArray(attrs?.producers)
    ? attrs.producers.map((producer) => String(producer || '').trim()).filter(Boolean).slice(0, 5)
    : []

  const location = safeJsonParse(attrs?.location, {})
  const borough = typeof location?.borough === 'string' ? location.borough.trim() : ''
  const neighborhood = typeof location?.neighborhood === 'string' ? location.neighborhood.trim() : ''
  const area = typeof location?.area === 'string' ? location.area.trim() : ''

  const contextSummary = typeof body?.summary === 'string' ? body.summary.trim() : ''

  const prompt = [
    'Create a concise editorial summary for a production record.',
    '',
    `Title: ${title}`,
    `Company: ${company || 'unknown'}`,
    `Actors: ${actors.length > 0 ? actors.join(', ') : 'unknown'}`,
    `Producers: ${producers.length > 0 ? producers.join(', ') : 'unknown'}`,
    `Location: ${[neighborhood, area, borough].filter(Boolean).join(', ') || 'unknown'}`,
    `Existing context: ${contextSummary || 'none'}`,
    '',
    'Requirements:',
    '- Return plain text only (no markdown, no JSON).',
    '- 2 short paragraphs, 120-180 words total.',
    '- Professional CMS tone suitable for a Description field.',
    '- Mention production scope and practical filming context where possible.',
    '- Avoid unverifiable claims and fabricated specific dates.'
  ].join('\n')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 22000)

  try {
    const completion = await requestOpenAiChatCompletion({
      ...aiConfig,
      messages: [
        {
          role: 'system',
          content: 'You write clean CMS-ready summaries for film and TV production records.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      maxOutputTokens: 320,
      signal: controller.signal
    })

    if (!completion.ok) {
      console.warn(`${aiConfig.providerLabel} summary generation failed:`, completion.error || completion.status)
      return null
    }

    const text = String(completion.text || '')
      .replace(/\r\n/g, '\n')
      .replace(/^```[a-zA-Z]*\s*/g, '')
      .replace(/\s*```$/g, '')
      .trim()

    if (!text) return null
    return { text, model: aiConfig.model, provider: aiConfig.provider }
  } catch (error) {
    if (error?.name !== 'AbortError') {
      console.warn(`${aiConfig.providerLabel} summary generation request error:`, error?.message || error)
    }
    return null
  } finally {
    clearTimeout(timeout)
  }
}

const ALLOWED_FIELDS = [
  'type',
  'subtype',
  'domain',
  'slug',
  'title',
  'name',
  'summary',
  'body',
  'status',
  'published_at',
  'attributes',
  'metadata'
]

function serializeJson(value) {
  const parsed = safeJsonParse(value, {})
  return JSON.stringify(parsed)
}

function normalizeIncomingType(type) {
  return normalizeContentType(type)
}

function isPostType(type) {
  const normalized = normalizeIncomingType(type)
  return normalized === 'post'
}

function normalizeDomainToken(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return ''
  return normalized === 'core' ? DEFAULT_CONTENT_DOMAIN : normalized
}

function resolveContentDomainForWrite(payload) {
  const attributes = safeJsonParse(payload?.attributes, {})
  const metadata = safeJsonParse(payload?.metadata, {})
  const explicitDomain = normalizeDomainToken(payload?.domain || attributes?.domain || metadata?.domain)
  if (explicitDomain) return explicitDomain

  const type = normalizeIncomingType(payload?.type)
  return getPrivateContentTypeOwner(type) || DEFAULT_CONTENT_DOMAIN
}

function matchesDomainMode(row, domainMode) {
  const normalizedDomainMode = String(domainMode || '').trim().toLowerCase()
  if (!normalizedDomainMode) return true
  return getEffectiveContentDomain(row) === normalizedDomainMode
}

function buildSearchClause(dbType, term, paramIndex) {
  if (!term) return { clause: '', value: null }

  return {
    clause: `(
      title ILIKE $${paramIndex} OR
      summary ILIKE $${paramIndex} OR
      name ILIKE $${paramIndex} OR
      metadata::text ILIKE $${paramIndex} OR
      attributes::text ILIKE $${paramIndex}
    )`,
    value: `%${term}%`
  }
}

/**
 * GET /api/content?type=&subtype=&q=&limit=&offset=&location.borough=&location.neighborhood=&location.area=
 * POST /api/content
 * 
 * Location query examples:
 * - /api/content?type=production&location.borough=Brooklyn
 * - /api/content?type=production&location.neighborhood=Williamsburg
 * - /api/content?type=production&q=Brooklyn (searches all fields including attributes)
 */
export async function GET(request) {
  let connection
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')
    const normalizedType = normalizeIncomingType(type)
    const subtype = searchParams.get('subtype')
    const domain = searchParams.get('domain')
    const domainMode = searchParams.get('domainMode')
    const q = searchParams.get('q')
    const locationBorough = searchParams.get('location.borough')
    const locationNeighborhood = searchParams.get('location.neighborhood')
    const locationArea = searchParams.get('location.area')
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit'), 10) : 100
    const offset = searchParams.get('offset') ? parseInt(searchParams.get('offset'), 10) : 0

    if (!type && !q && !locationBorough && !locationNeighborhood && !locationArea) {
      return NextResponse.json(
        { success: false, error: 'type, q, or location parameter is required' },
        { status: 400 }
      )
    }

    const dbType = detectDatabaseType()
    if (dbType === 'mongodb') {
      return NextResponse.json(
        { success: false, error: 'MongoDB is not supported for this endpoint' },
        { status: 400 }
      )
    }

    connection = await getDomainBoundConnection(normalizeDomainToken(domain) || DEFAULT_CONTENT_DOMAIN)

    const hasDomainColumn = await contentTableHasDomainColumn(connection, dbType)
    const conditions = []
    const params = []

    if (normalizedType) {
      if (isPostType(normalizedType)) {
        conditions.push(`LOWER(type) IN ($${params.length + 1}, $${params.length + 2})`)
        params.push('post', 'article')
      } else {
        conditions.push(`type = $${params.length + 1}`)
        params.push(normalizedType)
      }
    }

    if (subtype) {
      conditions.push(`subtype = $${params.length + 1}`)
      params.push(subtype)
    }

    if (domain) {
      conditions.push(
        hasDomainColumn
          ? `LOWER(COALESCE(domain, attributes->>'domain', metadata->>'domain', '')) = LOWER($${params.length + 1})`
          : `LOWER(COALESCE(attributes->>'domain', metadata->>'domain', '')) = LOWER($${params.length + 1})`
      )
      params.push(domain)
    }

    if (q) {
      const { clause } = buildSearchClause(dbType, q, params.length + 1)
      if (clause) {
        conditions.push(clause)
        params.push(`%${q}%`)
      }
    }

    // Location attribute queries (PostgreSQL JSONB)
    if (dbType === 'postgresql') {
      if (locationBorough) {
        conditions.push(`attributes->>'location'->>'borough' = $${params.length + 1}`)
        params.push(locationBorough)
      }
      if (locationNeighborhood) {
        conditions.push(`attributes->>'location'->>'neighborhood' ILIKE $${params.length + 1}`)
        params.push(`%${locationNeighborhood}%`)
      }
      if (locationArea) {
        conditions.push(`attributes->>'location'->>'area' ILIKE $${params.length + 1}`)
        params.push(`%${locationArea}%`)
      }
    }

    let query = 'SELECT * FROM content'
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`
    }
    query += ' ORDER BY created_at DESC'

    query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
    params.push(limit, offset)

    const queryResult = await connection.query(query, params)
    const rows = queryResult.rows

    const content = (rows || [])
      .map(row => buildNodeResponse(row))
      .filter((row) => matchesDomainMode(row, domainMode))

    return NextResponse.json({
      success: true,
      content,
      count: content.length,
      type: normalizedType || null,
      subtype: subtype || null,
      domain: domain || null,
      domainMode: domainMode || null,
      q: q || null
    })
  } catch (error) {
    console.error('Error fetching content:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  } finally {
    if (connection?.end) {
      await connection.end().catch(() => { })
    }
  }
}

export async function POST(request) {
  let connection
  try {
    const body = await request.json()
    const dbType = detectDatabaseType()

    if (!body?.type) {
      return NextResponse.json(
        { success: false, error: 'type is required' },
        { status: 400 }
      )
    }

    const normalizedRequestType = normalizeIncomingType(body.type)
    body.type = normalizedRequestType

    if (dbType === 'mongodb') {
      return NextResponse.json(
        { success: false, error: 'MongoDB is not supported for this endpoint' },
        { status: 400 }
      )
    }

    // The row's domain is decided by the payload, so the session is bound to that
    // same value before the first statement — the insert policy checks it.
    const resolvedDomain = resolveContentDomainForWrite(body)
    connection = await getDomainBoundConnection(resolvedDomain)

    const titleToCheck = body.title ?? body.name ?? body?.metadata?.presentation?.default?.title ?? null
    if (normalizedRequestType === 'production' && titleToCheck) {
      const checkResult = await connection.query(
        `SELECT id FROM content
         WHERE type = $1
           AND (
             LOWER(COALESCE(metadata->'presentation'->'default'->>'title','')) = LOWER($2)
             OR LOWER(COALESCE(title,'')) = LOWER($2)
             OR LOWER(COALESCE(name,'')) = LOWER($2)
           )
         LIMIT 1`,
        ['production', titleToCheck]
      )
      const titleExists = checkResult.rows.length > 0

      if (titleExists) {
        return NextResponse.json(
          { success: false, error: 'A production with this title already exists.' },
          { status: 409 }
        )
      }
    }

    if (normalizedRequestType === 'location') {
      const candidateNeighborhoodAreaValues = [
        body?.attributes?.location?.neighborhood,
        body?.attributes?.neighborhood,
        body?.attributes?.location?.area,
        body?.attributes?.area
      ]
        .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
        .filter(Boolean)

      const candidateBoroughValues = [
        body?.attributes?.location?.borough,
        body?.attributes?.borough
      ]
        .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
        .filter(Boolean)

      const candidateNeighborhoodAreaSet = new Set(candidateNeighborhoodAreaValues)
      const candidateBoroughSet = new Set(candidateBoroughValues)
      const hasSpecificLocation = candidateNeighborhoodAreaSet.size > 0

      if (hasSpecificLocation || candidateBoroughSet.size > 0) {
        const locationResult = await connection.query(
          'SELECT id, title, name, attributes, metadata FROM content WHERE type = $1 LIMIT 5000',
          ['location']
        )
        const locationRows = locationResult.rows || []

        const existingLocation = locationRows.find((row) => {
          const attributes = safeJsonParse(row.attributes, {})
          const rowNeighborhoodAreaValues = [
            attributes?.location?.neighborhood,
            attributes?.neighborhood,
            attributes?.location?.area,
            attributes?.area
          ]
            .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
            .filter(Boolean)

          const rowBoroughValues = [
            attributes?.location?.borough,
            attributes?.borough
          ]
            .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
            .filter(Boolean)

          // Prefer specific location matching (neighborhood/area).
          // Borough-only dedupe is only used when no specific location was provided.
          if (hasSpecificLocation) {
            return rowNeighborhoodAreaValues.some((value) => candidateNeighborhoodAreaSet.has(value))
          }

          return rowBoroughValues.some((value) => candidateBoroughSet.has(value))
        })

        if (existingLocation) {
          const existingMetadata = safeJsonParse(existingLocation.metadata, {})
          const existingTitle =
            existingMetadata?.presentation?.default?.title ||
            existingLocation.title ||
            existingLocation.name ||
            'Location'

          return NextResponse.json(
            {
              success: false,
              error: `A location record already exists (${existingTitle}).`,
              existingId: existingLocation.id,
              existingTitle
            },
            { status: 409 }
          )
        }
      }
    }

    const hasProvidedSummary = typeof body?.summary === 'string' && body.summary.trim().length > 0

    if (normalizedRequestType === 'production' && !hasProvidedSummary) {
      const aiSummary = await generateProductionSummary(body)
      if (aiSummary) {
        body.summary = aiSummary.text
        const bodyMetadata = safeJsonParse(body.metadata, {})
        const presentation = safeJsonParse(bodyMetadata.presentation, {})
        const defaultPresentation = safeJsonParse(presentation.default, {})
        body.metadata = {
          ...bodyMetadata,
          presentation: {
            ...presentation,
            default: {
              ...defaultPresentation,
              summary: aiSummary.text
            }
          },
          ai_summary_generated: true,
          ai_summary_provider: aiSummary.provider,
          ai_summary_model: aiSummary.model,
          ai_summary_generated_at: new Date().toISOString()
        }
      }
    }

    const legacy = {
      title: body.title ?? null,
      name: body.name ?? null,
      summary: body.summary ?? null
    }

    const normalizedMetadataBase = normalizeMetadata(body.metadata, legacy)
    const normalizedMetadata = body.heading !== undefined
      ? {
        ...normalizedMetadataBase,
        presentation: {
          ...(normalizedMetadataBase.presentation || {}),
          default: {
            ...((normalizedMetadataBase.presentation || {}).default || {}),
            heading: body.heading
          }
        }
      }
      : normalizedMetadataBase
    const slugInfo = ensureSlug(normalizedMetadata, { title: body.title, name: body.name })

    // Make slug unique by appending timestamp if it already exists
    let finalSlug = body.slug ?? slugInfo.slug
    const slugCheckResult = await connection.query('SELECT id FROM content WHERE slug = $1 LIMIT 1', [finalSlug])

    if (slugCheckResult.rows.length > 0) {
      finalSlug = `${finalSlug}-${Date.now()}`
    }

    const payload = {
      ...body,
      slug: finalSlug,
      title: null,
      summary: null,
      name: null,
      attributes: body.attributes ?? {},
      metadata: slugInfo.metadata
    }

    const hasDomainColumn = await contentTableHasDomainColumn(connection, dbType)
    const columns = []
    const values = []

    if (hasDomainColumn) {
      const nextAttributes = safeJsonParse(payload.attributes, {})
      const nextMetadata = safeJsonParse(payload.metadata, {})
      if (!normalizeDomainToken(nextAttributes?.domain)) {
        nextAttributes.domain = resolvedDomain
      }
      if (!normalizeDomainToken(nextMetadata?.domain)) {
        nextMetadata.domain = resolvedDomain
      }

      payload.domain = resolvedDomain
      payload.attributes = nextAttributes
      payload.metadata = nextMetadata
    }

    ALLOWED_FIELDS.forEach(field => {
      if (payload[field] !== undefined) {
        columns.push(field)
        if (field === 'attributes' || field === 'metadata') {
          values.push(serializeJson(payload[field]))
        } else {
          values.push(payload[field])
        }
      }
    })

    if (!columns.includes('slug')) {
      columns.push('slug')
      values.push(payload.slug)
    }

    const nowIso = new Date().toISOString()
    if (!columns.includes('created_at')) {
      columns.push('created_at')
      values.push(nowIso)
    }
    if (!columns.includes('updated_at')) {
      columns.push('updated_at')
      values.push(nowIso)
    }

    const placeholders = columns.map((_, idx) => `$${idx + 1}`)
    const query = `INSERT INTO content (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`

    let row
    try {
      const result = await connection.query(query, values)
      row = result.rows[0]
    } catch (insertError) {
      const message = String(insertError?.message || '')
      const isNullIdConstraint =
        message.includes('null value in column "id"') ||
        (insertError?.code === '23502' && message.includes('column "id"'))

      if (!isNullIdConstraint) {
        throw insertError
      }

      const sequenceResult = await connection.query(
        `SELECT pg_get_serial_sequence('content', 'id') AS seq_name`
      )
      const sequenceName = sequenceResult.rows?.[0]?.seq_name

      let nextId
      if (sequenceName) {
        const nextValResult = await connection.query(
          `SELECT nextval($1) AS next_id`,
          [sequenceName]
        )
        nextId = nextValResult.rows?.[0]?.next_id
      } else {
        const maxResult = await connection.query(
          `SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM content`
        )
        nextId = maxResult.rows?.[0]?.next_id
      }

      const retryColumns = ['id', ...columns]
      const retryValues = [nextId, ...values]
      const retryPlaceholders = retryColumns.map((_, idx) => `$${idx + 1}`)
      const retryQuery = `INSERT INTO content (${retryColumns.join(', ')}) VALUES (${retryPlaceholders.join(', ')}) RETURNING *`

      const retryResult = await connection.query(retryQuery, retryValues)
      row = retryResult.rows[0]
    }

    const responseContent = buildNodeResponse(row)
    const responseDomain = getEffectiveContentDomain(row)
    await markDomainsCacheInvalidated([responseDomain]).catch((err) => {
      console.warn('Failed to update cache invalidation state:', err)
    })

    return NextResponse.json({
      success: true,
      content: responseContent,
      cacheInvalidatedDomains: [responseDomain]
    }, { status: 201 })
  } catch (error) {
    console.error('Error creating content:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  } finally {
    if (connection?.end) {
      await connection.end().catch(() => { })
    }
  }
}
