import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminToken } from '@/lib/auth'
import {
    REPORT_AI_PROVIDER_KEYS,
    REPORT_AI_TIER_KEYS,
    getReportAiProviderDisplayName,
    normalizeReportAiProvider,
    normalizeReportAiTier,
} from '@/lib/reportAiProviders'
import {
    buildProviderTierOptions,
    readAiProviderModelCatalog,
    writeAiProviderModelCatalog,
} from '@/lib/aiProviderModelCatalog'
import { getAiProviderApiKeyAvailability } from '@/lib/ai/credentials'

function normalizeModel(model) {
    return String(model || '').trim()
}

async function resolveAdminUser(request, payload) {
    const authHeader = request.headers.get('authorization') || ''
    const adminTokenFromHeader = authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : ''
    const adminTokenFromBody = typeof payload?.adminToken === 'string'
        ? payload.adminToken.trim()
        : ''
    const adminToken = adminTokenFromBody || adminTokenFromHeader

    return await verifyAdminToken(adminToken)
}

export async function GET(request) {
    try {
        const adminUser = await resolveAdminUser(request)
        if (!adminUser) {
            return NextResponse.json({ error: 'Unauthorized: valid admin token required' }, { status: 401 })
        }

        const catalog = await readAiProviderModelCatalog()
        const options = buildProviderTierOptions(catalog.models)

        return NextResponse.json({
            success: true,
            canEdit: isSuperAdmin(adminUser),
            models: catalog.models,
            options: options.map((item) => ({
                ...item,
                providerLabel: getReportAiProviderDisplayName(item.provider),
            })),
            providers: REPORT_AI_PROVIDER_KEYS,
            tiers: REPORT_AI_TIER_KEYS,
            keyAvailability: getAiProviderApiKeyAvailability(),
        })
    } catch (error) {
        return NextResponse.json(
            { error: error?.message || 'Failed to load AI provider models' },
            { status: 500 }
        )
    }
}

export async function PATCH(request) {
    try {
        const payload = await request.json().catch(() => ({}))
        const adminUser = await resolveAdminUser(request, payload)
        if (!adminUser || !isSuperAdmin(adminUser)) {
            return NextResponse.json({ error: 'Unauthorized: superadmin required' }, { status: 401 })
        }

        const provider = normalizeReportAiProvider(payload?.provider)
        const tier = normalizeReportAiTier(payload?.tier)
        const model = normalizeModel(payload?.model)

        if (!REPORT_AI_PROVIDER_KEYS.includes(provider)) {
            return NextResponse.json({ error: `provider must be one of: ${REPORT_AI_PROVIDER_KEYS.join(', ')}` }, { status: 400 })
        }

        if (!REPORT_AI_TIER_KEYS.includes(tier)) {
            return NextResponse.json({ error: 'tier must be one of: flagship, balanced, value' }, { status: 400 })
        }

        if (!model) {
            return NextResponse.json({ error: 'model is required' }, { status: 400 })
        }

        const existing = await readAiProviderModelCatalog()
        const nextModels = {
            ...existing.models,
            [provider]: {
                ...(existing.models?.[provider] || {}),
                [tier]: model,
            },
        }
        const saved = await writeAiProviderModelCatalog(nextModels)

        if (!saved?.success) {
            return NextResponse.json({ error: 'Failed to save provider model' }, { status: 500 })
        }

        return NextResponse.json({
            success: true,
            provider,
            tier,
            model,
            models: saved.models,
        })
    } catch (error) {
        return NextResponse.json(
            { error: error?.message || 'Failed to update AI provider model' },
            { status: 500 }
        )
    }
}
