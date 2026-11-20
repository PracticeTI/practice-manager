import { isSuperAdmin, verifyAdminAuth } from '@/lib/auth'
import {
    cancelCaptureSession,
    commitCaptureSession,
    listCaptureSessions,
    startCaptureSession,
} from '@/lib/providerHeroScreenshot'

// Reviewing launches a real Chrome window, so this must run on the Node runtime
// and never be prerendered.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Human-in-the-loop capture for the provider hero-card experiment.
 *
 * The reviewer opens a provider site in a visible mobile-emulated Chrome window,
 * dismisses cookie banners/popups, then commits a screenshot of what they see.
 *
 *   POST { action: 'start',   url }        -> opens the review window
 *   POST { action: 'capture', sessionId }  -> caches what is on screen, ends the session
 *   POST { action: 'cancel',  sessionId }  -> closes the window without capturing
 *   GET                                    -> sessions currently open
 *
 * Driving a local browser is a developer-machine capability, so this whole route is
 * refused in production. It is additionally gated behind the existing admin auth, and
 * limited to superadmins because /settings/hero-review is a superadmin tool.
 */
function guard() {
    if (process.env.NODE_ENV === 'production') {
        return Response.json(
            { error: 'Review sessions need a local Chrome and are disabled in production.' },
            { status: 403 },
        )
    }
    return null
}

export async function GET(request) {
    const blocked = guard()
    if (blocked) return blocked

    const adminUser = await verifyAdminAuth(request)
    if (!adminUser) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (!isSuperAdmin(adminUser)) {
        return Response.json({ error: 'Only superadmins can review provider captures.' }, { status: 403 })
    }

    return Response.json({ success: true, sessions: listCaptureSessions() })
}

export async function POST(request) {
    const blocked = guard()
    if (blocked) return blocked

    const adminUser = await verifyAdminAuth(request)
    if (!adminUser) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (!isSuperAdmin(adminUser)) {
        return Response.json({ error: 'Only superadmins can review provider captures.' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const action = String(body?.action || '').trim()

    try {
        if (action === 'start') {
            const session = await startCaptureSession(String(body?.url || ''))
            return Response.json({ success: true, ...session })
        }

        if (action === 'capture') {
            const result = await commitCaptureSession(body?.sessionId, {
                provider: body?.provider,
                providerId: body?.providerId,
            })
            return Response.json({ success: true, ...result })
        }

        if (action === 'cancel') {
            const cancelled = await cancelCaptureSession(body?.sessionId)
            return Response.json({ success: true, cancelled })
        }

        return Response.json({ error: 'Unknown action' }, { status: 400 })
    } catch (error) {
        return Response.json(
            { success: false, error: error?.message || 'Capture session failed' },
            { status: 400 },
        )
    }
}
