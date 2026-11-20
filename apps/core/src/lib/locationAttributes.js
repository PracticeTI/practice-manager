/**
 * Location Attributes Utilities
 * 
 * Helpers for storing and querying location data in content.attributes
 * instead of rigid database columns.
 */

/**
 * Build location object for attributes field
 * @param {Object} location - Location data
 * @param {string} location.borough - Borough name
 * @param {string} location.neighborhood - Neighborhood name  
 * @param {string} location.area - Area name
 * @param {string} location.address - Street address (optional)
 * @param {Object} location.coordinates - Lat/lng (optional)
 * @returns {Object} Formatted location object
 */
export function buildLocationAttributes(location) {
  const loc = {}

  if (location.borough) loc.borough = location.borough
  if (location.neighborhood) loc.neighborhood = location.neighborhood
  if (location.area) loc.area = location.area
  if (location.address) loc.address = location.address
  if (location.coordinates) {
    loc.coordinates = {
      lat: location.coordinates.lat,
      lng: location.coordinates.lng
    }
  }

  return Object.keys(loc).length > 0 ? { location: loc } : {}
}

/**
 * Extract location from attributes
 * @param {Object} attributes - Content attributes object
 * @returns {Object|null} Location object or null
 */
export function getLocationFromAttributes(attributes) {
  return attributes?.location || null
}

/**
 * Build SQL WHERE clause for location search (PostgreSQL)
 * @param {Object} location - Location search criteria
 * @param {number} startParamIndex - Starting parameter index for query
 * @returns {Object} { clauses: string[], params: any[] }
 */
export function buildLocationQueryPostgres(location, startParamIndex = 1) {
  const clauses = []
  const params = []
  let paramIndex = startParamIndex

  if (location.borough) {
    clauses.push(`attributes->'location'->>'borough' = $${paramIndex}`)
    params.push(location.borough)
    paramIndex++
  }

  if (location.neighborhood) {
    clauses.push(`attributes->'location'->>'neighborhood' ILIKE $${paramIndex}`)
    params.push(`%${location.neighborhood}%`)
    paramIndex++
  }

  if (location.area) {
    clauses.push(`attributes->'location'->>'area' ILIKE $${paramIndex}`)
    params.push(`%${location.area}%`)
    paramIndex++
  }

  return { clauses, params }
}

/**
 * Format location for display
 * @param {Object} location - Location object from attributes
 * @returns {string} Formatted location string
 */
export function formatLocation(location) {
  if (!location) return ''

  const parts = []
  if (location.neighborhood) parts.push(location.neighborhood)
  if (location.borough) parts.push(location.borough)

  return parts.join(', ')
}

/**
 * Example usage:
 * 
 * // When creating/updating content:
 * const attributes = {
 *   ...existingAttributes,
 *   ...buildLocationAttributes({
 *     borough: 'Brooklyn',
 *     neighborhood: 'Williamsburg',
 *     area: 'East Williamsburg'
 *   })
 * }
 * 
 * // When querying:
 * const { clauses, params } = buildLocationQueryPostgres({
 *   borough: 'Brooklyn'
 * }, paramStartIndex)
 * 
 * // When displaying:
 * const locationStr = formatLocation(content.attributes.location)
 */
