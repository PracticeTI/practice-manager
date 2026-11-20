import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminAuth } from '@/lib/auth'
import { createProvider, listProviders } from '@/lib/providersStore'
import { findNewProviderCandidates, isBraveSearchConfigured } from '@/lib/providersWebSearch'

const MAX_QUERY_LENGTH = 120

function hostnameOf(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
    } catch {
        return ''
    }
}

export async function POST(request) {
    const adminUser = await verifyAdminAuth(request)
    if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (isSuperAdmin(adminUser)) {
        return NextResponse.json({ error: 'Superadmins review and hard-add admin-added providers instead of searching the web' }, { status: 403 })
    }

    const adminDomain = String(adminUser.domain || '').trim()
    if (!adminDomain) {
        return NextResponse.json({ error: 'Admin account is missing a domain assignment' }, { status: 400 })
    }

    if (!isBraveSearchConfigured()) {
        return NextResponse.json({ error: 'Web search is not configured (missing BRAVE_API_KEY)' }, { status: 503 })
    }

    const body = await request.json().catch(() => ({}))
    const query = String(body?.query || '').trim().slice(0, MAX_QUERY_LENGTH)
    if (!query) {
        return NextResponse.json({ error: 'A search query is required' }, { status: 400 })
    }

    try {
        const existingProviders = await listProviders({ includeUnpublished: true })
        const existingHostnames = new Set(existingProviders.map((provider) => hostnameOf(provider.website_url)).filter(Boolean))

        const candidates = await findNewProviderCandidates(query, existingHostnames)
        const added = []
        for (const candidate of candidates) {
            try {
                // New records sourced via web search are scoped to the adding admin's domain until a superadmin hard-adds them.
                const provider = await createProvider({ ...candidate, status: 'admin_added', domain: adminDomain })
                added.push(provider)
            } catch {
                // Skip candidates that fail to persist (e.g. transient DB error) rather than fail the whole search.
            }
        }

        return NextResponse.json({ success: true, added, addedCount: added.length })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Web search failed' }, { status: 500 })
    }
}
