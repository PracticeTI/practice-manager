import { NextResponse } from 'next/server'
import { SignJWT } from 'jose'
import { verifyAdminToken, isSuperAdmin, unauthorizedResponse } from '@/lib/auth.js'
import { listAdminUsers } from '@/lib/adminUsers.js'
import { normalizeSimulationDomain } from '@/lib/adminSimulationTargets.js'
import { ADMIN_ROLE_DOMAIN_ADMIN, normalizeAdminRole } from '@/lib/adminRoles.js'

const JWT_SECRET = new TextEncoder().encode(
    process.env.JWT_SECRET || 'your-secret-key-change-in-production'
)

async function issueToken(claims) {
    return new SignJWT(claims)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('24h')
        .sign(JWT_SECRET)
}

function setCookieOnResponse(response) {
    const isSecure = process.env.NODE_ENV === 'production'
    response.cookies.set('admin_presence_v1', '1', {
        path: '/',
        maxAge: 60 * 60 * 24,
        sameSite: 'lax',
        secure: isSecure,
        httpOnly: false,
    })
}

function normalizeDomain(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

/**
 * Resolve which identity the simulated session should carry.
 *
 * An explicit `username` must be a real admin user that administers the requested
 * domain, so a simulation cannot be minted with a scope it does not actually have.
 * Omitting it keeps the synthetic `sim-admin-<domain>` identity.
 */
async function resolveSimulatedUsername({ username, domain }) {
    const requestedUsername = String(username || '').trim()
    if (!requestedUsername) {
        return { username: `sim-admin-${domain}`, role: ADMIN_ROLE_DOMAIN_ADMIN }
    }

    const users = await listAdminUsers()
    const match = users.find((user) => String(user?.username || '').trim() === requestedUsername)

    if (!match) {
        return { error: `Admin user "${requestedUsername}" was not found`, status: 404 }
    }
    if (normalizeSimulationDomain(match.domain) !== domain) {
        return {
            error: `Admin user "${requestedUsername}" does not administer ${domain}`,
            status: 400,
        }
    }

    // Carry the target's role so role-gated features behave the same as a real
    // sign-in; the domain claim already keeps the session scoped.
    return { username: match.username, role: normalizeAdminRole(match.role) || ADMIN_ROLE_DOMAIN_ADMIN }
}

export async function POST(request) {
    const auth = request.headers.get('Authorization')
    if (!auth?.startsWith('Bearer ')) return unauthorizedResponse()

    const user = await verifyAdminToken(auth.replace('Bearer ', ''))
    if (!isSuperAdmin(user)) return unauthorizedResponse('Superadmin access required')

    try {
        const { domain, username } = await request.json()
        const normalizedDomain = normalizeDomain(domain)

        if (!normalizedDomain) {
            return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
        }

        const target = await resolveSimulatedUsername({ username, domain: normalizedDomain })
        if (target.error) {
            return NextResponse.json({ error: target.error }, { status: target.status })
        }

        const token = await issueToken({
            username: target.username,
            role: target.role || ADMIN_ROLE_DOMAIN_ADMIN,
            domain: normalizedDomain,
            simulated: true,
            simulated_by: user?.username || 'superadmin',
        })

        const response = NextResponse.json({ token, username: target.username, domain: normalizedDomain })
        setCookieOnResponse(response)
        return response
    } catch (error) {
        console.error('Simulate admin login error:', error)
        return NextResponse.json({ error: 'Failed to simulate admin user' }, { status: 500 })
    }
}