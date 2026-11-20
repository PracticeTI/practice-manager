import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

const slugify = (s) => (s || '')
  .toLowerCase()
  .replace(/[^a-z0-9\s-]/g, '')
  .trim()
  .replace(/[\s_-]+/g, '-')
  .replace(/^-+|-+$/g, '')

export async function POST(request) {
  const dbType = detectDatabaseType()
  if (dbType !== 'postgresql') {
    return NextResponse.json({ success: false, error: 'Relational database (PostgreSQL) is required' }, { status: 400, headers: corsHeaders })
  }

  const body = await request.json().catch(() => ({}))
  const actors = Array.isArray(body?.actors) ? body.actors : []
  if (!actors.length) {
    return NextResponse.json({ success: false, error: 'actors array is required' }, { status: 400, headers: corsHeaders })
  }

  let conn
  try {
    conn = await getDatabaseConnection()

    for (const actor of actors) {
      const name = actor?.name?.trim()
      const imageUrl = actor?.image_url?.trim() || actor?.url?.trim() || null
      if (!name || !imageUrl) continue
      const slug = slugify(name)

      if (dbType === 'postgresql') {
        await conn.query(
          `INSERT INTO content_actors (slug, name, image_url, source, test, verified, created_at, updated_at)
           VALUES ($1, $2, $3, $4, TRUE, FALSE, NOW(), NOW())
           ON CONFLICT (slug) DO UPDATE SET image_url = EXCLUDED.image_url, source = EXCLUDED.source, test = TRUE, updated_at = NOW()`,
          [slug, name, imageUrl, 'wikimedia']
        )
      }
    }

    await conn.end()

    return NextResponse.json({ success: true }, { headers: corsHeaders })
  } catch (error) {
    console.error('upsert actor images error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500, headers: corsHeaders })
  }
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders })
}
