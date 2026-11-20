import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminAuth } from '@/lib/auth'
import {
    createProvider,
    getProviderAdminKey,
    listProviders,
} from '@/lib/providersStore'
import { providerHeroHostname } from '@/lib/providerHeroPreview'
import { readApprovedHeroes } from '@/lib/providerHeroReview'

export async function GET(request) {
    try {
        const adminUser = await verifyAdminAuth(request)
        const { searchParams } = new URL(request.url)
        const adminRequested = searchParams.get('admin') === '1'
        const includeUnpublished = adminRequested && Boolean(adminUser)
        const favoritesOnly = searchParams.get('favorites') === '1' && Boolean(adminUser)
        const viewerDomain = includeUnpublished && adminUser && !isSuperAdmin(adminUser) ? String(adminUser.domain || '') : ''
        const providers = await listProviders({
            adminKey: adminUser ? getProviderAdminKey(adminUser) : '',
            includeUnpublished,
            favoritesOnly,
            viewerDomain,
        })

        // The admin dashboard spotlights random provider website captures, so an admin
        // listing carries the approved hero image beside each record. The manifest is
        // keyed by bare hostname, exactly like the directory pages resolve their cards,
        // so the URL travels with the record and the client needs no extra lookup.
        if (!adminRequested) {
            return NextResponse.json({ success: true, providers })
        }

        const approvedHeroes = await readApprovedHeroes()
        const providersWithHeroes = providers.map((provider) => {
            const heroUrl = approvedHeroes[providerHeroHostname(provider.website_url)] || ''
            return heroUrl ? { ...provider, hero_url: heroUrl } : provider
        })

        return NextResponse.json({ success: true, providers: providersWithHeroes })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load providers' }, { status: 500 })
    }
}

export async function POST(request) {
    const adminUser = await verifyAdminAuth(request)
    if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    try {
        const provider = await createProvider(await request.json())
        return NextResponse.json({ success: true, provider }, { status: 201 })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to create provider' }, { status: 400 })
    }
}
