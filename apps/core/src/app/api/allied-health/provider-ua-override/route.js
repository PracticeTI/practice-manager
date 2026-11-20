import { isSuperAdmin, verifyAdminAuth } from '@/lib/auth'
import { setUaOverride } from '@/lib/providerHeroScreenshot'

// Writes into public/, so this must run on the Node runtime.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Per-host "capture this site with a mobile user agent" opt-in.
 *
 *   POST { enabled: true,  url, provider, providerId }  -> add the host
 *   POST { enabled: false, url }                        -> remove it
 *
 * Most sites lay themselves out responsively and need nothing here. A minority decide their markup
 * server-side from the user agent alone and serve a desktop layout at 390px — any Wix site does,
 * which is why upwardphysiotherapy.com.au rendered six top-level links and no hamburger. Those are
 * opted in one at a time, because a blanket spoof is what draws 403s from WAFs that cross-check it
 * against the TLS fingerprint.
 *
 * Same dev-only + superadmin gate as the other review routes, because it writes into the
 * repo and the review page at /settings/hero-review is a superadmin tool.
 */
export async function POST(request) {
    if (process.env.NODE_ENV === 'production') {
        return Response.json(
            { error: 'Capture overrides write into public/ and are disabled in production.' },
            { status: 403 },
        )
    }

    const adminUser = await verifyAdminAuth(request)
    if (!adminUser) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (!isSuperAdmin(adminUser)) {
        return Response.json({ error: 'Only superadmins can change capture overrides.' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const url = String(body?.url || '').trim()
    if (!url) return Response.json({ error: 'A url is required' }, { status: 400 })

    try {
        const result = await setUaOverride(url, Boolean(body?.enabled), {
            provider: body?.provider,
            providerId: body?.providerId,
        })
        return Response.json({ success: true, ...result })
    } catch (error) {
        return Response.json(
            { success: false, error: error?.message || 'Unable to update the capture override' },
            { status: 400 },
        )
    }
}
