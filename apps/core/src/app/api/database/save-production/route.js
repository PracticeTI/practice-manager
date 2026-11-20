import { NextResponse } from 'next/server'
import { getDatabaseConnection } from '@/lib/database'
import { upsertContent, createRelationship, findContentBySlug, slugify } from '@/lib/contentRelationships'

/**
 * Detect database type from environment variables
 */
function detectDatabaseType() {
  const primaryUrl = process.env.DATABASE_URL_PRIMARY || process.env.DATABASE_URL || ''

  if (primaryUrl.includes('postgres')) return 'PostgreSQL'
  if (primaryUrl.includes('mongodb')) return 'MongoDB'

  return 'Unknown'
}

/**
 * Save a production to the content table
 * POST /api/database/save-production
 */
export async function POST(request) {
  try {
    const body = await request.json()
    const { title, name, description, sources, date, neighborhood, search_query, actor1, actor2, actor3, company } = body

    const productionName = name || title
    if (!productionName) {
      return NextResponse.json(
        { success: false, error: 'Name/Title is required' },
        { status: 400 }
      )
    }

    const dbType = detectDatabaseType()
    const normalizedDbType = dbType?.toLowerCase()

    console.log('Saving production:', { productionName, dbType: normalizedDbType })

    const connection = await getDatabaseConnection()

    if (!connection) {
      console.error('Database connection not available')
      return NextResponse.json(
        { success: false, error: 'Database connection not available' },
        { status: 500 }
      )
    }

    // Clean name by removing repeated "Title:" or "Name:" prefixes
    let cleanName = productionName
    // Remove any "Title: " or "Name: " prefixes (case insensitive, multiple occurrences)
    cleanName = cleanName.replace(/^(title|name):\s*/gi, '').trim()

    // Prepare slug for storage in metadata
    const slug = slugify(cleanName)

    // Prepare metadata with sources and description
    const metadata = {
      slug,
      search_query: search_query || '',
      date: date || '',
      sources: sources || [],
      summary: description || '',
      imported_at: new Date().toISOString()
    }

    // Insert production using helper
    const productionId = await upsertContent(connection, normalizedDbType, {
      type: 'production',
      name: cleanName,
      status: 'test',
      metadata,
      neighborhood: neighborhood || null,
      borough: null,
      area: null
    })

    console.log('Production saved with ID:', productionId)

    // Handle actors if provided (create relationships)
    const actors = [actor1, actor2, actor3].filter(Boolean)
    for (let i = 0; i < actors.length; i++) {
      const actorName = actors[i]

      // Check if actor exists, if not create
      let actor = await findContentBySlug(connection, normalizedDbType, 'actor', actorName)
      if (!actor) {
        const actorId = await upsertContent(connection, normalizedDbType, {
          type: 'actor',
          name: actorName,
          status: 'draft',
          metadata: { imported_at: new Date().toISOString() }
        })
        actor = { id: actorId }
      }

      // Create relationship
      await createRelationship(connection, normalizedDbType, productionId, actor.id, 'cast', { position: i + 1, role: actorName })
    }

    // Handle company if provided
    if (company) {
      let companyObj = await findContentBySlug(connection, normalizedDbType, 'company', company)
      if (!companyObj) {
        const companyId = await upsertContent(connection, normalizedDbType, {
          type: 'company',
          name: company,
          status: 'draft',
          metadata: { imported_at: new Date().toISOString() }
        })
        companyObj = { id: companyId }
      }

      await createRelationship(connection, normalizedDbType, productionId, companyObj.id, 'production_company', { position: 1 })
    }

    // Close connection
    await connection.end()

    return NextResponse.json({
      success: true,
      message: 'Production saved successfully',
      slug,
      id: productionId
    })
  } catch (error) {
    console.error('Error saving production:', error)
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code
    })
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to save production' },
      { status: 500 }
    )
  }
}

export async function OPTIONS() {
  return NextResponse.json({}, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  })
}
