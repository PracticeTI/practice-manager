import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { slugify, upsertContent, createRelationship, findContentBySlug } from '@/lib/contentRelationships'
import { requireOperatorAuth } from '@/lib/operatorRouteAuth'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

const SIX_PRODUCTIONS = [
  {
    title: 'The Brooklyn Detective',
    company: 'A24 Productions',
    actors: ['Constance Wu', 'Michael B. Jordan', 'Gina Rodriguez']
  },
  {
    title: 'Manhattan Nights',
    company: 'Warner Bros. Pictures',
    actors: ['Steven Yeun', 'Awkwafina', 'John Cho']
  },
  {
    title: 'Queens of Tomorrow',
    company: 'Netflix Studios',
    actors: ['Freida Pinto', 'Tom Holland', 'Zendaya']
  },
  {
    title: 'Harlem Renaissance',
    company: 'Focus Features',
    actors: ['Chadwick Boseman', "Lupita Nyong'o", 'Oscar Isaac']
  },
  {
    title: 'Bronx Stories',
    company: 'HBO Films',
    actors: ['America Ferrera', 'Daniel Dae Kim', 'Viola Davis']
  },
  {
    title: 'Staten Island Summer',
    company: 'Paramount Pictures',
    actors: ['Timothée Chalamet', 'Florence Pugh', 'Hailee Steinfeld']
  }
]

function parseMaybeJson(value) {
  if (value == null) return null
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value)
  } catch (_) {
    return null
  }
}

async function loadCompanyImagesFromCache(conn, dbType) {
  try {
    if (dbType === 'postgresql') {
      const result = await conn.query('SELECT value FROM system_settings WHERE key = $1 LIMIT 1', ['productions_cache'])
      if (result.rows.length === 0) return {}
      const cache = parseMaybeJson(result.rows[0].value) || {}
      return cache.companyImages || {}
    }
  } catch (e) {
    console.warn('Could not read legacy cache for company images:', e.message)
  }
  return {}
}

export async function POST(request) {
    const auth = await requireOperatorAuth(request)
    if (auth.response) return auth.response
  const dbType = detectDatabaseType()
  if (dbType !== 'postgresql') {
    return NextResponse.json({ success: false, error: 'Relational database (PostgreSQL) is required' }, { status: 400, headers: corsHeaders })
  }

  let conn
  try {
    conn = await getDatabaseConnection()

    // Ensure tables exist (idempotent via create-tables route normally)
    // We'll just proceed assuming create-tables already ran.

    const companyImages = await loadCompanyImagesFromCache(conn, dbType)

    // Clean up previous placeholder productions
    const companyNames = [...new Set(SIX_PRODUCTIONS.map(p => p.company))]
    const companySlugs = companyNames.map(slugify)
    if (dbType === 'postgresql') {
      await conn.query(
        `DELETE FROM content WHERE type = 'production' AND slug = ANY($1) AND title = ANY($2)`,
        [companySlugs, companyNames]
      )
    } else {
      if (companySlugs.length) {
        const placeholders = companySlugs.map(() => '?').join(',')
        const placeholders2 = companyNames.map(() => '?').join(',')
        await conn.query(
          `DELETE FROM content WHERE type = 'production' AND slug IN (${placeholders}) AND title IN (${placeholders2})`,
          [...companySlugs, ...companyNames]
        )
      }
    }

    // Upsert companies, actors, productions, and create relationships
    let inserted = 0
    for (const p of SIX_PRODUCTIONS) {
      const companySlug = slugify(p.company)
      const prodSlug = slugify(p.title)
      const image = companyImages?.[p.company]?.url || null

      // 1. Upsert company
      const companyId = await upsertContent(conn, dbType, {
        type: 'company',
        slug: companySlug,
        name: p.company,
        image_url: image,
        source: 'system',
        test: true,
        verified: false
      })

      // 2. Upsert actors
      const actorIds = []
      for (const actorName of p.actors) {
        const actorSlug = slugify(actorName)
        const actorId = await upsertContent(conn, dbType, {
          type: 'actor',
          slug: actorSlug,
          name: actorName,
          source: 'system',
          test: true,
          verified: false
        })
        actorIds.push(actorId)
      }

      // 3. Upsert production
      const productionId = await upsertContent(conn, dbType, {
        type: 'production',
        slug: prodSlug,
        title: p.title,
        status: 'published',
        source: 'system',
        test: true,
        verified: false
      })

      // 4. Create relationships
      // Link production to company
      await createRelationship(conn, dbType, productionId, companyId, 'production_company')

      // Link production to actors
      for (let i = 0; i < actorIds.length; i++) {
        await createRelationship(conn, dbType, productionId, actorIds[i], 'cast', { position: i + 1 })
      }

      inserted += 1
    }

    return NextResponse.json({ success: true, inserted, productions: SIX_PRODUCTIONS.map(p => p.title) }, { headers: corsHeaders })
  } catch (error) {
    console.error('Error seeding productions:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500, headers: corsHeaders })
  } finally {
    if (conn) {
      await conn.end()
    }
  }
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders })
}
