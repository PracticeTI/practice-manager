import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { applySessionRlsContext } from '@/lib/postgresRlsContext'
import { getPrivateContentTypeOwner } from '@/lib/domainExtension'
import {
  buildNodeResponse,
  ensureSlug,
  mergeMetadata,
  normalizeContentType,
  resolveLegacyPresentation,
  safeJsonParse
} from '@/lib/contentNode'
import { getEffectiveContentDomain, markDomainsCacheInvalidated } from '@/lib/domainCacheInvalidation'
import { contentTableHasDomainColumn } from '@/lib/contentListing'
import { DEFAULT_CONTENT_DOMAIN } from '@/lib/domainMode'

const UPDATABLE_FIELDS = [
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

  const type = normalizeContentType(payload?.type)
  return getPrivateContentTypeOwner(type) || DEFAULT_CONTENT_DOMAIN
}

function buildIncomingMetadataPatch(metadata, body) {
  const nextMetadata = safeJsonParse(metadata, {})
  const nextPresentation = typeof nextMetadata.presentation === 'object' && nextMetadata.presentation !== null
    ? nextMetadata.presentation
    : {}
  const nextDefaultPresentation = typeof nextPresentation.default === 'object' && nextPresentation.default !== null
    ? nextPresentation.default
    : {}

  const patchedDefaultPresentation = {
    ...nextDefaultPresentation,
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.title === undefined && body.name !== undefined ? { title: body.name } : {}),
    ...(body.summary !== undefined ? { summary: body.summary } : {}),
    ...(body.heading !== undefined ? { heading: body.heading } : {})
  }

  const patchedMetadata = {
    ...nextMetadata,
    ...(body.slug !== undefined ? { slug: body.slug } : {}),
    presentation: {
      ...nextPresentation,
      default: patchedDefaultPresentation
    }
  }

  return patchedMetadata
}

/**
 * The domain to bind the session to before the first statement: the payload's own
 * domain when it names one, else the request's `domain` param, else the type's
 * owner, else the default content domain.
 */
function resolveSessionDomain(request, body) {
  const payloadDomain = normalizeDomainToken(
    body?.domain
    || safeJsonParse(body?.attributes, {})?.domain
    || safeJsonParse(body?.metadata, {})?.domain
  )
  if (payloadDomain) return payloadDomain

  const requestedDomain = normalizeDomainToken(new URL(request.url).searchParams.get('domain'))
  if (requestedDomain) return requestedDomain

  return getPrivateContentTypeOwner(normalizeContentType(body?.type)) || DEFAULT_CONTENT_DOMAIN
}

async function getContentById(connection, id) {
  const result = await connection.query('SELECT * FROM content WHERE id = $1', [id])
  return result.rows[0] || null
}

async function getRelationships(connection, id) {
  const result = await connection.query(
    'SELECT * FROM content_relationships WHERE source_id = $1 ORDER BY position',
    [id]
  )
  return result.rows
}

/**
 * GET /api/content/:id
 * PATCH /api/content/:id
 */
