import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { requireOperatorAuth } from '@/lib/operatorRouteAuth'
import { DEFAULT_CONTENT_DOMAIN } from '@/lib/domainMode'

/**
 * POST /api/database/migrate/recreate-content-table
 * Recreate content table with subtype column placed after type.
 * Preserves data and content_relationships.
 */
export async function POST(request) {
    const auth = await requireOperatorAuth(request)
    if (auth.response) return auth.response
  const dbType = detectDatabaseType()
  if (dbType !== 'postgresql') {
    return NextResponse.json(
      { success: false, error: 'Relational database required' },
      { status: 400 }
    )
  }

  const conn = await getDatabaseConnection()
  if (!conn) {
    return NextResponse.json(
      { success: false, error: 'Could not connect to database' },
      { status: 500 }
    )
  }

  const targetColumns = [
    'id', 'type', 'subtype', 'domain', 'slug', 'title', 'name', 'summary', 'body', 'status', 'published_at',
    'image_url', 'external_id', 'source', 'date_primary', 'country', 'language', 'nationality',
    'website', 'runtime_minutes', 'rating', 'author', 'borough', 'neighborhood', 'area', 'tags',
    'attributes', 'metadata', 'verified', 'test', 'created_at', 'updated_at'
  ]

  const quoteColumn = (column) => `"${column}"`

  const getExistingColumns = async (tableName) => {
    const result = await conn.query(
      'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
      ['public', tableName]
    )
    return result.rows.map(row => row.column_name)
  }

  const tableExists = async (tableName) => {
    const result = await conn.query(
      'SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2',
      ['public', tableName]
    )
    return result.rows.length > 0
  }

  const buildSlugExpression = (existingColumns) => {
    const candidates = []
    if (existingColumns.includes('name')) {
      candidates.push(quoteColumn('name'))
    }
    if (existingColumns.includes('title')) {
      candidates.push(quoteColumn('title'))
    }
    if (existingColumns.includes('type')) {
      candidates.push(quoteColumn('type'))
    }
    candidates.push("'content'")

    const coalesce = `COALESCE(${candidates.join(', ')})`

    return `LOWER(REGEXP_REPLACE(${coalesce}, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || ${quoteColumn('id')}`
  }

  const buildInsertMapping = (existingColumns) => {
    const columns = []
    const selects = []

    for (const column of targetColumns) {
      if (column === 'domain' && existingColumns.includes('domain')) {
        columns.push(column)
        selects.push(`COALESCE(NULLIF(TRIM(${quoteColumn('domain')}), ''), '${DEFAULT_CONTENT_DOMAIN.replaceAll("'", "''")}')`)
        continue
      }

      if (column === 'slug') {
        columns.push(column)
        if (existingColumns.includes('slug')) {
          selects.push(quoteColumn('slug'))
        } else {
          selects.push(buildSlugExpression(existingColumns))
        }
        continue
      }

      if (existingColumns.includes(column)) {
        columns.push(column)
        selects.push(quoteColumn(column))
      }
    }

    return { columns, selects }
  }

  try {
    await conn.query('BEGIN')

    await conn.query(`CREATE TABLE content_new (
      id SERIAL PRIMARY KEY,
      type VARCHAR(50) NOT NULL,
      subtype VARCHAR(50),
      domain VARCHAR(64) NOT NULL DEFAULT '${DEFAULT_CONTENT_DOMAIN.replaceAll("'", "''")}',
      slug VARCHAR(255) NOT NULL,
      title VARCHAR(255),
      name VARCHAR(255),
      summary TEXT,
      body TEXT,
      status VARCHAR(50) DEFAULT 'draft',
      published_at TIMESTAMPTZ,
      image_url TEXT,
      external_id TEXT,
      source TEXT,
      date_primary DATE,
      country VARCHAR(2),
      language VARCHAR(16),
      nationality VARCHAR(100),
      website TEXT,
      runtime_minutes INTEGER,
      rating VARCHAR(50),
      author TEXT,
      borough VARCHAR(255),
      neighborhood VARCHAR(255),
      area VARCHAR(255),
      tags TEXT[] DEFAULT '{}',
      attributes JSONB DEFAULT '{}'::jsonb,
      metadata JSONB DEFAULT '{}'::jsonb,
      verified BOOLEAN NOT NULL DEFAULT FALSE,
      test BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(type, slug)
    )`)

    const existingContentColumns = await getExistingColumns('content')
    const { columns, selects } = buildInsertMapping(existingContentColumns)
    if (columns.length > 0) {
      await conn.query(`INSERT INTO content_new (${columns.map(quoteColumn).join(', ')}) SELECT ${selects.join(', ')} FROM content`)
    }

    const relationshipsExist = await tableExists('content_relationships')
    if (relationshipsExist) {
      await conn.query(`CREATE TABLE content_relationships_new (
        id SERIAL PRIMARY KEY,
        source_id INTEGER NOT NULL REFERENCES content_new(id) ON DELETE CASCADE,
        target_id INTEGER NOT NULL REFERENCES content_new(id) ON DELETE CASCADE,
        relationship_type VARCHAR(50) NOT NULL,
        role VARCHAR(255),
        position INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(source_id, target_id, relationship_type)
      )`)

      await conn.query(`INSERT INTO content_relationships_new (
        id, source_id, target_id, relationship_type, role, position, created_at
      )
      SELECT id, source_id, target_id, relationship_type, role, position, created_at
      FROM content_relationships`)

      await conn.query('DROP TABLE content_relationships')
    }

    await conn.query('DROP TABLE content')
    await conn.query('ALTER TABLE content_new RENAME TO content')
    if (relationshipsExist) {
      await conn.query('ALTER TABLE content_relationships_new RENAME TO content_relationships')
    }

    await conn.query('CREATE INDEX IF NOT EXISTS content_subtype_idx ON content(subtype)')
    await conn.query('CREATE INDEX IF NOT EXISTS content_type_idx ON content(type)')
    await conn.query('CREATE INDEX IF NOT EXISTS content_domain_idx ON content(domain)')
    await conn.query('CREATE INDEX IF NOT EXISTS content_domain_status_idx ON content(domain, status)')
    await conn.query('CREATE INDEX IF NOT EXISTS content_slug_idx ON content(slug)')
    await conn.query('CREATE INDEX IF NOT EXISTS content_status_idx ON content(status)')
    await conn.query('CREATE INDEX IF NOT EXISTS content_test_idx ON content(test)')
    await conn.query('CREATE INDEX IF NOT EXISTS content_verified_idx ON content(verified)')
    await conn.query('CREATE INDEX IF NOT EXISTS content_published_at_idx ON content(published_at)')

    if (relationshipsExist) {
      await conn.query('CREATE INDEX IF NOT EXISTS content_rel_source_idx ON content_relationships(source_id)')
      await conn.query('CREATE INDEX IF NOT EXISTS content_rel_target_idx ON content_relationships(target_id)')
      await conn.query('CREATE INDEX IF NOT EXISTS content_rel_type_idx ON content_relationships(relationship_type)')
    }

    await conn.query(
      "SELECT setval(pg_get_serial_sequence('content','id'), COALESCE((SELECT MAX(id) FROM content), 1))"
    )
    if (relationshipsExist) {
      await conn.query(
        "SELECT setval(pg_get_serial_sequence('content_relationships','id'), COALESCE((SELECT MAX(id) FROM content_relationships), 1))"
      )
    }

    await conn.query('COMMIT')

    return NextResponse.json({
      success: true,
      message: 'Content table recreated with subtype column after type',
      dbType
    })
  } catch (error) {
    try {
      await conn.query('ROLLBACK')
    } catch (rollbackError) {
      console.error('Rollback error:', rollbackError)
    }

    console.error('Recreate content table error:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  } finally {
    await conn.end()
  }
}
