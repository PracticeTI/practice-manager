import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { ensureNdisCataloguePublished, ndisCatalogueStatus } from '@/lib/ndisCatalogueStore'
import { authorizeOperatorRequest } from '@/lib/serviceRouteAuth'

// The NDIS support catalogue's published copy.
//
// `ndisSupportCatalogue.js` is the seed; this route lets an operator or a deploy
// step push it into `system_settings`, where the worker service reads it. `GET`
// reports whether the two still agree, which is how drift is caught.
//
// Static segment under /api/database, so it cannot collide with a dynamic route.

export async function GET(request) {
    const access = await authorizeOperatorRequest(request)
    if (!access.ok) {
        return NextResponse.json({ success: false, error: access.error }, { status: 403 })
    }

    if (detectDatabaseType() !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    try {
        return NextResponse.json({ success: true, ...(await ndisCatalogueStatus()) })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to read the catalogue status' }, { status: 500 })
    }
}

export async function POST(request) {
    const access = await authorizeOperatorRequest(request)
    if (!access.ok) {
        return NextResponse.json({ success: false, error: access.error }, { status: 403 })
    }

    if (detectDatabaseType() !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    try {
        const payload = await request.json().catch(() => ({}))
        const result = await ensureNdisCataloguePublished({ force: payload?.force === true })

        return NextResponse.json({
            success: true,
            via: access.via,
            published: result.published,
            reason: result.reason,
            codeHash: result.codeHash,
            storedHash: result.storedHash,
            catalogue: {
                period: result.snapshot?.period,
                effectiveFrom: result.snapshot?.effectiveFrom,
                itemCount: Array.isArray(result.snapshot?.items) ? result.snapshot.items.length : 0,
                contentHash: result.snapshot?.contentHash,
            },
        })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to publish the catalogue' }, { status: 500 })
    }
}
