import { isSuperAdmin, verifyAdminAuth } from '@/lib/auth'
import { providerHeroHostname } from '@/lib/providerHeroPreview'
import {
    readApprovedHostnames,
    readUnreachableSites,
    selectReviewBatch,
    selectUnreachableBatch,
} from '@/lib/providerHeroReview'
import { readUaOverrides } from '@/lib/providerHeroScreenshot'
import { listProviders } from '@/lib/providersStore'

// Reads the manifest/unreachable JSON from disk, so this must run on the Node runtime.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BATCH_SIZE = 3

/**
 * One batch of the provider hero review queue, for the superadmin tool at /settings/hero-review.
 *
 *   GET ?after=<providerId>                 -> the next three providers still to review
 *   GET ?show=unreachable&after=<providerId> -> the next three marked unreachable
 *
 * This exists so the page can be a client shell: the batch is the only thing the page renders that
 * is not public knowledge, and serving it from here means an unauthenticated request gets a 401
 * with no provider data in it, instead of the page's server component shipping the batch to the
 * browser inside the RSC payload before the client-side gate runs.
 *
 * The response is the view model rather than raw records — each card arrives with its mark state and
 * saved capture preference already resolved, so the client needs neither the manifest nor the
 * hostname helper.
 */
export async function GET(request) {
    const adminUser = await verifyAdminAuth(request)
    if (!adminUser) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (!isSuperAdmin(adminUser)) {
        return Response.json({ error: 'Only superadmins can review provider captures.' }, { status: 403 })
    }

    const params = new URL(request.url).searchParams
    // Cursor: the id of the previous batch's last provider.
    const after = String(params.get('after') || '')
    // The queue and the unreachable list are the same batch walk over different filters.
    const showUnreachable = String(params.get('show') || '') === 'unreachable'

    const providers = await listProviders()
    const [approved, unreachableSites, uaOverrides] = await Promise.all([
        readApprovedHostnames(),
        readUnreachableSites(),
        readUaOverrides(),
    ])

    const unreachable = new Set(Object.keys(unreachableSites))
    const batch = showUnreachable
        ? selectUnreachableBatch({ providers, unreachable, after, count: BATCH_SIZE })
        : selectReviewBatch({ providers, approved, unreachable, after, count: BATCH_SIZE })

    return Response.json(
        {
            success: true,
            view: showUnreachable ? 'unreachable' : 'queue',
            cards: batch.batch.map((provider) => ({
                provider,
                unreachable: showUnreachable,
                mobileUserAgent: uaOverrides[providerHeroHostname(provider.website_url)]?.mobileUserAgent === true,
            })),
            after: batch.after,
            hasMore: batch.hasMore,
            remaining: batch.remaining,
            eligibleTotal: batch.eligibleTotal,
            // selectUnreachableBatch has no total: the reviewable list length is a queue-view concern.
            total: batch.total ?? null,
            marked: batch.marked ?? 0,
            // Every mark, not just the attached ones, because the queue view offers to review them all.
            markCount: unreachable.size,
            orphans: showUnreachable ? batch.orphans.map((host) => unreachableSites[host]) : [],
        },
        { headers: { 'Cache-Control': 'no-store' } },
    )
}
