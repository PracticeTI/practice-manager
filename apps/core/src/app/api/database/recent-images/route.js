import { pool } from '@/lib/database'
import { detectDatabaseType } from '@/lib/database'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { getScopedImageStateKey, normalizeImageDomain } from '@/lib/imageDomains'

/**
 * Ensure the settings table exists
 */
async function ensureTableExists(connection, dbType) {
  const normalizedDbType = dbType?.toLowerCase()

  try {
    if (normalizedDbType === 'postgresql') {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS system_settings (
          id SERIAL PRIMARY KEY,
          key VARCHAR(255) NOT NULL UNIQUE,
          value TEXT NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `)
    }
  } catch (error) {
    console.error('Error creating system_settings table:', error)
  }
}

export async function GET(request) {
  let connection = null
  try {
    const { searchParams } = new URL(request.url)
    const domain = normalizeImageDomain(searchParams.get('domain'))
    const stateKey = getScopedImageStateKey('recent_image_batch', domain)
    const dbType = detectDatabaseType()
    const normalizedDbType = dbType?.toLowerCase()
    // `system_settings` is global, but the row key is domain-scoped, so bind the
    // request's domain rather than reading it through an unset session.
    connection = await getDomainBoundConnection(domain)

    if (!connection) {
      return Response.json({ images: [], searchPhrase: '', provider: 'google' })
    }

    // Ensure table exists
    await ensureTableExists(connection, dbType)

    let stateRow = null
    if (normalizedDbType === 'postgresql') {
      const result = await connection.query(
        'SELECT * FROM "system_settings" WHERE "key" = $1',
        [stateKey]
      )
      stateRow = result.rows[0]
    }

    if (!stateRow) {
      return Response.json({ images: [], searchPhrase: '', provider: 'google' })
    }

    let batch = {}
    try {
      batch = typeof stateRow.value === 'string' ? JSON.parse(stateRow.value) : (stateRow.value || {})
    } catch (e) {
      batch = {}
    }

    return Response.json({
      images: Array.isArray(batch.images) ? batch.images : [],
      searchPhrase: batch.searchPhrase || '',
      provider: batch.provider || 'google',
      createdAt: stateRow.updated_at || stateRow.created_at,
      domain
    })
  } catch (error) {
    console.error('Error fetching recent images:', error)
    return Response.json({ images: [], searchPhrase: '', provider: 'google' })
  } finally {
    if (connection) {
      try {
        await connection.end()
      } catch (e) {
        console.error('Error closing connection:', e)
      }
    }
  }
}

export async function POST(request) {
  let connection = null
  try {
    const { images, searchPhrase, provider, domain } = await request.json()
    const normalizedDomain = normalizeImageDomain(domain)
    const stateKey = getScopedImageStateKey('recent_image_batch', normalizedDomain)

    if (!Array.isArray(images)) {
      return Response.json({ success: true })
    }

    const dbType = detectDatabaseType()
    const normalizedDbType = dbType?.toLowerCase()
    connection = await getDomainBoundConnection(normalizedDomain)

    if (!connection) {
      return Response.json({ success: true })
    }

    // Ensure table exists
    await ensureTableExists(connection, dbType)

    // Prepare the value object
    const valueObject = {
      images: Array.isArray(images) ? images : [],
      searchPhrase: searchPhrase || '',
      provider: provider || 'google'
    }
    const valueJson = JSON.stringify(valueObject)

    try {
      // Insert or update the state row
      if (normalizedDbType === 'postgresql') {
        await connection.query(
          'INSERT INTO "system_settings" ("key", "value", "created_at", "updated_at") VALUES ($1, $2, NOW(), NOW()) ON CONFLICT ("key") DO UPDATE SET "value" = $2, "updated_at" = NOW()',
          [stateKey, valueJson]
        )
      }
    } catch (dbError) {
      console.error('Database error:', dbError)
    }

    return Response.json({ success: true })
  } catch (error) {
    console.error('Error saving recent images:', error)
    return Response.json({ success: true })
  } finally {
    if (connection) {
      try {
        await connection.end()
      } catch (e) {
        console.error('Error closing connection:', e)
      }
    }
  }
}
