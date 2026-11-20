import { NextResponse } from 'next/server'
import { resolveDomainArtwork } from '@/lib/templateLibraryServer'

export const runtime = 'nodejs'

/**
 * Resolves a domain's worker / assistant artwork and redirects to the file.
 *
 * A domain override (`public/allied-health/domains/<domain>/<file>`) wins over the
 * shared practice-type folder (`public/allied-health/<OT|physio|speech>/<file>`).
 *
 * Deliberately unauthenticated: it backs plain `<img>` tags, which cannot send an
 * Authorization header. It only ever serves the fixed artwork file names from the
 * `public/allied-health` tree, and every candidate path is re-validated against the
 * public directory before it is used.
 *
 * The redirect carries a relative `Location` so the artwork is always fetched from the
 * host the caller used. An absolute URL built from `request.url` carries the server's
 * own origin instead, which differs from the request host whenever the app is served on
 * a mapped subdomain (e.g. `mybrand.localhost:3000` -> `localhost:3000`); the
 * follow-up request then becomes cross-origin and the CORS probe is blocked.
 */
export async function GET(request) {
    const { searchParams } = new URL(request.url)
    const resolved = await resolveDomainArtwork(
        searchParams.get('domain'),
        searchParams.get('art')
    )

    if (!resolved) {
        return new NextResponse(null, { status: 404 })
    }

    return new NextResponse(null, {
        status: 307,
        headers: {
            Location: resolved.url,
            'Cache-Control': 'public, max-age=300',
        },
    })
}
