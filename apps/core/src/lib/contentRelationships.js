/**
 * Helper functions for working with content and content_relationships tables
 */

/**
 * Slugify a string for use as a content slug
 */
export function slugify(str) {
  if (!str) return ''
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Get production with related actors and company
 * @param {Object} conn - Database connection
 * @param {string} dbType - 'postgresql'
 * @param {number} productionId - Production content ID
 * @returns {Object} Production with actors array and company object
 */
export async function getProductionWithRelationships(conn, dbType, productionId) {
  let production, actors = [], company = null

  // Get production
  const productionResult = await conn.query(
    'SELECT * FROM content WHERE id = $1 AND type = $2',
    [productionId, 'production']
  )
  production = productionResult.rows[0]

  if (!production) return null

  // Get actors
  const actorResult = await conn.query(`
    SELECT c.*, cr.position, cr.role
    FROM content c
    JOIN content_relationships cr ON c.id = cr.target_id
    WHERE cr.source_id = $1 
      AND cr.relationship_type = $2
      AND c.type = $3
    ORDER BY cr.position
  `, [productionId, 'cast', 'actor'])
  actors = actorResult.rows

  // Get company
  const companyResult = await conn.query(`
    SELECT c.*
    FROM content c
    JOIN content_relationships cr ON c.id = cr.target_id
    WHERE cr.source_id = $1 
      AND cr.relationship_type = $2
      AND c.type = $3
    LIMIT 1
  `, [productionId, 'production_company', 'company'])
  company = companyResult.rows[0] || null

  return {
    ...production,
    actors,
    company
  }
}

/**
 * Get all productions for an actor
 * @param {Object} conn - Database connection
 * @param {string} dbType - 'postgresql'
 * @param {number} actorId - Actor content ID
 * @returns {Array} Productions featuring this actor
 */
export async function getProductionsByActor(conn, dbType, actorId) {
  const result = await conn.query(`
    SELECT c.*, cr.position, cr.role
    FROM content c
    JOIN content_relationships cr ON c.id = cr.source_id
    WHERE cr.target_id = $1 
      AND cr.relationship_type = $2
      AND c.type = $3
    ORDER BY c.date_primary DESC, c.created_at DESC
  `, [actorId, 'cast', 'production'])
  return result.rows
}

/**
 * Get all productions for a company
 * @param {Object} conn - Database connection
 * @param {string} dbType - 'postgresql'
 * @param {number} companyId - Company content ID
 * @returns {Array} Productions by this company
 */
export async function getProductionsByCompany(conn, dbType, companyId) {
  const result = await conn.query(`
    SELECT c.*
    FROM content c
    JOIN content_relationships cr ON c.id = cr.source_id
    WHERE cr.target_id = $1 
      AND cr.relationship_type = $2
      AND c.type = $3
    ORDER BY c.date_primary DESC, c.created_at DESC
  `, [companyId, 'production_company', 'production'])
  return result.rows
}

/**
 * Create or update a content item
 * @param {Object} conn - Database connection
 * @param {string} dbType - 'postgresql'
 * @param {Object} data - Content data
 * @returns {number} Content ID
 */
export async function upsertContent(conn, dbType, data) {
  const {
    id = null,
    type,
    subtype = null,
    slug = null,
    title = null,
    name = null,
    status = 'draft',
    published_at = null,
    metadata = {}
  } = data

  // Ensure metadata is a valid JSON object
  let finalMetadata = metadata
  if (typeof metadata === 'string') {
    try {
      finalMetadata = JSON.parse(metadata)
    } catch {
      finalMetadata = {}
    }
  }

  const resolvedName = name || title || null
  const resolvedSlug = slug || finalMetadata?.slug || slugify(resolvedName || `${type}-${Date.now()}`)
  const resolvedTitle = title || resolvedName
  const nowIso = new Date().toISOString()
  finalMetadata = {
    ...(finalMetadata || {}),
    slug: finalMetadata?.slug || resolvedSlug
  }

  if (id) {
    const result = await conn.query(`
      UPDATE content
      SET
        type = $2,
        subtype = $3,
        slug = $4,
        title = $5,
        name = $6,
        status = $7,
        published_at = $8,
        metadata = $9,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id
    `, [
      id,
      type,
      subtype,
      resolvedSlug,
      resolvedTitle,
      resolvedName,
      status,
      published_at,
      JSON.stringify(finalMetadata)
    ])

    if (result.rows[0]?.id) {
      return result.rows[0].id
    }
  }

  try {
    const result = await conn.query(`
      INSERT INTO content (
        type, subtype, slug, title, name, status, published_at, metadata, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
      )
      RETURNING id
    `, [
      type,
      subtype,
      resolvedSlug,
      resolvedTitle,
      resolvedName,
      status,
      published_at,
      JSON.stringify(finalMetadata),
      nowIso,
      nowIso
    ])

    return result.rows[0].id
  } catch (insertError) {
    const message = String(insertError?.message || '')
    const isNullIdConstraint =
      message.includes('null value in column "id"') ||
      (insertError?.code === '23502' && message.includes('column "id"'))

    if (!isNullIdConstraint) {
      throw insertError
    }

    const sequenceResult = await conn.query(
      `SELECT pg_get_serial_sequence('content', 'id') AS seq_name`
    )
    const sequenceName = sequenceResult.rows?.[0]?.seq_name

    let nextId
    if (sequenceName) {
      const nextValResult = await conn.query(
        `SELECT nextval($1) AS next_id`,
        [sequenceName]
      )
      nextId = nextValResult.rows?.[0]?.next_id
    } else {
      const maxResult = await conn.query(
        `SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM content`
      )
      nextId = maxResult.rows?.[0]?.next_id
    }

    const retryResult = await conn.query(`
      INSERT INTO content (
        id, type, subtype, slug, title, name, status, published_at, metadata, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
      )
      RETURNING id
    `, [
      nextId,
      type,
      subtype,
      resolvedSlug,
      resolvedTitle,
      resolvedName,
      status,
      published_at,
      JSON.stringify(finalMetadata),
      nowIso,
      nowIso
    ])

    return retryResult.rows[0].id
  }
}

/**
 * Create a relationship between two content items
 * @param {Object} conn - Database connection
 * @param {string} dbType - 'postgresql'
 * @param {number} sourceId - Source content ID
 * @param {number} targetId - Target content ID
 * @param {string} relationshipType - Type of relationship (e.g., 'cast', 'production_company')
 * @param {Object} options - Additional options (role, position)
 */
export async function createRelationship(conn, dbType, sourceId, targetId, relationshipType, options = {}) {
  const { role = null, position = null } = options

  await conn.query(`
    INSERT INTO content_relationships (source_id, target_id, relationship_type, role, position)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (source_id, target_id, relationship_type) DO UPDATE SET
      role = EXCLUDED.role,
      position = EXCLUDED.position
  `, [sourceId, targetId, relationshipType, role, position])
}

/**
 * Remove a relationship between two content items
 * @param {Object} conn - Database connection
 * @param {string} dbType - 'postgresql'
 * @param {number} sourceId - Source content ID
 * @param {number} targetId - Target content ID
 * @param {string} relationshipType - Type of relationship
 */
export async function removeRelationship(conn, dbType, sourceId, targetId, relationshipType) {
  await conn.query(
    'DELETE FROM content_relationships WHERE source_id = $1 AND target_id = $2 AND relationship_type = $3',
    [sourceId, targetId, relationshipType]
  )
}

/**
 * Find content by type and slug
 * @param {Object} conn - Database connection
 * @param {string} dbType - 'postgresql'
 * @param {string} type - Content type
 * @param {string} slug - Content slug
 * @returns {Object|null} Content item or null
 */
export async function findContentBySlug(conn, dbType, type, name) {
  // Since slug is now in metadata, search by type and name instead
  const result = await conn.query(
    'SELECT * FROM content WHERE type = $1 AND name = $2',
    [type, name]
  )
  return result.rows[0] || null
}
