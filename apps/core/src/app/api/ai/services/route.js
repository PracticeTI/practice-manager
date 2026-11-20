import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminToken } from '@/lib/auth'
import {
    AI_SERVICE_KEYS,
    AI_SERVICE_META,
    getServiceProviderOptions,
    normalizeAiServiceSettings,
} from '@/lib/ai/services'
import { getAiProviderApiKeyAvailability } from '@/lib/ai/credentials'
import { readAiServiceSettings, writeAiServiceSettings } from '@/lib/ai/serviceSettings'

function getAdminTokenFromRequest(request) {
    const authHeader = request.headers.get('authorization') || ''
    if (!authHeader.startsWith('Bearer ')) return ''
    return authHeader.slice('Bearer '.length).trim()
}

function buildResponse(services) {
    return {
        success: true,
        services,
        keyAvailability: getAiProviderApiKeyAvailability(),
        options: Object.fromEntries(
            AI_SERVICE_KEYS.map((service) => [service, getServiceProviderOptions(service)])
        ),
        meta: AI_SERVICE_META,
    }
}

export async function GET(request) {
    try {
        const adminUser = await verifyAdminToken(getAdminTokenFromRequest(request))
        if (!adminUser) {
            return NextResponse.json({ error: 'Unauthorized: valid admin token required' }, { status: 401 })
        }

        const services = await readAiServiceSettings()
        return NextResponse.json({
            ...buildResponse(services),
            canEdit: isSuperAdmin(adminUser),
        })
    } catch (error) {
        return NextResponse.json(
            { error: error?.message || 'Failed to load AI service settings' },
            { status: 500 }
        )
    }
}

export async function PATCH(request) {
    try {
        const body = await request.json().catch(() => ({}))
        const token = typeof body?.adminToken === 'string' && body.adminToken.trim()
            ? body.adminToken.trim()
            : getAdminTokenFromRequest(request)

        const adminUser = await verifyAdminToken(token)
        if (!adminUser || !isSuperAdmin(adminUser)) {
            return NextResponse.json({ error: 'Unauthorized: superadmin required' }, { status: 401 })
        }

        const incoming = body?.services
        if (!incoming || typeof incoming !== 'object') {
            return NextResponse.json({ error: 'services object is required' }, { status: 400 })
        }

        const unknown = Object.keys(incoming).filter((key) => !AI_SERVICE_KEYS.includes(key))
        if (unknown.length > 0) {
            return NextResponse.json(
                { error: `Unknown service(s): ${unknown.join(', ')}` },
                { status: 400 }
            )
        }

        const existing = await readAiServiceSettings()
        const merged = normalizeAiServiceSettings({
            ...existing,
            ...incoming,
        })
        const saved = await writeAiServiceSettings(merged)

        if (!saved.success) {
            return NextResponse.json({ error: 'Failed to save AI service settings' }, { status: 500 })
        }

        return NextResponse.json(buildResponse(saved.services))
    } catch (error) {
        return NextResponse.json(
            { error: error?.message || 'Failed to update AI service settings' },
            { status: 500 }
        )
    }
}
