import { NextResponse } from 'next/server'
import { getSystemStateValue, setSystemStateValue } from '@/lib/systemState'

const COMPANY_IMAGE_SEARCH_SERVICE_KEY = 'company_image_search_service'
const VALID_SERVICES = new Set(['wikimedia', 'brave'])

export async function GET() {
    try {
        const stored = await getSystemStateValue(COMPANY_IMAGE_SEARCH_SERVICE_KEY)
        const normalized = typeof stored === 'string' ? stored.trim().toLowerCase() : null

        if (normalized && VALID_SERVICES.has(normalized)) {
            return NextResponse.json({
                success: true,
                service: normalized,
                source: 'system_settings'
            })
        }

        return NextResponse.json({
            success: true,
            service: 'wikimedia',
            source: 'default'
        })
    } catch (error) {
        return NextResponse.json(
            { error: error?.message || 'Failed to load company image search service' },
            { status: 500 }
        )
    }
}

export async function PATCH(request) {
    try {
        const { service } = await request.json()

        const normalized = typeof service === 'string' ? service.trim().toLowerCase() : ''
        if (!VALID_SERVICES.has(normalized)) {
            return NextResponse.json({ error: 'service must be one of: wikimedia, brave' }, { status: 400 })
        }

        const saved = await setSystemStateValue(COMPANY_IMAGE_SEARCH_SERVICE_KEY, normalized)
        if (!saved) {
            return NextResponse.json({ error: 'Failed to save company image search service' }, { status: 500 })
        }

        return NextResponse.json({ success: true, service: normalized })
    } catch (error) {
        return NextResponse.json(
            { error: error?.message || 'Failed to update company image search service' },
            { status: 500 }
        )
    }
}
