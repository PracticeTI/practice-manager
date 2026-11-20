import { NextResponse } from 'next/server'
import { getDatabaseConnection, detectDatabaseType } from '@/lib/database'
import { safeJsonParse } from '@/lib/contentNode'

/**
 * GET /api/relationships?source_id=&target_id=&type=
 */
export async function GET(request) {
  let connection
  try {
    const { searchParams } = new URL(request.url)
    const sourceId = searchParams.get('source_id')
    const targetId = searchParams.get('target_id')
    const type = searchParams.get('type')

    if (!sourceId && !targetId && !type) {
      return NextResponse.json(
        { success: false, error: 'source_id, target_id, or type is required' },
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

    connection = await getDatabaseConnection()

    const conditions = []
    const params = []

    if (sourceId) {
      conditions.push(`source_id = $${params.length + 1}`)
      params.push(sourceId)
    }

    if (targetId) {
      conditions.push(`target_id = $${params.length + 1}`)
      params.push(targetId)
    }

    if (type) {
      conditions.push(`relationship_type = $${params.length + 1}`)
      params.push(type)
    }

    let query = 'SELECT * FROM content_relationships'
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`
    }
    query += ' ORDER BY created_at DESC'

    const result = await connection.query(query, params)
    const rows = result.rows

    const relationships = (rows || []).map(row => ({
      id: row.id,
      source_id: row.source_id,
      target_id: row.target_id,
      type: row.relationship_type,
      attributes: safeJsonParse({ role: row.role ?? null, position: row.position ?? null }, {}),
      metadata: {}
    }))

    return NextResponse.json({
      success: true,
      relationships,
      count: relationships.length
    })
  } catch (error) {
    console.error('Error fetching relationships:', error)
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

/**
 * POST /api/relationships
 * Body: { source_id, target_id, type, role?, position? }
 */
export async function POST(request) {
  let connection
  try {
    const body = await request.json().catch(() => ({}))
    const sourceId = Number(body?.source_id)
    const targetId = Number(body?.target_id)
    const type = typeof body?.type === 'string' ? body.type.trim() : ''
    const role = typeof body?.role === 'string' ? body.role.trim() : null
    const position = Number.isFinite(Number(body?.position)) ? Number(body.position) : null

    if (!Number.isFinite(sourceId) || !Number.isFinite(targetId) || !type) {
      return NextResponse.json(
        { success: false, error: 'source_id, target_id, and type are required' },
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

    connection = await getDatabaseConnection()

    const checkQuery = 'SELECT id FROM content_relationships WHERE source_id = $1 AND target_id = $2 AND relationship_type = $3 LIMIT 1'

    const checkResult = await connection.query(checkQuery, [sourceId, targetId, type])
    const existingRow = checkResult.rows?.[0] || null

    if (existingRow) {
      return NextResponse.json({
        success: true,
        relationship: {
          id: existingRow.id,
          source_id: sourceId,
          target_id: targetId,
          type,
          attributes: { role, position }
        },
        reused: true
      })
    }

    const insertQuery = `INSERT INTO content_relationships (source_id, target_id, relationship_type, role, position)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`

    let row = null

    try {
      const result = await connection.query(insertQuery, [sourceId, targetId, type, role, position])
      row = result.rows?.[0]
    } catch (insertError) {
      const message = String(insertError?.message || '')
      const missingIdDefault = message.includes('null value in column "id"')
      const missingCreatedAtDefault = message.includes('null value in column "created_at"')

      if (!missingIdDefault && !missingCreatedAtDefault) {
        throw insertError
      }

      // Some local schemas require explicit id/created_at values for relationships.
      const fallbackInsertQuery = `
        WITH next_id AS (
          SELECT COALESCE(MAX(id), 0) + 1 AS id
          FROM content_relationships
        )
        INSERT INTO content_relationships (id, source_id, target_id, relationship_type, role, position, created_at)
        SELECT next_id.id, $1, $2, $3, $4, $5, NOW()
        FROM next_id
        RETURNING *
      `

      const fallbackResult = await connection.query(fallbackInsertQuery, [sourceId, targetId, type, role, position])
      row = fallbackResult.rows?.[0]
    }

    return NextResponse.json({
      success: true,
      relationship: {
        id: row?.id,
        source_id: row?.source_id,
        target_id: row?.target_id,
        type: row?.relationship_type,
        attributes: { role: row?.role ?? null, position: row?.position ?? null }
      },
      reused: false
    })
  } catch (error) {
    console.error('Error creating relationship:', error)
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

/**
 * DELETE /api/relationships
 * Body: { id }
 */
export async function DELETE(request) {
  let connection
  try {
    const body = await request.json().catch(() => ({}))
    const id = Number(body?.id)

    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json(
        { success: false, error: 'id is required' },
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

    connection = await getDatabaseConnection()

    const deleteQuery = 'DELETE FROM content_relationships WHERE id = $1 RETURNING id'

    const result = await connection.query(deleteQuery, [id])
    if (!result.rows?.length) {
      return NextResponse.json({ success: false, error: 'Relationship not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, deleted: id })
  } catch (error) {
    console.error('Error deleting relationship:', error)
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
