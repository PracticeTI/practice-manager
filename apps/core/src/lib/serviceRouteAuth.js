// Shared authorisation for the operator/maintenance routes that keep the
// platform's shared runtime data in step (the Quote Writer queue drain, the NDIS
// catalogue publisher).
//
// These routes are called by a scheduler or an operator, never by a practitioner,
// so they accept, in order:
//   1. the service-to-service shared secret (a scheduler or the worker service),
//   2. a superadmin admin token,
//   3. nothing — but only outside production, so local dev tools keep working
//      while a deployed environment can never be driven by an anonymous caller.

import { isSuperAdmin, verifyAdminToken, verifyServiceAuth } from '@/lib/auth'

export async function authorizeOperatorRequest(request) {
    if (verifyServiceAuth(request)) {
        return { ok: true, via: 'service' }
    }

    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : ''
    if (token) {
        const user = await verifyAdminToken(token)
        if (user && isSuperAdmin(user)) {
            return { ok: true, via: 'superadmin' }
        }
    }

    if (process.env.NODE_ENV !== 'production') {
        return { ok: true, via: 'local-dev' }
    }

    return { ok: false, via: null, error: 'Superadmin access required' }
}
