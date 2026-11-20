import { NextResponse } from 'next/server'
import { buildPgClientConfig } from '@/lib/pgClientConfig'
import { requireAdminAuth, requireOperatorAuth } from '@/lib/operatorRouteAuth'
import { isSuperAdmin } from '@/lib/auth'
import { DEFAULT_CONTENT_DOMAIN } from '@/lib/domainMode'
import { applySessionRlsContext, applySuperAdminSessionContext } from '@/lib/postgresRlsContext'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
  'Access-Control-Allow-Headers': 'Content-Type',
}

/**
 * `system_settings` is global state rather than tenant data, but the session still
 * has to carry a scope: the runtime role's policy expects one. Prefer the admin's
 * own domain, fall back to a superadmin session for a caller that has none.
 */
async function bindRlsSession(client, user) {
    const domain = String(user?.domain || '').trim().toLowerCase()
    if (domain) {
        await applySessionRlsContext(client, { domain })
        return
    }
    if (isSuperAdmin(user)) {
        await applySuperAdminSessionContext(client)
        return
    }
    await applySessionRlsContext(client, { domain: DEFAULT_CONTENT_DOMAIN })
}

function detectDatabaseType(url) {
  if (!url) return null
  if (url.startsWith('postgresql://') || url.startsWith('postgres://')) return 'postgresql'
  if (url.startsWith('mongodb://') || url.startsWith('mongodb+srv://')) return 'mongodb'
  return null
}

function safeParse(value) {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch (e) {
      return value
    }
  }
  return value
}

/**
 * GET /api/database/search-query - Load stored custom search query
 * POST /api/database/search-query - Save custom search query
 * DELETE /api/database/search-query - Clear stored search query
 */

export async function GET(request) {
    const auth = await requireAdminAuth(request)
    if (auth.response) return auth.response
  try {
    const connectionUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL
    const dbType = detectDatabaseType(connectionUrl)

    if (!dbType) {
      return NextResponse.json(
        { neighborhood: '', query: '' },
        { headers: corsHeaders }
      )
    }

    let value = null

    if (dbType === 'postgresql') {
      const { Client } = await import('pg')
      const client = new Client(buildPgClientConfig(connectionUrl, { statement_timeout: 5000 }))
      await client.connect()
      await bindRlsSession(client, auth.user)
      const result = await client.query(
        "SELECT value FROM system_settings WHERE key = 'search_query_state' LIMIT 1"
      )
      await client.end()
      if (result.rows.length > 0) {
        value = safeParse(result.rows[0].value)
      }
    } else if (dbType === 'mongodb') {
      const { MongoClient } = await import('mongodb')
      const client = new MongoClient(connectionUrl)
      await client.connect()
      const db = client.db()
      const doc = await db.collection('system_state').findOne({ key: 'search_query_state' })
      await client.close()
      if (doc && doc.value) {
        value = safeParse(doc.value)
      }
    }

    if (value) {
      return NextResponse.json(value, { headers: corsHeaders })
    }

    return NextResponse.json({ neighborhood: '', query: '' }, { headers: corsHeaders })
  } catch (error) {
    console.error('Error loading search query:', error)
    return NextResponse.json(
      { neighborhood: '', query: '' },
      { headers: corsHeaders }
    )
  }
}

export async function POST(request) {
    const auth = await requireAdminAuth(request)
    if (auth.response) return auth.response
  try {
    const body = await request.json()
    const { neighborhood = '', query = '' } = body

    const connectionUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL
    const dbType = detectDatabaseType(connectionUrl)

    if (!dbType) {
      return NextResponse.json(
        { success: false, error: 'Database not configured' },
        { status: 400, headers: corsHeaders }
      )
    }

    const queryData = JSON.stringify({ neighborhood, query })

    if (dbType === 'postgresql') {
      const { Client } = await import('pg')
      const client = new Client(buildPgClientConfig(connectionUrl, { statement_timeout: 5000 }))
      await client.connect()
      await bindRlsSession(client, auth.user)

      // Try update first
      const updateResult = await client.query(
        "UPDATE system_settings SET value = $1, updated_at = NOW() WHERE key = 'search_query_state'"
        , [queryData])

      if (updateResult.rowCount === 0) {
        // Insert if no rows updated
        await client.query(
          "INSERT INTO system_settings (key, value) VALUES ('search_query_state', $1) ON CONFLICT (key) DO NOTHING",
          [queryData]
        )
      }
      await client.end()
    } else if (dbType === 'mongodb') {
      const { MongoClient } = await import('mongodb')
      const client = new MongoClient(connectionUrl)
      await client.connect()
      const db = client.db()
      const parsedData = { neighborhood, query }
      await db.collection('system_state').updateOne(
        { key: 'search_query_state' },
        { $set: { value: queryData, key: 'search_query_state' } },
        { upsert: true }
      )
      await client.close()
    }

    return NextResponse.json(
      { success: true, message: 'Search query saved' },
      { headers: corsHeaders }
    )
  } catch (error) {
    console.error('Error saving search query:', error)
    return NextResponse.json(
      { error: 'Failed to save search query', details: error.message },
      { status: 500, headers: corsHeaders }
    )
  }
}

export async function DELETE(request) {
    const auth = await requireAdminAuth(request)
    if (auth.response) return auth.response
  try {
    const connectionUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL
    const dbType = detectDatabaseType(connectionUrl)

    if (!dbType) {
      return NextResponse.json(
        { success: false, error: 'Database not configured' },
        { status: 400, headers: corsHeaders }
      )
    }

    if (dbType === 'postgresql') {
      const { Client } = await import('pg')
      const client = new Client(buildPgClientConfig(connectionUrl, { statement_timeout: 5000 }))
      await client.connect()
      await bindRlsSession(client, auth.user)
      await client.query("DELETE FROM system_settings WHERE key = 'search_query_state'")
      await client.end()
    } else if (dbType === 'mongodb') {
      const { MongoClient } = await import('mongodb')
      const client = new MongoClient(connectionUrl)
      await client.connect()
      const db = client.db()
      await db.collection('system_state').deleteOne({ key: 'search_query_state' })
      await client.close()
    }

    return NextResponse.json(
      { success: true, message: 'Search query cleared' },
      { headers: corsHeaders }
    )
  } catch (error) {
    console.error('Error clearing search query:', error)
    return NextResponse.json(
      { error: 'Failed to clear search query', details: error.message },
      { status: 500, headers: corsHeaders }
    )
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders,
  })
}
