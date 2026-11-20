'use client'

import { useEffect, useRef } from 'react'
import { VALID_DOMAIN_MODES } from '@/lib/domainMode'
import { isCachingEnabled, getCacheTtlHours } from '@/lib/clientLocalCache'

/**
 * Silent cache initializer - runs on app startup
 * Checks if local caching is enabled for the current domain
 * No user-visible UI or refresh button
 */
export default function CacheInitializer() {
    const initDoneRef = useRef(false)

    useEffect(() => {
        if (initDoneRef.current) return
        initDoneRef.current = true

        // Initialize cache settings silently on app startup
        const initializeCache = async () => {
            try {
                // Get current domain from hostname or other detection
                // For now, this just primes the cache check
                const protocols = VALID_DOMAIN_MODES

                for (const domain of protocols) {
                    const enabled = await isCachingEnabled(domain)
                    if (enabled) {
                        const ttl = await getCacheTtlHours(domain)
                        // Silently log for debugging only
                        if (process.env.NODE_ENV === 'development') {
                            console.debug(`[CacheInitializer] Caching enabled for ${domain} (${ttl}h TTL)`)
                        }
                    }
                }
            } catch (err) {
                // Silently fail - caching is optional
                if (process.env.NODE_ENV === 'development') {
                    console.debug('[CacheInitializer] Cache initialization skipped:', err.message)
                }
            }
        }

        initializeCache()
    }, [])

    // This component renders nothing - it's purely for initialization
    return null
}
