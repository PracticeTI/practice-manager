import { NextResponse } from 'next/server'
import { verifyAdminAuth } from '@/lib/auth'
import { listEquipmentSuppliers } from '@/lib/equipmentStore'
import { equipmentMatchReason, equipmentMatchScore, equipmentTermFrequency } from '@/lib/equipmentDirectory'

const DEFAULT_LIMIT = 3
const MAX_LIMIT = 10

export async function GET(request) {
    const adminUser = await verifyAdminAuth(request)
    if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const query = String(searchParams.get('q') || '').trim()
    if (!query) return NextResponse.json({ success: false, error: 'q is required' }, { status: 400 })

    const parsedLimit = Number.parseInt(String(searchParams.get('limit') || ''), 10)
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, MAX_LIMIT) : DEFAULT_LIMIT
    const emailOnly = searchParams.get('email_only') !== '0'

    try {
        const suppliers = await listEquipmentSuppliers({ includeUnpublished: false })
        const candidates = suppliers.filter((supplier) => !emailOnly || Boolean(supplier.email))
        const total = candidates.length
        const termFrequency = equipmentTermFrequency(candidates, query)
        const matches = candidates
            .map((supplier) => ({ supplier, score: equipmentMatchScore(supplier, query, { termFrequency, total }) }))
            .filter(({ score }) => score > 0)
            .sort((left, right) => right.score - left.score
                || right.supplier.favorite_count - left.supplier.favorite_count
                || left.supplier.supplier.localeCompare(right.supplier.supplier))
            .slice(0, limit)
            .map(({ supplier, score }) => ({
                id: supplier.id,
                supplier: supplier.supplier,
                description: supplier.description,
                email: supplier.email,
                phone: supplier.phone,
                website_url: supplier.website_url,
                equipment_categories: supplier.equipment_categories,
                product_types: supplier.product_types,
                funding: supplier.funding,
                quotes: supplier.quotes,
                typical_response_time: supplier.typical_response_time,
                score,
                match_reason: equipmentMatchReason(supplier, query),
            }))

        return NextResponse.json({ success: true, query, suppliers: matches })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to match suppliers' }, { status: 500 })
    }
}
