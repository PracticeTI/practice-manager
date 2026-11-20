import { isSuperAdmin, verifyAdminAuth } from '@/lib/auth'
import { approveProviderScreenshot, getProviderScreenshot } from '@/lib/providerHeroScreenshot'
import { DEV_TOOLING_DISABLED_MESSAGE, isDevToolingEnabled } from '@/lib/devTools'

// Captures spawn a local Chrome process, so this must run on the Node runtime
// and must never be prerendered or cached at the route level.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Serves the mobile above-the-fold screenshot for a provider website.
 *
 * `/api/allied-health/provider-screenshot?url=https://example.com.au`
 *
 * This exists for the provider hero-card experiment. It only ever captures public
 * http(s) hosts (see normalizeCapturableUrl) and returns a cached PNG when one is fresh.
 *
 * Developer-only: capture needs a local Chrome install, so production answers 501
 * rather than attempting to spawn a browser it does not have.
 */
export async function GET(request) {
    if (!isDevToolingEnabled()) {
        return Response.json({ error: DEV_TOOLING_DISABLED_MESSAGE }, { status: 501 })
    }

    const target = new URL(request.url).searchParams.get('url')

    if (!target) {
        return Response.json({ error: 'A url query parameter is required' }, { status: 400 })
    }

    try {
        const png = await getProviderScreenshot(target)

        return new Response(png, {
            status: 200,
            headers: {
                'Content-Type': 'image/png',
                'Content-Length': String(png.length),
                // No client caching: the on-disk capture cache serves in ~10ms, and letting a
                // browser hold an image for a day would outlive both a re-capture and a change
                // to the capture viewport.
                'Cache-Control': 'no-store',
            },
        })
    } catch (error) {
        const message = error?.message || 'Unable to capture the provider website'
        // A missing Chrome is an environment limitation, not a capture failure.
        const status = /chrome|chromium/i.test(message) ? 501 : 502
        return Response.json({ error: message }, { status })
    }
}

/**
 * Approve the screenshot already being shown for this provider.
 *
 * Promotes the cached image into public/allied-health/provider-heroes/ so it can be reused
 * later, without opening a browser window. Superadmin-only and refused in production, because
 * it writes into the repo and the review page at /settings/hero-review is a superadmin tool.
 */
export async function POST(request) {
    if (process.env.NODE_ENV === 'production') {
        return Response.json(
            { error: 'Approving screenshots writes into public/ and is disabled in production.' },
            { status: 403 },
        )
    }

    const adminUser = await verifyAdminAuth(request)
    if (!adminUser) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (!isSuperAdmin(adminUser)) {
        return Response.json({ error: 'Only superadmins can approve provider screenshots.' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const target = String(body?.url || '').trim()
    if (!target) return Response.json({ error: 'A url is required' }, { status: 400 })

    try {
        const result = await approveProviderScreenshot(target, {
            provider: body?.provider,
            providerId: body?.providerId,
        })
        return Response.json({ success: true, ...result })
    } catch (error) {
        return Response.json(
            { success: false, error: error?.message || 'Unable to approve the screenshot' },
            { status: 400 },
        )
    }
}
