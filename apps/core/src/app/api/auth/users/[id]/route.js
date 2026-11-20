import { NextResponse } from 'next/server'
import { verifyAdminToken, isSuperAdmin, unauthorizedResponse } from '@/lib/auth.js'
import { deleteAdminUser, findAdminUserById, updateAdminUser, normalizeAdminUserProfile } from '@/lib/adminUsers.js'
import { resolveAdminRoleAssignment } from '@/lib/adminRoles.js'

async function requireSuperAdmin(request) {
    const auth = request.headers.get('Authorization')
    if (!auth?.startsWith('Bearer ')) return { response: unauthorizedResponse() }

    const user = await verifyAdminToken(auth.replace('Bearer ', ''))
    if (!isSuperAdmin(user)) return { response: unauthorizedResponse('Superadmin access required') }

    return { user }
}

function parseUserId(id) {
    const numericId = parseInt(id, 10)
    return Number.isNaN(numericId) ? null : numericId
}

export async function PATCH(request, { params }) {
    const guard = await requireSuperAdmin(request)
    if (guard.response) return guard.response

    try {
        const { id } = await params
        const numericId = parseUserId(id)
        if (numericId === null) {
            return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 })
        }

        const body = await request.json().catch(() => ({}))
        const profile = normalizeAdminUserProfile(body)
        if (profile.error) {
            return NextResponse.json({ error: profile.error }, { status: 400 })
        }

        const changesRole = Object.prototype.hasOwnProperty.call(body, 'role')
            || Object.prototype.hasOwnProperty.call(body, 'domain')
        if (!changesRole && Object.keys(profile).length === 0) {
            return NextResponse.json({ error: 'No profile fields to update' }, { status: 400 })
        }

        let fields = profile
        if (changesRole) {
            const currentUser = await findAdminUserById(numericId)
            if (!currentUser) {
                return NextResponse.json({ error: 'User not found' }, { status: 404 })
            }

            // The role decides whether a domain applies, so both are written as
            // one pair: a role that does not use a domain clears it.
            const assignment = resolveAdminRoleAssignment(body, currentUser)
            if (assignment.error) {
                return NextResponse.json({ error: assignment.error }, { status: 400 })
            }
            fields = { ...profile, role: assignment.role, domain: assignment.domain }
        }

        const updatedUser = await updateAdminUser(numericId, fields)
        if (!updatedUser) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 })
        }

        return NextResponse.json({ user: updatedUser })
    } catch (error) {
        console.error('Update admin user error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

export async function DELETE(request, { params }) {
    const guard = await requireSuperAdmin(request)
    if (guard.response) return guard.response

    try {
        const { id } = await params
        const numericId = parseUserId(id)
        if (numericId === null) {
            return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 })
        }

        const deleted = await deleteAdminUser(numericId)
        if (!deleted) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 })
        }
        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Delete admin user error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
