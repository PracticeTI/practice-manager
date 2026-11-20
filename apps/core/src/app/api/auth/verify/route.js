import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminToken } from '@/lib/auth.js'

export async function POST(request) {
    /**
     * Verify authentication for external services like WIT.
     * 
     * Accepts:
     * - JWT tokens from admin login (Bearer <jwt>)
     * - Service credentials (Bearer <shared_secret>)
     * 
     * Returns user info if valid, 401 if invalid.
     */
    try {
        const auth = request.headers.get('Authorization')
        if (!auth || !auth.startsWith('Bearer ')) {
            return NextResponse.json({ error: 'Missing Authorization header' }, { status: 401 })
        }

        const token = auth.replace('Bearer ', '')

        // Try JWT or bypass-token verification first
        const user = await verifyAdminToken(token)
        if (user) {
            return NextResponse.json({
                ok: true,
                user: {
                    username: user.username,
                    role: user.role || 'user',
                    is_superuser: isSuperAdmin(user) || user.is_superuser === true,
                },
            })
        }

        // Try service secret verification (for WIT and other services)
        const witSecret = process.env.WIT_API_SECRET
        if (witSecret && token === witSecret) {
            return NextResponse.json({
                ok: true,
                service: 'wit',
                authenticated: true,
            })
        }

        // If neither worked, return 401
        return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
    } catch (error) {
        console.error('Auth verification error:', error)
        return NextResponse.json({ error: 'Authentication verification failed' }, { status: 500 })
    }
}
