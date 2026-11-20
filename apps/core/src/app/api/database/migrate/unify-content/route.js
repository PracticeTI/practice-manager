import { NextResponse } from 'next/server'
import { getDatabaseConnection } from '@/lib/database'
import { requireOperatorAuth } from '@/lib/operatorRouteAuth'

/**
 * Migrate data from content_productions, content_actors, content_companies to unified content table
 * POST /api/database/migrate/unify-content
 */
export async function POST(request) {
    const auth = await requireOperatorAuth(request)
    if (auth.response) return auth.response
  let conn = null

  try {
    const body = await request.json().catch(() => ({}))
    const { dryRun = false } = body

    conn = await getDatabaseConnection()

    const results = {
      dryRun,
      productions: { migrated: 0, relationships: 0 },
      actors: { migrated: 0 },
      companies: { migrated: 0 },
      posts: { migrated: 0 },
      errors: []
    }

    console.log(`Starting migration (dry run: ${dryRun})...`)

    // Helper function to slugify
    function slugify(str) {
      return str
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
    }

    // 1. Migrate actors
    console.log('Migrating actors...')
    try {
      const actorRows = (await conn.query('SELECT * FROM content_actors')).rows

      for (const actor of actorRows) {
        const insertData = {
          type: 'actor',
          slug: actor.slug,
          name: actor.name,
          body: actor.bio || null,
          image_url: actor.image_url || null,
          external_id: actor.external_id || null,
          source: actor.source || null,
          date_primary: actor.dob || null,
          nationality: actor.nationality || null,
          tags: actor.tags || '{}',
          attributes: actor.attributes || '{}',
          metadata: actor.metadata || '{}',
          verified: actor.verified || false,
          test: actor.test || false,
          created_at: actor.created_at,
          updated_at: actor.updated_at
        }

        if (!dryRun) {
          await conn.query(`
            INSERT INTO content (type, slug, name, body, image_url, external_id, source,
              date_primary, nationality, tags, attributes, metadata, verified, test, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            ON CONFLICT (type, slug) DO UPDATE SET
              name = EXCLUDED.name,
              body = EXCLUDED.body,
              image_url = EXCLUDED.image_url,
              updated_at = EXCLUDED.updated_at
          `, [
            insertData.type, insertData.slug, insertData.name, insertData.body,
            insertData.image_url, insertData.external_id, insertData.source,
            insertData.date_primary, insertData.nationality, insertData.tags,
            insertData.attributes, insertData.metadata, insertData.verified,
            insertData.test, insertData.created_at, insertData.updated_at
          ])
        }
        results.actors.migrated++
      }
      console.log(`Migrated ${results.actors.migrated} actors`)
    } catch (error) {
      console.error('Error migrating actors:', error)
      results.errors.push(`Actors: ${error.message}`)
    }

    // 2. Migrate companies
    console.log('Migrating companies...')
    try {
      const companyRows = (await conn.query('SELECT * FROM content_companies')).rows

      for (const company of companyRows) {
        const insertData = {
          type: 'company',
          slug: company.slug,
          name: company.name,
          body: company.description || null,
          image_url: company.image_url || null,
          website: company.website || null,
          external_id: company.external_id || null,
          source: company.source || null,
          country: company.country || null,
          date_primary: company.founded_on || null,
          tags: company.tags || '{}',
          attributes: company.attributes || '{}',
          metadata: company.metadata || '{}',
          verified: company.verified || false,
          test: company.test || false,
          created_at: company.created_at,
          updated_at: company.updated_at
        }

        if (!dryRun) {
          await conn.query(`
            INSERT INTO content (type, slug, name, body, image_url, website, external_id, source,
              country, date_primary, tags, attributes, metadata, verified, test, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
            ON CONFLICT (type, slug) DO UPDATE SET
              name = EXCLUDED.name,
              body = EXCLUDED.body,
              image_url = EXCLUDED.image_url,
              website = EXCLUDED.website,
              updated_at = EXCLUDED.updated_at
          `, [
            insertData.type, insertData.slug, insertData.name, insertData.body,
            insertData.image_url, insertData.website, insertData.external_id,
            insertData.source, insertData.country, insertData.date_primary,
            insertData.tags, insertData.attributes, insertData.metadata,
            insertData.verified, insertData.test, insertData.created_at, insertData.updated_at
          ])
        }
        results.companies.migrated++
      }
      console.log(`Migrated ${results.companies.migrated} companies`)
    } catch (error) {
      console.error('Error migrating companies:', error)
      results.errors.push(`Companies: ${error.message}`)
    }

    // 3. Migrate posts
    console.log('Migrating posts...')
    try {
      const postRows = (await conn.query('SELECT * FROM content_posts')).rows

      for (const post of postRows) {
        const insertData = {
          type: 'post',
          slug: post.slug,
          title: post.title,
          summary: post.summary || null,
          body: post.body || null,
          status: post.status || 'draft',
          published_at: post.published_at || null,
          author: post.author || null,
          image_url: post.image_url || null,
          tags: post.tags || '{}',
          attributes: post.attributes || '{}',
          metadata: post.metadata || '{}',
          verified: post.verified || false,
          test: post.test || false,
          created_at: post.created_at,
          updated_at: post.updated_at
        }

        if (!dryRun) {
          await conn.query(`
            INSERT INTO content (type, slug, title, summary, body, status, published_at, author, image_url,
              tags, attributes, metadata, verified, test, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            ON CONFLICT (type, slug) DO UPDATE SET
              title = EXCLUDED.title,
              summary = EXCLUDED.summary,
              body = EXCLUDED.body,
              status = EXCLUDED.status,
              updated_at = EXCLUDED.updated_at
          `, [
            insertData.type, insertData.slug, insertData.title, insertData.summary,
            insertData.body, insertData.status, insertData.published_at, insertData.author,
            insertData.image_url, insertData.tags, insertData.attributes, insertData.metadata,
            insertData.verified, insertData.test, insertData.created_at, insertData.updated_at
          ])
        }
        results.posts.migrated++
      }
      console.log(`Migrated ${results.posts.migrated} posts`)
    } catch (error) {
      console.error('Error migrating posts:', error)
      results.errors.push(`Posts: ${error.message}`)
    }

    // 4. Migrate productions and create relationships
    console.log('Migrating productions...')
    try {
      const productionRows = (await conn.query('SELECT * FROM content_productions')).rows

      for (const production of productionRows) {
        const insertData = {
          type: 'production',
          slug: production.slug,
          title: production.title,
          summary: production.summary || null,
          body: production.body || null,
          status: production.status || 'draft',
          published_at: production.published_at || null,
          image_url: production.image_url || null,
          external_id: production.external_id || null,
          language: production.language || null,
          country: production.country || null,
          date_primary: production.released_on || null,
          runtime_minutes: production.runtime_minutes || null,
          rating: production.rating || null,
          borough: production.borough || null,
          neighborhood: production.neighborhood || null,
          area: production.area || null,
          tags: production.tags || '{}',
          attributes: production.attributes || '{}',
          metadata: production.metadata || '{}',
          verified: production.verified || false,
          test: production.test || false,
          created_at: production.created_at,
          updated_at: production.updated_at
        }

        let productionId = null

        if (!dryRun) {
          const result = await conn.query(`
            INSERT INTO content (type, slug, title, summary, body, status, published_at, image_url,
              external_id, language, country, date_primary, runtime_minutes, rating, borough, neighborhood, area,
              tags, attributes, metadata, verified, test, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
            ON CONFLICT (type, slug) DO UPDATE SET
              title = EXCLUDED.title,
              summary = EXCLUDED.summary,
              body = EXCLUDED.body,
              status = EXCLUDED.status,
              updated_at = EXCLUDED.updated_at
            RETURNING id
          `, [
            insertData.type, insertData.slug, insertData.title, insertData.summary,
            insertData.body, insertData.status, insertData.published_at, insertData.image_url,
            insertData.external_id, insertData.language, insertData.country, insertData.date_primary,
            insertData.runtime_minutes, insertData.rating, insertData.borough, insertData.neighborhood,
            insertData.area, insertData.tags, insertData.attributes, insertData.metadata,
            insertData.verified, insertData.test, insertData.created_at, insertData.updated_at
          ])
          productionId = result.rows[0].id

          // Create actor relationships
          const actors = [production.actor1, production.actor2, production.actor3].filter(Boolean)
          for (let i = 0; i < actors.length; i++) {
            const actorName = actors[i]
            const actorSlug = slugify(actorName)

            // Find actor ID
            const actorQuery = await conn.query('SELECT id FROM content WHERE type = $1 AND slug = $2', ['actor', actorSlug])

            const actorId = actorQuery.rows[0]?.id

            if (actorId) {
              // Create relationship
              await conn.query(`
                INSERT INTO content_relationships (source_id, target_id, relationship_type, position)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (source_id, target_id, relationship_type) DO NOTHING
              `, [productionId, actorId, 'cast', i + 1])
              results.productions.relationships++
            }
          }

          // Create company relationship
          if (production.company) {
            const companySlug = slugify(production.company)

            const companyQuery = await conn.query('SELECT id FROM content WHERE type = $1 AND slug = $2', ['company', companySlug])

            const companyId = companyQuery.rows[0]?.id

            if (companyId) {
              await conn.query(`
                INSERT INTO content_relationships (source_id, target_id, relationship_type)
                VALUES ($1, $2, $3)
                ON CONFLICT (source_id, target_id, relationship_type) DO NOTHING
              `, [productionId, companyId, 'production_company'])
              results.productions.relationships++
            }
          }
        }

        results.productions.migrated++
      }
      console.log(`Migrated ${results.productions.migrated} productions with ${results.productions.relationships} relationships`)
    } catch (error) {
      console.error('Error migrating productions:', error)
      results.errors.push(`Productions: ${error.message}`)
    }

    await conn.end()

    return NextResponse.json({
      success: results.errors.length === 0,
      message: dryRun ? 'Dry run completed' : 'Migration completed',
      results
    })

  } catch (error) {
    console.error('Migration error:', error)
    if (conn) {
      try {
        await conn.end()
      } catch (e) {
        console.error('Error closing connection:', e)
      }
    }
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
