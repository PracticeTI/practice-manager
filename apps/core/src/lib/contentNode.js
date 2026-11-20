import { slugify } from '@/lib/contentRelationships'

export function normalizeContentType(type) {
  const normalized = String(type || '').trim().toLowerCase()
  if (normalized === 'article') return 'post'
  return normalized
}

export function safeJsonParse(value, fallback = {}) {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'object') return value
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch (error) {
      return fallback
    }
  }
  return fallback
}

export function normalizeMetadata(metadata, legacy = {}) {
  const base = safeJsonParse(metadata, {})
  const presentation = typeof base.presentation === 'object' && base.presentation !== null
    ? base.presentation
    : {}
  const defaultPresentation = typeof presentation.default === 'object' && presentation.default !== null
    ? presentation.default
    : {}

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

export function mergeMetadata(existing, incoming, legacy = {}) {
  const base = safeJsonParse(existing, {})
  const next = safeJsonParse(incoming, {})
  const basePresentation = typeof base.presentation === 'object' && base.presentation !== null
    ? base.presentation
    : {}
  const nextPresentation = typeof next.presentation === 'object' && next.presentation !== null
    ? next.presentation
    : {}

  const merged = {
    ...base,
    ...next,
    presentation: {
      ...basePresentation,
      ...nextPresentation,
      default: {
        ...(basePresentation.default || {}),
        ...(nextPresentation.default || {})
      }
    }
  }

  return normalizeMetadata(merged, legacy)
}

export function ensureSlug(metadata, legacy = {}) {
  const base = safeJsonParse(metadata, {})
  const existingSlug = base.slug
  if (existingSlug) return { metadata: base, slug: existingSlug }

  const title = legacy.title || legacy.name || ''
  const computed = slugify(title) || `content-${Date.now()}`
  return {
    metadata: {
      ...base,
      slug: computed
    },
    slug: computed
  }
}

export function buildNodeResponse(row, relationships = []) {
  const attributes = safeJsonParse(row.attributes, {})
  const metadata = normalizeMetadata(row.metadata, row)
  const normalizedType = normalizeContentType(row.type)

  return {
    id: row.id,
    type: normalizedType,
    subtype: row.subtype ?? null,
    status: row.status ?? null,
    published_at: row.published_at ?? null,
    body: row.body ?? null,
    attributes,
    metadata,
    relationships,
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

export function resolveLegacyPresentation(metadata, legacy = {}) {
  const normalized = normalizeMetadata(metadata, legacy)
  const defaultPresentation = normalized.presentation?.default || {}

  return {
    metadata: normalized,
    title: legacy.title ?? defaultPresentation.title ?? null,
    summary: legacy.summary ?? defaultPresentation.summary ?? null,
    name: legacy.name ?? defaultPresentation.title ?? null
  }
}
