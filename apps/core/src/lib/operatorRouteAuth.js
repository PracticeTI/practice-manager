/**
 * Gate for operator-only maintenance routes (schema migrations, bulk writes).
 *
 * These endpoints run DDL and destructive statements, so they are open to no one
 * but a superadmin — or a peer service holding the shared service secret, which
 * is how migration tooling calls them.
 *
 * The existing routes each hand-rolled a check, and most had none at all:
 * `POST /api/database/migrate/drop-old-tables` dropped tables for any anonymous
 * caller. One helper keeps the rule in a single place.
 */

import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminAuth, verifyServiceAuth } from '@/lib/auth'

/**
 * @param {Request} request
 * @returns {Promise<{user?: object, service?: boolean, response?: NextResponse}>}
 */
export async function requireOperatorAuth(request) {
    if (verifyServiceAuth(request)) {
        return { service: true }
    }

    const user = await verifyAdminAuth(request)
    if (!user) {
        return { response: NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }) }
    }

    if (!isSuperAdmin(user)) {
        return { response: NextResponse.json({ success: false, error: 'Forbidden: superadmin required' }, { status: 403 }) }
    }

    return { user }
}

/**
 * Gate for read-only posture and status routes.
 *
 * These routes answer any signed-in admin: the payloads carry no tenant data or
 * credentials. A route with a narrower audience applies its own check after this
 * one — `GET /api/database/rls-check` additionally requires a superadmin or a
 * simulated admin session (see `lib/rlsPanelAccess.js`). Routes that expose
 * connection strings or mutate configuration use `requireOperatorAuth` instead.
 */
export async function requireAdminAuth(request) {
    const user = await verifyAdminAuth(request)
    if (!user) {
        return { response: NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }) }
    }

    return { user }
}