export async function GET(request, context) {
  let connection
  try {
    const params = await Promise.resolve(context?.params)
    const id = params?.id
    const dbType = detectDatabaseType()
    if (dbType === 'mongodb') {
      return NextResponse.json(
        { success: false, error: 'MongoDB is not supported for this endpoint' },
        { status: 400 }
      )
    }

    connection = await getDomainBoundConnection(resolveSessionDomain(request, null))
    const row = await getContentById(connection, id)

    if (!row) {
      return NextResponse.json(
        { success: false, error: 'Content not found' },
        { status: 404 }
      )
    }

    const relationships = await getRelationships(connection, id)
    const formattedRelationships = (relationships || []).map(rel => ({
      type: rel.relationship_type,
      target_id: rel.target_id,
      direction: 'out',
      role: rel.role ?? null,
      position: rel.position ?? null
    }))

    return NextResponse.json({
      success: true,
      content: buildNodeResponse(row, formattedRelationships)
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

export async function PATCH(request, context) {
  let connection
  try {
    const body = await request.json()
    const params = await Promise.resolve(context?.params)
    const id = params?.id
    const dbType = detectDatabaseType()

    if (dbType === 'mongodb') {
      return NextResponse.json(
        { success: false, error: 'MongoDB is not supported for this endpoint' },
        { status: 400 }
      )
    }

    connection = await getDomainBoundConnection(resolveSessionDomain(request, body))

    const existing = await getContentById(connection, id)
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Content not found' },
        { status: 404 }
      )
    }

    // A row may carry its domain only in the `domain` column, so rebind to the row
    // itself before the update: the write policy checks the row's own tenant.
    const rowDomain = getEffectiveContentDomain(existing)
    if (rowDomain) await applySessionRlsContext(connection, { domain: rowDomain })

    const normalizedBodyType = body.type ? normalizeContentType(body.type) : null
    if (normalizedBodyType) {
      body.type = normalizedBodyType
    }

    const titleToCheck = body.title ?? body.name ?? body?.metadata?.presentation?.default?.title ?? null
    const effectiveType = normalizedBodyType ?? normalizeContentType(existing.type)
    if (effectiveType === 'production' && titleToCheck) {
      const checkTitleQuery = `SELECT id FROM content
           WHERE type = $1
             AND id <> $2
             AND (
               LOWER(COALESCE(metadata->'presentation'->'default'->>'title','')) = LOWER($3)
               OR LOWER(COALESCE(title,'')) = LOWER($3)
               OR LOWER(COALESCE(name,'')) = LOWER($3)
             )
           LIMIT 1`

      const checkResult = await connection.query(checkTitleQuery, ['production', id, titleToCheck])
      const titleExists = checkResult.rows.length > 0

      if (titleExists) {
        return NextResponse.json(
          { success: false, error: 'A production with this title already exists.' },
          { status: 409 }
        )
      }
    }

    const legacy = {
      title: body.title ?? existing.title ?? null,
      name: body.name ?? existing.name ?? null,
      summary: body.summary ?? existing.summary ?? null
    }

    const mergedMetadata = mergeMetadata(existing.metadata, buildIncomingMetadataPatch(body.metadata, body), legacy)
    const slugInfo = ensureSlug(mergedMetadata, { title: legacy.title, name: legacy.name })
    const nextMetadata = body.slug !== undefined
      ? { ...slugInfo.metadata, slug: body.slug }
      : slugInfo.metadata

    const updatePayload = {
      ...body,
      slug: body.slug ?? slugInfo.slug,
      title: null,
      summary: null,
      name: null,
      attributes: body.attributes ?? existing.attributes ?? {},
      metadata: nextMetadata
    }

    const hasDomainColumn = await contentTableHasDomainColumn(connection)
    if (hasDomainColumn) {
      const resolvedDomain = resolveContentDomainForWrite({
        ...existing,
        ...updatePayload,
      })

      const nextAttributes = safeJsonParse(updatePayload.attributes, {})
      const nextMetadataWithDomain = safeJsonParse(updatePayload.metadata, {})
      if (!normalizeDomainToken(nextAttributes?.domain)) {
        nextAttributes.domain = resolvedDomain
      }
      if (!normalizeDomainToken(nextMetadataWithDomain?.domain)) {
        nextMetadataWithDomain.domain = resolvedDomain
      }

      updatePayload.domain = resolvedDomain
      updatePayload.attributes = nextAttributes
      updatePayload.metadata = nextMetadataWithDomain
    }

    const updates = []
    const values = []

    UPDATABLE_FIELDS.forEach(field => {
      if (updatePayload[field] !== undefined) {
        updates.push(`${field} = $${values.length + 1}`)
        if (field === 'attributes' || field === 'metadata') {
          values.push(serializeJson(updatePayload[field]))
        } else {
          values.push(updatePayload[field])
        }
      }
    })

    updates.push(`updated_at = $${values.length + 1}`)
    values.push(new Date().toISOString())

    const whereClause = `id = $${values.length + 1}`
    values.push(id)

    const query = `UPDATE content SET ${updates.join(', ')} WHERE ${whereClause}`

    await connection.query(query, values)

    const updated = await getContentById(connection, id)
    const existingDomain = getEffectiveContentDomain(existing)
    const updatedDomain = getEffectiveContentDomain(updated)
    await markDomainsCacheInvalidated([existingDomain, updatedDomain]).catch((err) => {
      console.warn('Failed to update cache invalidation state:', err)
    })

    return NextResponse.json({
      success: true,
      content: buildNodeResponse(updated),
      cacheInvalidatedDomains: Array.from(new Set([existingDomain, updatedDomain]))
    })
  } catch (error) {
    console.error('Error updating content:', error)
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

export async function DELETE(request, context) {
  let connection
  try {
    const params = await Promise.resolve(context?.params)
    const id = params?.id
    const dbType = detectDatabaseType()
    if (dbType === 'mongodb') {
      return NextResponse.json(
        { success: false, error: 'MongoDB is not supported for this endpoint' },
        { status: 400 }
      )
    }

    connection = await getDomainBoundConnection(resolveSessionDomain(request, null))

    const existing = await getContentById(connection, id)
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Content not found' },
        { status: 404 }
      )
    }

    const rowDomain = getEffectiveContentDomain(existing)
    if (rowDomain) await applySessionRlsContext(connection, { domain: rowDomain })

    // Delete relationships first
    await connection.query(
      'DELETE FROM content_relationships WHERE source_id = $1 OR target_id = $1',
      [id]
    )

    // Delete the content
    await connection.query('DELETE FROM content WHERE id = $1', [id])

    const existingDomain = getEffectiveContentDomain(existing)
    await markDomainsCacheInvalidated([existingDomain]).catch((err) => {
      console.warn('Failed to update cache invalidation state:', err)
    })

    return NextResponse.json({
      success: true,
      message: 'Content deleted successfully',
      cacheInvalidatedDomains: [existingDomain]
    })
  } catch (error) {
    console.error('Error deleting content:', error)
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
