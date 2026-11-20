import { NextResponse } from 'next/server'
import { getDomainSetting } from '@/lib/appSettings'
import { DEFAULT_DOMAIN_MODE, getDomainLabel, VALID_DOMAIN_MODES } from '@/lib/domainMode'

function normalizeMode(value) {
    const normalized = String(value || '').trim().toLowerCase()
    return VALID_DOMAIN_MODES.includes(normalized) ? normalized : DEFAULT_DOMAIN_MODE
}

function decodePngDataUrl(value) {
    const normalized = String(value || '').trim()
    if (!normalized.startsWith('data:image/png;base64,')) return null

    const base64 = normalized.slice('data:image/png;base64,'.length)
    if (!base64) return null

    try {
        const buffer = Buffer.from(base64, 'base64')
        if (!buffer || buffer.length === 0) return null
        return buffer
    } catch {
        return null
    }
}

function buildFallbackSvg(mode) {
    const label = getDomainLabel(mode)
    const title = `${label} Preview`
    const escapedTitle = title
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${escapedTitle}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a" />
      <stop offset="100%" stop-color="#1d4ed8" />
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="1200" height="630" fill="url(#bg)" />
  <rect x="48" y="48" width="1104" height="534" rx="20" ry="20" fill="rgba(255,255,255,0.08)" />
  <text x="80" y="308" fill="#ffffff" font-family="Arial, sans-serif" font-size="72" font-weight="700">${escapedTitle}</text>
</svg>`
}

export async function GET(request) {
    const searchParams = request.nextUrl.searchParams
    const mode = normalizeMode(searchParams.get('mode'))
    const state = await getDomainSetting(mode, 'hero_thumbnail')
    if (state) {
        const bytes = decodePngDataUrl(state?.imageDataUrl)
        if (bytes) {
            return new NextResponse(bytes, {
                headers: {
                    'content-type': 'image/png',
                    'cache-control': 'public, max-age=300, s-maxage=900',
                    'content-disposition': 'inline; filename="og-image.png"',
                },
            })
        }
    }

    const svg = buildFallbackSvg(mode)
    return new NextResponse(svg, {
        headers: {
            'content-type': 'image/svg+xml; charset=utf-8',
            'cache-control': 'public, max-age=300, s-maxage=900',
            'content-disposition': 'inline; filename="og-image.svg"',
        },
    })
}
