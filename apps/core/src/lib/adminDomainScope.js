import { isSuperAdmin, verifyAdminToken } from '@/lib/auth'
import { selectAdminDomainScope } from '@/lib/adminDomainScopePolicy'

export async function resolveAdminDomainScope(request, requestedDomain) {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : ''
    const adminUser = token
        ? await verifyAdminToken(token, {
            path: request.nextUrl?.pathname,
            method: request.method,
            host: request.headers.get('x-forwarded-host') || request.headers.get('host'),
        })
        : null
    return selectAdminDomainScope(adminUser, requestedDomain, isSuperAdmin(adminUser))
}