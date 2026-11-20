import { NextResponse } from 'next/server'
import { verifyAdminToken, isSuperAdmin, unauthorizedResponse } from '@/lib/auth.js'
import { listAdminUsers, createAdminUser, normalizeAdminUserProfile } from '@/lib/adminUsers.js'
import { resolveAdminRoleAssignment } from '@/lib/adminRoles.js'

export async function GET(request) {
    const auth = request.headers.get('Authorization')
    if (!auth?.startsWith('Bearer ')) return unauthorizedResponse()

    const user = await verifyAdminToken(auth.replace('Bearer ', ''))
    if (!isSuperAdmin(user)) return unauthorizedResponse('Superadmin access required')

    try {
        const users = await listAdminUsers()
        return NextResponse.json({ users })
    } catch (error) {
        console.error('List admin users error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

export async function POST(request) {
    const auth = request.headers.get('Authorization')
    if (!auth?.startsWith('Bearer ')) return unauthorizedResponse()

    const user = await verifyAdminToken(auth.replace('Bearer ', ''))
    if (!isSuperAdmin(user)) return unauthorizedResponse('Superadmin access required')

    try {
        const { username, password, role, domain, email, timezone } = await request.json()

        if (!username || username.trim().length < 3) {
            return NextResponse.json({ error: 'Username must be at least 3 characters' }, { status: 400 })
        }
        if (!password || password.length < 6) {
            return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
        }

        const assignment = resolveAdminRoleAssignment({ role, domain })
        if (assignment.error) {
            return NextResponse.json({ error: assignment.error }, { status: 400 })
        }

        const profile = normalizeAdminUserProfile({ email, timezone })
        if (profile.error) {
            return NextResponse.json({ error: profile.error }, { status: 400 })
        }

        const newUser = await createAdminUser({
            username: username.trim(),
            password,
            role: assignment.role,
            domain: assignment.domain,
            email: profile.email,
            timezone: profile.timezone,
        })
        return NextResponse.json({ user: newUser }, { status: 201 })
    } catch (error) {
        console.error('Create admin user error:', error)
        // PostgreSQL unique violation = 23505
        if (error.code === '23505' || error.message?.includes('unique')) {
            return NextResponse.json({ error: 'Username already exists' }, { status: 409 })
        }
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
