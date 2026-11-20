import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { requireOperatorAuth } from '@/lib/operatorRouteAuth'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

export async function POST(request) {
    const auth = await requireOperatorAuth(request)
    if (auth.response) return auth.response
  const dbType = detectDatabaseType()
  if (dbType !== 'postgresql') {
    return NextResponse.json({ success: false, error: 'Relational database (PostgreSQL) is required' }, { status: 400, headers: corsHeaders })
  }

  let connection
  try {
    connection = await getDatabaseConnection()

    const cache = await loadProductionsCache(connection, dbType)
    if (!cache) {
      return NextResponse.json({ success: false, error: 'No productions_cache found in system_settings' }, { status: 404, headers: corsHeaders })
    }

    const actorCount = cache.actorImages ? Object.keys(cache.actorImages).length : 0
    const companyCount = cache.companyImages ? Object.keys(cache.companyImages).length : 0

    await upsertContentRecord(connection, dbType, cache)

    return NextResponse.json({
      success: true,
      message: 'Productions cache migrated into content table',
      stats: { actorImages: actorCount, companyImages: companyCount }
    }, { headers: corsHeaders })
  } catch (error) {
    console.error('Error migrating productions cache:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500, headers: corsHeaders })
  } finally {
    if (connection) {
      if (dbType === 'postgresql') {
        await connection.end()
      }
    }
  }
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders })
}

function parseMaybeJson(value) {
  if (value == null) return null
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value)
  } catch (_) {
    return null
  }
}

async function loadProductionsCache(connection, dbType) {
  if (dbType === 'postgresql') {
    const result = await connection.query('SELECT value FROM system_settings WHERE key = $1 LIMIT 1', ['productions_cache'])
    if (result.rows.length === 0) return null
    return parseMaybeJson(result.rows[0].value)
  }

  return null
}

async function upsertContentRecord(connection, dbType, cache) {
  const attributes = {
    actorImages: cache.actorImages || {},
    companyImages: cache.companyImages || {}
  }
  const metadata = {
    migratedFrom: 'system_settings.productions_cache',
    migratedAt: new Date().toISOString()
  }

  if (dbType === 'postgresql') {
    await connection.query(
      `INSERT INTO content (
        type, slug, title, summary, body, status, published_at, image_url, external_id, source, language, country,
        released_on, runtime_minutes, rating, tags, attributes, metadata, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, NULL, 'published', NOW(), NULL, NULL, $5, 'en', NULL,
        NULL, NULL, NULL, NULL, $6, $7, NOW(), NOW()
      )
      ON CONFLICT (type, slug) DO UPDATE
      SET title = EXCLUDED.title,
          summary = EXCLUDED.summary,
          attributes = EXCLUDED.attributes,
          metadata = EXCLUDED.metadata,
          source = EXCLUDED.source,
          status = EXCLUDED.status,
          published_at = EXCLUDED.published_at,
          updated_at = NOW()`,
      [
        'production',
        'productions-cache',
        'Productions Cache',
        'Cached actor/company images',
        'system',
        attributes,
        metadata
      ]
    )
    return
  }
}
