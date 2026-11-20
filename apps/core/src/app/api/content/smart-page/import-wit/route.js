import { NextResponse } from 'next/server'

/**
 * POST /api/content/smart-page/import-wit
 * Import a WIT payload from a URL or file path
 */
export async function POST(request) {
    try {
        const incomingAuth = request.headers.get('authorization') || ''
        const body = await request.json()
        const { witUrl } = body

        if (!witUrl || !witUrl.trim()) {
            return NextResponse.json(
                { error: 'WIT URL is required' },
                { status: 400 }
            )
        }

        const url = String(witUrl).trim()

        // Handle both absolute URLs and relative paths
        let fetchUrl = url
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            // Relative path - construct full URL to local WIT or similar service
            // For now, assume it's a relative path within the app domain
            const baseUrl = new URL(request.url).origin
            fetchUrl = `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`
        }

        // Backward compatibility: convert legacy export file URL format
        // /api/exports/<domain>/refinement_<id>/<legacy>_ready.json
        // (`wordscout` is a retired artifact name, kept for imported history)
        // to current API route format: /api/exports/<domain>/<id>
        try {
            const parsed = new URL(fetchUrl)
            const legacy = parsed.pathname.match(
                /^\/api\/exports\/([^/]+)\/refinement_(\d+)\/(wordscout|practice|unified)_ready\.json$/
            )
            if (legacy) {
                const [, domain, refinementId] = legacy
                parsed.pathname = `/api/exports/${domain}/${refinementId}`
                fetchUrl = parsed.toString()
            }
        } catch {
            // Ignore URL parse errors and use fetchUrl as-is.
        }

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 10000)

        // Prefer a dedicated service secret for WIT fetches. If it's not set,
        // fall back to the caller's Bearer token (admin JWT) when available.
        const witServiceSecret = (process.env.WIT_API_SECRET || '').trim()
        const outboundAuthHeader = witServiceSecret
            ? `Bearer ${witServiceSecret}`
            : (incomingAuth.startsWith('Bearer ') ? incomingAuth : '')

        try {
            const headers = { 'Accept': 'application/json' }
            if (outboundAuthHeader) {
                headers.Authorization = outboundAuthHeader
            }

            const response = await fetch(fetchUrl, {
                method: 'GET',
                headers,
                signal: controller.signal,
            })

            clearTimeout(timeout)

            if (!response.ok) {
                const responseText = await response.text().catch(() => '')
                const suffix = responseText ? ` - ${responseText.slice(0, 300)}` : ''
                throw new Error(`Failed to fetch WIT payload: HTTP ${response.status}${suffix}`)
            }

            const payload = await response.json()

            // Validate basic structure
            if (!payload || typeof payload !== 'object') {
                throw new Error('Invalid WIT payload structure')
            }

            return NextResponse.json({
                success: true,
                payload: payload,
            })
        } catch (err) {
            clearTimeout(timeout)
            if (err.name === 'AbortError') {
                throw new Error('Fetch timeout')
            }
            throw err
        }
    } catch (error) {
        console.error('WIT import error:', error)
        return NextResponse.json(
            { error: error?.message || 'Failed to import WIT payload' },
            { status: 500 }
        )
    }
}
