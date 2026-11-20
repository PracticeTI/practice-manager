import { NextResponse } from 'next/server'
import { DEFAULT_DOMAIN_MODE, getDomainLabel, VALID_DOMAIN_MODES } from '@/lib/domainMode'
import { getPrivateDomainFieldMap } from '@/lib/domainExtension'

export const dynamic = 'force-dynamic'

const MODE_THEME = {
    default: { bg: '#2563eb', fg: '#ffffff' },
    ...getPrivateDomainFieldMap('brandingIconColors'),
}

function normalizeMode(mode) {
    if (!mode || typeof mode !== 'string') return DEFAULT_DOMAIN_MODE
    const normalized = mode.trim().toLowerCase()
    return VALID_DOMAIN_MODES.includes(normalized) ? normalized : DEFAULT_DOMAIN_MODE
}

export async function GET(request) {
    const { searchParams } = new URL(request.url)
    const mode = normalizeMode(searchParams.get('mode'))
    const label = getDomainLabel(mode)
    const initials = (label.match(/[A-Z]/g) || ['S']).join('').slice(0, 2)
    const theme = MODE_THEME[mode] || MODE_THEME[DEFAULT_DOMAIN_MODE] || MODE_THEME.default

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" role="img" aria-label="${label}">
  <rect width="64" height="64" rx="14" fill="${theme.bg}"/>
  <text x="32" y="41" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="${theme.fg}">${initials}</text>
</svg>`

    return new NextResponse(svg, {
        headers: {
            'Content-Type': 'image/svg+xml; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
        },
    })
}
