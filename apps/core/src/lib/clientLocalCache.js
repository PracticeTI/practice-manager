/**
 * Client-side local caching utility for domain-specific content
 * Provides transparent caching with TTL support, no manual refresh button
 *
 * Usage:
 *   await setCacheItem('content-home', homeData, 'default')
 *   const cached = await getCacheItem('content-home', 'default')
 */

const CACHE_VERSION = 1
const CACHE_PREFIX = `practice_cache_v${CACHE_VERSION}`

async function getCacheConfig(domainKey) {
    if (typeof window === 'undefined') {
        return {
            success: false,
            enableLocalCaching: false,
            localCacheTtlHours: 24,
            invalidatedAt: null,
        }
    }

    try {
        const res = await fetch(`/api/settings/domains/cache-config?domain=${encodeURIComponent(domainKey)}`, {
            cache: 'no-store',
        })

        if (!res.ok) {
            return {
                success: false,
                enableLocalCaching: false,
                localCacheTtlHours: 24,
                invalidatedAt: null,
            }
        }

        const data = await res.json()
        return {
            success: data.success === true,
            enableLocalCaching: data.enableLocalCaching === true,
            localCacheTtlHours: data.localCacheTtlHours || 24,
            invalidatedAt: data.invalidatedAt || null,
        }
    } catch (err) {
        console.warn('[clientLocalCache] Error fetching cache config:', err)
        return {
            success: false,
            enableLocalCaching: false,
            localCacheTtlHours: 24,
            invalidatedAt: null,
        }
    }
}

/**
 * Generate cache storage key
 */
function getCacheKey(cacheKey, domainKey) {
    return `${CACHE_PREFIX}:${domainKey}:${cacheKey}`
}

/**
 * Generate metadata storage key (tracks TTL)
 */
function getMetadataKey(cacheKey, domainKey) {
    return `${CACHE_PREFIX}_meta:${domainKey}:${cacheKey}`
}

/**
 * Check if caching is enabled for the current domain
 * Uses public endpoint - no authentication required
 *
 * @param {string} domainKey - domain identifier
 * @returns {Promise<boolean>}
 */
export async function isCachingEnabled(domainKey) {
    const config = await getCacheConfig(domainKey)
    return config.success && config.enableLocalCaching === true
}

/**
 * Get TTL hours for a domain
 * Uses public endpoint - no authentication required
 *
 * @param {string} domainKey - domain identifier
 * @returns {Promise<number>} hours
 */
export async function getCacheTtlHours(domainKey) {
    const config = await getCacheConfig(domainKey)
    return config.success ? config.localCacheTtlHours : 24
}

/**
 * Set cache item with TTL
 * Only stores if caching is enabled for the domain
 *
 * @param {string} cacheKey - identifier for the cached item
 * @param {any} data - data to cache (must be JSON-serializable)
 * @param {string} domainKey - domain identifier
 * @returns {Promise<boolean>} success
 */
export async function setCacheItem(cacheKey, data, domainKey) {
    if (typeof window === 'undefined' || !localStorage) {
        return false
    }

    try {
        const config = await getCacheConfig(domainKey)
        if (!config.success || !config.enableLocalCaching) {
            return false
        }

        const ttlHours = config.localCacheTtlHours || 24
        const expiresAt = Date.now() + ttlHours * 60 * 60 * 1000
        const cachedAt = Date.now()

        const storageKey = getCacheKey(cacheKey, domainKey)
        const metadataKey = getMetadataKey(cacheKey, domainKey)

        localStorage.setItem(storageKey, JSON.stringify(data))
        localStorage.setItem(metadataKey, JSON.stringify({ expiresAt, cachedAt }))

        return true
    } catch (err) {
        console.warn('[clientLocalCache] Error setting cache item:', err)
        return false
    }
}

/**
 * Get cache item if valid (not expired)
 * Returns null if cache is disabled, expired, or doesn't exist
 *
 * @param {string} cacheKey - identifier for the cached item
 * @param {string} domainKey - domain identifier
 * @returns {Promise<any|null>}
 */
export async function getCacheItem(cacheKey, domainKey) {
    if (typeof window === 'undefined' || !localStorage) return null

    try {
        const config = await getCacheConfig(domainKey)
        if (!config.success || !config.enableLocalCaching) return null

        const storageKey = getCacheKey(cacheKey, domainKey)
        const metadataKey = getMetadataKey(cacheKey, domainKey)

        const dataStr = localStorage.getItem(storageKey)
        const metadataStr = localStorage.getItem(metadataKey)

        if (!dataStr || !metadataStr) return null

        const metadata = JSON.parse(metadataStr)
        const expiresAt = metadata.expiresAt
        const cachedAt = metadata.cachedAt

        // If content has been updated since this cache entry was created,
        // invalidate all cached entries for this domain immediately.
        if (config.invalidatedAt) {
            const invalidatedAtMs = new Date(config.invalidatedAt).getTime()
            const cachedAtMs = Number.isFinite(cachedAt) ? cachedAt : 0
            if (Number.isFinite(invalidatedAtMs) && (cachedAtMs === 0 || cachedAtMs < invalidatedAtMs)) {
                clearCacheForDomain(domainKey)
                return null
            }
        }

        // Check if expired
        if (Date.now() > expiresAt) {
            // Clean up expired data
            localStorage.removeItem(storageKey)
            localStorage.removeItem(metadataKey)
            return null
        }

        return JSON.parse(dataStr)
    } catch (err) {
        console.warn('[clientLocalCache] Error getting cache item:', err)
        return null
    }
}

/**
 * Clear specific cache item
 *
 * @param {string} cacheKey - identifier for the cached item
 * @param {string} domainKey - domain identifier
 */
export function clearCacheItem(cacheKey, domainKey) {
    if (typeof window === 'undefined' || !localStorage) return

    const storageKey = getCacheKey(cacheKey, domainKey)
    const metadataKey = getMetadataKey(cacheKey, domainKey)

    localStorage.removeItem(storageKey)
    localStorage.removeItem(metadataKey)
}

/**
 * Clear all cache for a domain
 *
 * @param {string} domainKey - domain identifier
 */
export function clearCacheForDomain(domainKey) {
    if (typeof window === 'undefined' || !localStorage) return

    const pattern = `${CACHE_PREFIX}:${domainKey}:`
    const keysToRemove = []

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && (key.startsWith(pattern) || key.startsWith(`${CACHE_PREFIX}_meta:${domainKey}:`))) {
            keysToRemove.push(key)
        }
    }

    keysToRemove.forEach((key) => localStorage.removeItem(key))
}

/**
 * Clear all cache
 */
export function clearAllCache() {
    if (typeof window === 'undefined' || !localStorage) return

    const keysToRemove = []

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && key.startsWith(CACHE_PREFIX)) {
            keysToRemove.push(key)
        }
    }

    keysToRemove.forEach((key) => localStorage.removeItem(key))
}
