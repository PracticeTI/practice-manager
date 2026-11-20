import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminToken } from '@/lib/auth'
import { listTemplateImageLibrary } from '@/lib/templateLibraryServer'

export const runtime = 'nodejs'

function normalizeDomainKey(value) {
    return String(value || '').trim().toLowerCase()
}

function getAdminTokenFromRequest(request) {
    const authHeader = request.headers.get('authorization') || ''
    if (authHeader.startsWith('Bearer ')) {
        return authHeader.slice('Bearer '.length).trim()
    }
    return ''
}

function resolveScopedDomain(adminUser, requestedDomain) {
    const requested = normalizeDomainKey(requestedDomain)

    if (isSuperAdmin(adminUser)) {
        return requested
    }

    const scopedDomain = normalizeDomainKey(adminUser?.domain)
    if (!scopedDomain) return ''

    if (requested && requested !== scopedDomain) {
        return null
    }

    return scopedDomain
}

export async function GET(request) {
    try {
        const token = getAdminTokenFromRequest(request)
        const adminUser = await verifyAdminToken(token)
        if (!adminUser) {
            return NextResponse.json({ error: 'Unauthorized: valid admin token required' }, { status: 401 })
        }

        const requestUrl = new URL(request.url)
        const domain = resolveScopedDomain(adminUser, requestUrl.searchParams.get('domain'))
        if (domain === null) {
            return NextResponse.json({ error: 'Forbidden: cannot list template images for requested domain' }, { status: 403 })
        }
        if (!domain) {
            return NextResponse.json({ error: 'domain is required' }, { status: 400 })
        }

        // Images are the union of the domain's practice-type assets (e.g. the shared
        // Occupational Therapy folder) and its own domain assets, so an admin can
        // insert either when editing a template.
        const { practiceType, groups, items } = await listTemplateImageLibrary(domain)

        return NextResponse.json({ success: true, domain, practiceType, groups, items })
    } catch (error) {
        return NextResponse.json({ error: error?.message || 'Failed to list template images' }, { status: 500 })
    }
}
