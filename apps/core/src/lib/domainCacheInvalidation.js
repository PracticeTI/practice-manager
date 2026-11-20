import { getDomainSetting, setDomainSetting } from '@/lib/appSettings'
import { getPrivateContentTypeOwner } from './domainExtension.js'
import { DEFAULT_CONTENT_DOMAIN } from './domainMode.js'

function parseObject(value) {
    if (!value) return {}
    if (typeof value === 'object' && value !== null) return value
    if (typeof value !== 'string') return {}

    try {
        const parsed = JSON.parse(value)
        return typeof parsed === 'object' && parsed !== null ? parsed : {}
    } catch {
        return {}
    }
}

export function normalizeDomainKey(domainKey) {
    const normalized = String(domainKey || '').trim().toLowerCase()
    if (!normalized || normalized === 'core') return DEFAULT_CONTENT_DOMAIN
    return normalized
}

export function getEffectiveContentDomain(row) {
    const metadata = parseObject(row?.metadata)
    const attributes = parseObject(row?.attributes)
    const explicitDomain = normalizeDomainKey(row?.domain || attributes?.domain || metadata?.domain || '')

    if (explicitDomain && explicitDomain !== DEFAULT_CONTENT_DOMAIN) {
        return explicitDomain
    }

    const type = String(row?.type || '').trim().toLowerCase()
    const privateOwner = getPrivateContentTypeOwner(type)
    if (privateOwner) return privateOwner

    return explicitDomain || DEFAULT_CONTENT_DOMAIN
}

export async function getDomainCacheInvalidatedAt(domainKey) {
    const invalidatedAt = await getDomainSetting(normalizeDomainKey(domainKey), 'cache_invalidation')
    return typeof invalidatedAt === 'string' && invalidatedAt.trim() ? invalidatedAt : null
}

export async function markDomainsCacheInvalidated(domainKeys) {
    const uniqueDomainKeys = Array.from(
        new Set((domainKeys || []).map(normalizeDomainKey).filter(Boolean))
    )

    if (uniqueDomainKeys.length === 0) return false

    const invalidatedAt = new Date().toISOString()

    const results = await Promise.all(
        uniqueDomainKeys.map((domainKey) => setDomainSetting(domainKey, 'cache_invalidation', invalidatedAt))
    )

    return results.every(Boolean)
}
