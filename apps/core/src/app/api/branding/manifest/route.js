import { NextResponse } from 'next/server'
import { DEFAULT_DOMAIN_MODE, getDomainLabel, VALID_DOMAIN_MODES } from '@/lib/domainMode'
import { resolveBrandManifestIcons } from '@/lib/brandingIcons'

export const dynamic = 'force-dynamic'

function normalizeMode(mode) {
    if (!mode || typeof mode !== 'string') return DEFAULT_DOMAIN_MODE
    const normalized = mode.trim().toLowerCase()
    return VALID_DOMAIN_MODES.includes(normalized) ? normalized : DEFAULT_DOMAIN_MODE
}

export async function GET(request) {
    const { searchParams } = new URL(request.url)
    const mode = normalizeMode(searchParams.get('mode'))
    const label = getDomainLabel(mode)

    const manifest = {
        name: label,
        short_name: label,
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#111827',
        icons: resolveBrandManifestIcons(mode),
    }

    return NextResponse.json(manifest, {
        headers: {
            'Content-Type': 'application/manifest+json; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
        },
    })
}
