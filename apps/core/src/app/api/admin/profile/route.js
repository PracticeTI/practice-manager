import { NextResponse } from 'next/server'
import { verifyAdminToken, unauthorizedResponse } from '@/lib/auth.js'
import { findAdminUserByUsername, updateAdminUser, normalizeAdminUserProfile } from '@/lib/adminUsers.js'

/**
 * User-level settings for the signed-in admin.
 *
 * A database-managed admin may read and edit their own contact details (email and
 * timezone) here. The record is resolved from the verified token's username, never
 * from the request, so this route can only ever touch the caller's own row.
 *
 * Role, domain, and every other admin's record stay in the superadmin-only
 * `/api/auth/users` routes. Domain-level configuration stays in `/api/settings/*`.
 */

function isPresent(source, key) {
    return Object.prototype.hasOwnProperty.call(source, key)
}

async function resolveProfileRecord(request) {
    const auth = request.headers.get('Authorization')
    if (!auth?.startsWith('Bearer ')) return { response: unauthorizedResponse() }

    const user = await verifyAdminToken(auth.replace('Bearer ', ''))
    if (!user) return { response: unauthorizedResponse('Invalid or missing auth token') }

    const username = typeof user.username === 'string' ? user.username.trim() : ''
    if (!username) return { error: 'This session has no stored profile', status: 404 }

    // The primary superadmin (ADMIN_USERNAME / ADMIN_PASSWORD) and the bypass
    // principals authenticate without an `admin_users` row.
    const record = await findAdminUserByUsername(username)
    if (!record) return { error: 'This session has no stored profile', status: 404 }

    return { user, record }
}

function toProfile(record) {
    return {
        username: record.username,
        role: record.role,
        domain: record.domain,
        email: record.email,
        timezone: record.timezone,
        created_at: record.created_at,
    }
}

export async function GET(request) {
    try {
        const resolved = await resolveProfileRecord(request)
        if (resolved.response) return resolved.response
        if (resolved.error) {
            return NextResponse.json({ error: resolved.error }, { status: resolved.status })
        }

        return NextResponse.json({ profile: toProfile(resolved.record) })
    } catch (error) {
        console.error('Load admin profile error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

export async function PATCH(request) {
    try {
        const resolved = await resolveProfileRecord(request)
        if (resolved.response) return resolved.response
        if (resolved.error) {
            return NextResponse.json({ error: resolved.error }, { status: resolved.status })
        }

        const body = await request.json().catch(() => ({}))
        const input = {}
        if (isPresent(body, 'email')) input.email = body.email
        if (isPresent(body, 'timezone')) input.timezone = body.timezone

        const profile = normalizeAdminUserProfile(input)
        if (profile.error) {
            return NextResponse.json({ error: profile.error }, { status: 400 })
        }
        if (Object.keys(profile).length === 0) {
            return NextResponse.json({ error: 'No profile fields to update' }, { status: 400 })
        }

        const updated = await updateAdminUser(resolved.record.id, profile)
        if (!updated) {
            return NextResponse.json({ error: 'This session has no stored profile' }, { status: 404 })
        }

        return NextResponse.json({ profile: toProfile(updated) })
    } catch (error) {
        console.error('Update admin profile error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
