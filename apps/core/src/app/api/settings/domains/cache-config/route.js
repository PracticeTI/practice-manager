import { NextResponse } from 'next/server'
import { getDomainSetting } from '@/lib/appSettings'
import { getDomainCacheInvalidatedAt } from '@/lib/domainCacheInvalidation'

/**
 * GET /api/settings/domains/cache-config?domain=default
 * 
 * Public endpoint - NO AUTHENTICATION REQUIRED
 * Returns only cache configuration for a domain:
 * - enableLocalCaching
 * - localCacheTtlHours
 * 
 * Used by client-side caching utility on public pages
 */
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url)
        const domainKey = searchParams.get('domain')

        if (!domainKey) {
            return NextResponse.json(
                { success: false, error: 'domain query parameter required' },
                { status: 400 }
            )
        }

        const domainSettings = (await getDomainSetting(domainKey, 'management')) || {}
        const invalidatedAt = await getDomainCacheInvalidatedAt(domainKey)

        // Return only cache-related settings
        return NextResponse.json({
            success: true,
            domain: domainKey,
            enableLocalCaching: domainSettings.enableLocalCaching === true,
            localCacheTtlHours: domainSettings.localCacheTtlHours || 24,
            invalidatedAt,
        })
    } catch (err) {
        console.error('Error fetching cache config:', err)
        return NextResponse.json(
            { success: false, error: 'Failed to fetch cache config' },
            { status: 500 }
        )
    }
}
