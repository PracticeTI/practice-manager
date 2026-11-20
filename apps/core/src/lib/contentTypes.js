/**
 * Content Type Registry
 * WordPress-style custom post types
 * Allows domains to register and extend content types
 */

const contentTypes = new Map()

/**
 * Register a content type
 * @param {string} type - Type ID (e.g., 'production', 'actor', 'post')
 * @param {object} config - Type configuration
 */
export function registerContentType(type, config) {
  contentTypes.set(type, {
    // Metadata
    label: config.label || type,
    icon: config.icon || '📄',
    description: config.description || '',

    // Schema
    attributes: config.attributes || [],       // Expected attribute keys
    relationships: config.relationships || [], // Valid relationship types
    presentations: config.presentations || ['default'], // Render templates

    // AI Configuration
    aiEnrichable: config.aiEnrichable || false,
    aiGeneratable: config.aiGeneratable || false,

    // Lifecycle Hooks (WordPress-style)
    beforeSave: config.beforeSave || ((data) => data),
    afterLoad: config.afterLoad || ((node) => node),
    beforeDelete: config.beforeDelete || ((data) => data),

    // Validation
    validate: config.validate || (() => null),

    // Query Extensions
    customQueries: config.customQueries || {}
  })
}

/**
 * Get a single content type
 */
export function getContentType(type) {
  return contentTypes.get(type)
}

/**
 * Get all registered content types
 */
export function getAllContentTypes() {
  return Array.from(contentTypes.entries()).map(([key, value]) => ({
    id: key,
    ...value
  }))
}

/**
 * Check if a type is registered
 */
export function isTypeRegistered(type) {
  return contentTypes.has(type)
}

/**
 * Execute a lifecycle hook
 */
export function executeHook(type, hook, data) {
  const typeConfig = contentTypes.get(type)
  if (!typeConfig) return data
  if (!typeConfig[hook]) return data

  try {
    return typeConfig[hook](data)
  } catch (err) {
    console.error(`Error executing hook ${hook} for type ${type}:`, err)
    return data
  }
}

/**
 * Validate content against its type
 */
export function validateContent(type, data) {
  const typeConfig = contentTypes.get(type)
  if (!typeConfig) return ['Type not registered']
  if (!typeConfig.validate) return null

  try {
    const errors = typeConfig.validate(data)
    return errors || null
  } catch (err) {
    console.error(`Error validating type ${type}:`, err)
    return [err.message]
  }
}

/**
 * Build canonical node response
 */
export function buildNodeResponse(row, relationships = []) {
  const attributes = safeJsonParse(row.attributes, {})
  const metadata = normalizeMetadata(row.metadata, row)

  return {
    id: row.id,
    type: row.type,
    subtype: row.subtype ?? null,
    attributes,
    metadata,
    relationships,
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

/**
 * Safe JSON parsing utility
 */
export function safeJsonParse(value, fallback = {}) {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'object') return value
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch (error) {
      console.error('JSON parse error:', error)
      return fallback
    }
  }
  return fallback
}

/**
 * Normalize metadata with presentation defaults
 */
export function normalizeMetadata(metadata, legacy = {}) {
  const base = safeJsonParse(metadata, {})
  const presentation = base.presentation || {}
  const defaultPresentation = presentation.default || {}

  const title = defaultPresentation.title ?? legacy.title ?? legacy.name ?? null
  const summary = defaultPresentation.summary ?? legacy.summary ?? null
  const imageId = defaultPresentation.image_id ?? null

  return {
    ...base,
    presentation: {
      ...presentation,
      default: {
        ...defaultPresentation,
        title,
        summary,
        image_id: imageId
      }
    }
  }
}

/**
 * Merge metadata updates
 */
export function mergeMetadata(existing, incoming, legacy = {}) {
  const base = safeJsonParse(existing, {})
  const next = safeJsonParse(incoming, {})

  const merged = {
    ...base,
    ...next,
    presentation: {
      ...(base.presentation || {}),
      ...(next.presentation || {}),
      default: {
        ...(base.presentation?.default || {}),
        ...(next.presentation?.default || {})
      }
    }
  }

  return normalizeMetadata(merged, legacy)
}

/**
 * Initialize default content types
 */
export function initializeDefaultTypes() {
  // These will be registered by domains on startup
  console.log('Type registry initialized - waiting for domain registration')
}

const contentTypesApi = {
  registerContentType,
  getContentType,
  getAllContentTypes,
  isTypeRegistered,
  executeHook,
  validateContent,
  buildNodeResponse,
  safeJsonParse,
  normalizeMetadata,
  mergeMetadata,
  initializeDefaultTypes
}

export default contentTypesApi
