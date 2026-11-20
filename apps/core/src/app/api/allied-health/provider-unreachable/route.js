import { isSuperAdmin, verifyAdminAuth } from '@/lib/auth'
import { markProviderUnreachable, unmarkProviderUnreachable } from '@/lib/providerHeroReview'

// Writes into public/, so this must run on the Node runtime.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Track providers whose screenshots are never going to be usable — dead domains, bot walls, or
 * nothing worth showing — so they drop out of the review batches.
 *
 *   POST { action: 'mark',   url, provider, providerId }
 *   POST { action: 'unmark', url }
 *
 * Same dev-only + superadmin gate as the other review routes, because it writes into the
 * repo and the review page at /settings/hero-review is a superadmin tool.
 */
export async function POST(request) {
    if (process.env.NODE_ENV === 'production') {
        return Response.json(
            { error: 'Review bookkeeping writes into public/ and is disabled in production.' },
            { status: 403 },
        )
    }

    const adminUser = await verifyAdminAuth(request)
    if (!adminUser) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (!isSuperAdmin(adminUser)) {
        return Response.json({ error: 'Only superadmins can change the unreachable list.' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const url = String(body?.url || '').trim()
    if (!url) return Response.json({ error: 'A url is required' }, { status: 400 })

    try {
        if (String(body?.action || 'mark') === 'unmark') {
            const removed = await unmarkProviderUnreachable(url)
            return Response.json({ success: true, removed })
        }

        const entry = await markProviderUnreachable(url, {
            provider: body?.provider,
            providerId: body?.providerId,
        })
        return Response.json({ success: true, entry })
    } catch (error) {
        return Response.json(
            { success: false, error: error?.message || 'Unable to update the unreachable list' },
            { status: 400 },
        )
    }
}
