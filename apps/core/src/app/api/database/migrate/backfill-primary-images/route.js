import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { createRelationship, slugify } from '@/lib/contentRelationships'
import { normalizeMetadata, safeJsonParse } from '@/lib/contentNode'
import { requireOperatorAuth } from '@/lib/operatorRouteAuth'

function buildImageSlug(imageUrl, fallback) {
  if (!imageUrl) return slugify(fallback) || `image-${Date.now()}`
  try {
    const url = new URL(imageUrl)
    const parts = url.pathname.split('/').filter(Boolean)
    const name = parts[parts.length - 1] || imageUrl
    return slugify(name) || slugify(imageUrl)
  } catch (error) {
    return slugify(imageUrl) || slugify(fallback) || `image-${Date.now()}`
  }
}

async function relationshipExists(conn, sourceId) {
  const result = await conn.query(
    'SELECT 1 FROM content_relationships WHERE source_id = $1 AND relationship_type = $2 LIMIT 1',
    [sourceId, 'primary_image']
  )
  return result.rows.length > 0
}

async function createImageNode(conn, payload) {
  const columns = [
    'type',
    'subtype',
    'slug',
    'title',
    'name',
    'status',
    'image_url',
    'metadata',
    'attributes'
  ]

  const values = [
    payload.type,
    payload.subtype,
    payload.slug,
    payload.title,
    payload.name,
    payload.status,
    payload.image_url,
    JSON.stringify(payload.metadata),
    JSON.stringify(payload.attributes)
  ]

  const placeholders = columns.map((_, idx) => `$${idx + 1}`)

  const result = await conn.query(
    `INSERT INTO content (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`,
    values
  )
  return result.rows[0]?.id
}

/**
 * POST /api/database/migrate/backfill-primary-images
 * Backfill image nodes and primary_image relationships from legacy image_url
 */
export async function POST(request) {
    const auth = await requireOperatorAuth(request)
    if (auth.response) return auth.response
  let connection
  try {
    const body = await request.json().catch(() => ({}))
    const { dryRun = false, limit = null } = body

    const dbType = detectDatabaseType()
    if (dbType === 'mongodb') {
      return NextResponse.json(
        { success: false, error: 'MongoDB is not supported for this endpoint' },
        { status: 400 }
      )
    }

    connection = await getDatabaseConnection()

    let query = "SELECT id, title, name, image_url, source, metadata FROM content WHERE image_url IS NOT NULL AND image_url <> ''"
    if (limit) {
      query += ` LIMIT ${Number(limit)}`
    }

    const result = await connection.query(query)
    const rows = result.rows

    let created = 0
    let linked = 0
    const skipped = []

    for (const row of rows || []) {
      const hasRel = await relationshipExists(connection, row.id)
      if (hasRel) {
        skipped.push(row.id)
        continue
      }

      const baseTitle = row.title || row.name || 'Image'
      const slugBase = buildImageSlug(row.image_url, baseTitle)
      const slug = `${slugBase}-${row.id}`

      const legacyMetadata = safeJsonParse(row.metadata, {})
      const imageMetadata = normalizeMetadata({
        source_url: row.image_url,
        source: row.source || null,
        presentation: {
          default: {
            title: baseTitle,
            image_url: row.image_url
          }
        },
        linked_from: row.id,
        parent_metadata: legacyMetadata
      }, {})

      const imageAttributes = {
        source_url: row.image_url,
        source: row.source || null
      }

      if (!dryRun) {
        const imageId = await createImageNode(connection, {
          type: 'image',
          subtype: 'photo',
          slug,
          title: baseTitle,
          name: baseTitle,
          status: 'published',
          image_url: row.image_url,
          metadata: imageMetadata,
          attributes: imageAttributes
        })

        await createRelationship(connection, dbType, row.id, imageId, 'primary_image', { position: 1 })
      }

      created += 1
      linked += 1
    }

    return NextResponse.json({
      success: true,
      dryRun,
      created,
      linked,
      skipped
    })
  } catch (error) {
    console.error('Error backfilling primary images:', error)
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
