import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminToken } from '@/lib/auth'

const TOP_VENDOR_ORDER = ['Open AI', 'Claude', 'Google', 'DeepSeek']

function normalizeVendorName(value) {
    return String(value || '').trim()
}

function getAdminTokenFromRequest(request) {
    const authHeader = request.headers.get('authorization') || ''
    if (!authHeader.startsWith('Bearer ')) return ''
    return authHeader.slice('Bearer '.length).trim()
}

function toVendorKey(value) {
    const normalized = normalizeVendorName(value).toLowerCase()
    if (!normalized) return ''
    return normalized
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '')
}

function buildVendorGroups() {
    const vendors = TOP_VENDOR_ORDER.map((name) => ({
        name,
        key: toVendorKey(name),
        count: 1
    }))

    return { quick: vendors, advanced: [], all: vendors }
}

export async function GET(request) {
    try {
        const adminToken = getAdminTokenFromRequest(request)
        const adminUser = await verifyAdminToken(adminToken)
        if (!adminUser) {
            return NextResponse.json({ error: 'Unauthorized: valid admin token required' }, { status: 401 })
        }

        if (!isSuperAdmin(adminUser) && !String(adminUser?.domain || '').trim()) {
            return NextResponse.json({ error: 'Unauthorized: admin domain scope required' }, { status: 403 })
        }

        const vendors = buildVendorGroups()

        return NextResponse.json({
            success: true,
            vendors,
            models: [],
        })
    } catch (error) {
        return NextResponse.json({ error: error?.message || 'Failed to load report model catalog' }, { status: 500 })
    }
}
