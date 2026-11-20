import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminAuth } from '@/lib/auth'
import { createFunder, listFunders } from '@/lib/fundersStore'

/**
 * Funders — the funding bodies and the published documentation the platform
 * relies on.
 *
 * Reference data, so the list is shared by every domain. **Reads** are open to any
 * admin session (the `/admin/funders` library); **writes** are superadmin-only,
 * because a domain admin treats this as read-only reference material. The data is
 * maintained in `src/lib/funderRegistry.js` and by the link-check tooling.
 */
export async function GET(request) {
    const adminUser = await verifyAdminAuth(request)
    if (!adminUser) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const { searchParams } = new URL(request.url)
        // `includeAll=0` hides unpublished funders/documents; the admin UI asks for
        // everything so a draft record is still editable.
        const includeUnpublished = searchParams.get('includeAll') !== '0'
        const funders = await listFunders({ includeUnpublished })
        return NextResponse.json({ success: true, funders })
    } catch (error) {
        return NextResponse.json(
            { success: false, error: error?.message || 'Failed to load funders' },
            { status: 500 }
        )
    }
}

export async function POST(request) {
    const adminUser = await verifyAdminAuth(request)
    if (!adminUser) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }
    if (!isSuperAdmin(adminUser)) {
        return NextResponse.json({ success: false, error: 'Superadmin access required' }, { status: 403 })
    }

    try {
        const body = await request.json().catch(() => ({}))
        const funder = await createFunder(body)
        return NextResponse.json({ success: true, funder }, { status: 201 })
    } catch (error) {
        return NextResponse.json(
            { success: false, error: error?.message || 'Failed to create funder' },
            { status: 400 }
        )
    }
}
