/**
 * Authentication utilities for the practice core
 */

import { NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { resolveBypassAdmin } from '@/lib/adminBypassTokens'
import { recordBypassUse } from '@/lib/adminBypassAudit'

const JWT_SECRET = new TextEncoder().encode(
    process.env.JWT_SECRET || 'your-secret-key-change-in-production'
)

const SERVICE_SHARED_SECRET = process.env.PLUGIN_SIGNING_SECRET || null

/**
 * Verify JWT token from admin login
 */
export async function verifyJwt(token) {
    try {
        const { payload } = await jwtVerify(token, JWT_SECRET)
        return payload
    } catch (error) {
        console.error('JWT verification failed:', error)
        return null
    }
}

/**
 * Verify Authorization header for admin routes
 */
export async function verifyAdminAuth(request) {
    const auth = request.headers.get('Authorization')
    if (!auth || !auth.startsWith('Bearer ')) {
        return null
    }

    const token = auth.replace('Bearer ', '')
    return verifyAdminToken(token, {
        path: request.nextUrl?.pathname,
        method: request.method,
        host: request.headers.get('x-forwarded-host') || request.headers.get('host'),
    })
}

/**
 * Verify service-to-service authentication from domain backends
 */
export function verifyServiceAuth(request) {
    if (!SERVICE_SHARED_SECRET) {
        return false
    }

    const auth = request.headers.get('Authorization')
    if (!auth || !auth.startsWith('Bearer ')) {
        return false
    }

    const token = auth.replace('Bearer ', '')
    return token === SERVICE_SHARED_SECRET
}

/**
 * Create unauthorized response
 */
export function unauthorizedResponse(message = 'Unauthorized') {
    return NextResponse.json(
        { error: message },
        { status: 401 }
    )
}

/**
 * Middleware wrapper for admin-protected routes
 */
export function withAdminAuth(handler) {
    return async function (request, context) {
        const user = await verifyAdminAuth(request)
        if (!user) {
            return unauthorizedResponse('Invalid or missing auth token')
        }

        // Add user to request context
        request.user = user
        return handler(request, context)
    }
}

/**
 * Middleware wrapper for service-protected routes  
 */
export function withServiceAuth(handler) {
    return async function (request, context) {
        if (!verifyServiceAuth(request)) {
            return unauthorizedResponse('Invalid service credentials')
        }

        return handler(request, context)
    }
}

/**
 * Verify an admin bearer token.
 *
 * `context` is only used for the bypass audit line, so call sites that do not
 * have a request to describe can omit it.
 */
export async function verifyAdminToken(token, context = {}) {
    const normalizedToken = typeof token === 'string' ? token.trim() : ''
    if (!normalizedToken) {
        return null
    }

    const bypassUser = resolveBypassAdmin(normalizedToken)
    if (bypassUser) {
        recordBypassUse(bypassUser, context)
        return bypassUser
    }

    return verifyJwt(normalizedToken)
}

function getConfiguredSuperAdminUsername() {
    const configuredUsername = typeof process.env.ADMIN_USERNAME === 'string'
        ? process.env.ADMIN_USERNAME.trim()
        : ''

    return configuredUsername || null
}

/**
 * Return true if the resolved user has superadmin privileges.
 */
export function isSuperAdmin(user) {
    if (!user) return false
    if (user.role === 'superadmin') return true

    // A scoped bypass must never be promoted by matching ADMIN_USERNAME.
    if (user.bypass) return false

    const configuredSuperAdminUsername = getConfiguredSuperAdminUsername()
    if (!configuredSuperAdminUsername || !user.username) return false

    return user.username.trim().toLowerCase() === configuredSuperAdminUsername.toLowerCase()
}

/**
 * Return true if the resolved user may administer the given hostname.
 *
 * - superadmin: always true
 * - admin: true when the hostname contains the user's assigned domain string
 *   (e.g. domain='acme' matches 'acme.local' and 'www.acme.com.au')
 */
export function canAccessDomain(user, hostname) {
    if (!user) return false
    if (user.role === 'superadmin') return true
    if (!user.domain || !hostname) return false
    return hostname.toLowerCase().includes(user.domain.toLowerCase())
}