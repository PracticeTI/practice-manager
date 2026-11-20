import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { resolveDomainModeFromHeaders } from '@/lib/domainMode'

/**
 * Get content items by type and optional subtype
 * GET /api/database/content?type=image&subtype=photo
 * GET /api/database/content?type=info
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')
    const subtype = searchParams.get('subtype')
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')) : 100

    if (!type) {
      return NextResponse.json(
        { success: false, error: 'type parameter is required' },
        { status: 400 }
      )
    }

    // No tenant filter of its own: the domain comes from `?domain=` or the
    // hostname, so the session is bound before the content read.
    const requestedDomain = String(searchParams.get('domain') || '').trim().toLowerCase()
    const domain = requestedDomain || resolveDomainModeFromHeaders(request.headers)
    const connection = await getDomainBoundConnection(domain)

    if (!connection) {
      return NextResponse.json(
        { success: false, error: 'Could not connect to database' },
        { status: 500 }
      )
    }

    const dbType = detectDatabaseType()
    let query = 'SELECT * FROM content WHERE type = $1'
    const params = [type]

    if (subtype) {
      query += ' AND subtype = $2'
      params.push(subtype)
    }

    query += ' ORDER BY created_at DESC'

    if (limit) {
      query += ` LIMIT ${limit}`
    }

    let result
    if (dbType === 'postgresql') {
      const pgResult = await connection.query(query, params)
      result = pgResult.rows
    } else if (dbType === 'mongodb') {
      // MongoDB query
      const db = connection.db()
      const filter = { type }
      if (subtype) {
        filter.subtype = subtype
      }
      result = await db
        .collection('content')
        .find(filter)
        .sort({ created_at: -1 })
        .limit(limit)
        .toArray()
    }

    return NextResponse.json({
      success: true,
      content: result || [],
      count: result?.length || 0,
      type,
      subtype: subtype || null
    })
  } catch (error) {
    console.error('Error fetching content:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
