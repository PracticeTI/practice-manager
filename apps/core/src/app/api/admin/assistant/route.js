import { NextResponse } from 'next/server'
import fs from 'node:fs'
import { streamText, convertToModelMessages } from 'ai'
import { vertex } from '@ai-sdk/google-vertex'
import { resolveAiProviderApiKey, resolveAiProviderBaseUrl } from '@/lib/ai/credentials'
import { getAiProviderMeta } from '@/lib/ai/providers'
import { createLanguageModel } from '@/lib/ai/chat'
import {
    EGRESS_CHANNEL_ASSISTANT,
    PrivacyEgressError,
    guardOutgoingChat,
} from '@/lib/privacy'
import { verifyAdminToken } from '@/lib/auth'
import { getDomainSetting } from '@/lib/appSettings'
import { DEFAULT_DOMAIN_KEY, resolveDomainModeFromHeaders } from '@/lib/domainMode'
import { readAiProviderModelCatalog } from '@/lib/aiProviderModelCatalog'
import {
    DOMAIN_AI_FEATURE_ADMIN_ASSISTANT,
    aiProviderToAssistantProvider,
    resolveDomainAiFeaturePreset,
} from '@/lib/domainAiFeatures'
import {
    normalizeAssistantProvider,
    normalizeAssistantSettings,
    getDefaultAssistantModel,
    getDomainDisplayLabel,
    buildAssistantFocusAreas,
    buildAssistantWelcome,
    buildAssistantSuggestions,
    ASSISTANT_PROVIDER_DEFAULTS,
} from '@/lib/assistantConfig'

export const runtime = 'nodejs'
export const maxDuration = 60


const SERVICE_ACCOUNT_ENV_VARS = [
    'GCP_SERVICE_ACCOUNT_JSON',
    'GOOGLE_SERVICE_ACCOUNT_JSON',
    'GOOGLE_APPLICATION_CREDENTIALS_JSON',
]

function getBearerToken(request) {
    const authHeader = request.headers.get('authorization') || ''
    return authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : ''
}

function normalizeDomainKey(value) {
    return String(value || '').trim().toLowerCase()
}

async function authenticate(request) {
    const adminToken = getBearerToken(request)
    const adminUser = await verifyAdminToken(adminToken)
    if (!adminUser) {
        return { error: 'Unauthorized: valid admin token required', status: 401 }
    }
    return { adminUser }
}

/**
 * Resolve the domain whose assistant config applies. Scoped (non-super) admins
 * always use their assigned domain; super admins use the hostname-scoped mode,
 * which mirrors how the rest of the admin dashboard resolves domain settings.
 */
function resolveAssistantDomainKey(adminUser, headerStore) {
    const scopedDomain = normalizeDomainKey(adminUser?.domain)
    if (scopedDomain) return scopedDomain
    return normalizeDomainKey(resolveDomainModeFromHeaders(headerStore)) || DEFAULT_DOMAIN_KEY
}

function loadGoogleServiceAccountCredentials() {
    for (const envName of SERVICE_ACCOUNT_ENV_VARS) {
        const raw = process.env[envName] || ''
        if (!raw) continue
        try {
            const parsed = JSON.parse(raw)
            if (parsed && typeof parsed === 'object' && parsed.client_email && parsed.private_key) {
                return { source: 'env-json', credentials: parsed }
            }
        } catch {
            // Not a JSON value – fall through and try the next source.
        }
    }

    const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
    if (credentialsPath) {
        try {
            const parsed = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'))
            if (parsed && typeof parsed === 'object' && parsed.client_email && parsed.private_key) {
                return { source: 'env-path', credentials: parsed }
            }
        } catch {
            // Unreadable/missing file – rely on ambient ADC when deployed on GCP.
        }
    }

    return null
}

async function buildAssistantConfig(domainSettings) {
    const normalized = normalizeAssistantSettings(domainSettings)
    const preset = resolveDomainAiFeaturePreset(
        DOMAIN_AI_FEATURE_ADMIN_ASSISTANT,
        domainSettings?.aiFeaturePresets
    )
    let featureSelection = null
    if (preset) {
        const catalog = await readAiProviderModelCatalog().catch(() => null)
        featureSelection = resolveDomainAiFeaturePreset(
            DOMAIN_AI_FEATURE_ADMIN_ASSISTANT,
            domainSettings?.aiFeaturePresets,
            catalog?.models
        )
    }

    const presetProvider = featureSelection
        ? aiProviderToAssistantProvider(featureSelection.provider)
        : ''
    const provider = presetProvider || normalizeAssistantProvider(normalized.assistantProvider)
    const model = featureSelection?.model
        || getDefaultAssistantModel(provider, normalized.assistantModel || domainSettings?.aiModel)

    const config = {
        domainKey: '',
        enabled: normalized.assistantEnabled,
        provider,
        model,
        modelTier: featureSelection?.tier || '',
        projectId: normalized.assistantProjectId,
        location: normalized.assistantLocation || ASSISTANT_PROVIDER_DEFAULTS['google-vertex'].location,
        configured: false,
        reason: '',
    }

    if (!config.enabled) {
        config.reason = 'AI assistant is not enabled.'
        return config
    }

    if (provider === 'google-vertex') {
        if (!config.projectId) {
            config.reason = 'Vertex AI requires a Google Cloud project ID. Configure it in Domain Settings → AI Assistant.'
            return config
        }
        const serviceAccount = loadGoogleServiceAccountCredentials()
        config.configured = true
        config.credentialSource = serviceAccount?.source || 'adc'
        return config
    }

    if (provider === 'google') {
        if (!resolveAiProviderApiKey('gemini', { domainSettings })) {
            config.reason = 'Gemini API key is not configured (add a key in AI & Defaults or set GOOGLE_GENERATIVE_AI_API_KEY).'
            return config
        }
        config.configured = true
        return config
    }

    if (provider === 'claude') {
        if (!resolveAiProviderApiKey('claude', { domainSettings })) {
            config.reason = 'Claude is not configured (set ANTHROPIC_API_KEY or CLAUDE_API_KEY).'
            return config
        }
        config.configured = true
        return config
    }

    if (provider === 'deepseek') {
        if (!resolveAiProviderApiKey('deepseek', { domainSettings })) {
            config.reason = 'DeepSeek is not configured (set DEEPSEEK_API_KEY).'
            return config
        }
        config.configured = true
        return config
    }

    if (provider === 'openrouter') {
        if (!resolveAiProviderApiKey('openrouter', { domainSettings })) {
            config.reason = 'OpenRouter is not configured (set OPENROUTER_API_KEY).'
            return config
        }
        config.configured = true
        return config
    }

    // openai (fallback) – key comes from the domain's existing AI config or env.
    const openaiKey = String(domainSettings?.aiApiKey || '').trim() || String(process.env.OPENAI_API_KEY || '').trim()
    if (!openaiKey) {
        config.reason = 'OpenAI is not configured (add a key in AI & Defaults or set OPENAI_API_KEY).'
        return config
    }
    config.configured = true
    return config
}

async function resolveAssistantConfigForRequest(request) {
    const { adminUser } = await authenticate(request)
    const domainKey = resolveAssistantDomainKey(adminUser, request.headers)
    const domainSettings = (await getDomainSetting(domainKey, 'management')) || {}
    const config = await buildAssistantConfig(domainSettings)
    config.domainKey = domainKey
    config.displayName = getDomainDisplayLabel(domainKey, domainSettings?.displayName)
    config.focusAreas = buildAssistantFocusAreas(domainSettings)
    config.welcome = buildAssistantWelcome(domainSettings)
    config.suggestions = buildAssistantSuggestions(domainSettings)
    return { adminUser, domainKey, domainSettings, config }
}

/**
 * GET /api/admin/assistant
 * Returns the assistant status/config for the current admin's domain so the
 * /admin/assistant page can render the chat, a disabled notice, or config help.
 */
export async function GET(request) {
    const authResult = await authenticate(request)
    if (authResult.error) {
        return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const resolved = await resolveAssistantConfigForRequest(request)
    const { config } = resolved

    return NextResponse.json({
        success: true,
        domainKey: config.domainKey,
        enabled: config.enabled,
        provider: config.provider,
        model: config.model,
        modelTier: config.modelTier || '',
        configured: config.configured,
        reason: config.reason,
        displayName: config.displayName,
        welcome: config.welcome,
        focusAreas: config.focusAreas,
        suggestions: config.suggestions,
    })
}

/**
 * POST /api/admin/assistant
 * Body: { messages: UIMessage[] } (assistant-ui / AI SDK UI messages)
 * Streams a model response back using the UI message stream protocol expected
 * by assistant-ui's AssistantChatTransport.
 */
export async function POST(request) {
    const authResult = await authenticate(request)
    if (authResult.error) {
        return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    let body
    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const messages = Array.isArray(body?.messages) ? body.messages : []
    if (messages.length === 0) {
        return NextResponse.json({ error: 'messages array is required' }, { status: 400 })
    }

    const resolved = await resolveAssistantConfigForRequest(request)
    const { domainKey, domainSettings, config } = resolved

    if (!config.enabled) {
        return NextResponse.json({ error: config.reason || 'AI assistant is not enabled.' }, { status: 403 })
    }
    if (!config.configured) {
        return NextResponse.json({ error: config.reason || 'AI assistant provider is not configured.' }, { status: 503 })
    }

    // Cap conversation history to avoid runaway token use.
    const trimmedMessages = messages.slice(-50)

    const focusAreas = Array.isArray(config.focusAreas) ? config.focusAreas : []
    const focusLine = focusAreas.length > 0
        ? `You can help the team with ${focusAreas.join(', ')}.`
        : ''
    const handlesClinicalWork = focusAreas.some((area) => /patient|report|assessment/i.test(area))

    const systemPrompt = [
        `You are a helpful, concise AI assistant for the admin team of ${config.displayName} (domain key: ${domainKey}).`,
        focusLine,
        handlesClinicalWork
            ? 'When helping with clinical or patient-facing admin work: never invent patient or clinical facts, only draft from what the user provides, keep personal health information safe, and avoid making clinical claims or recommendations.'
            : '',
        'Be accurate, avoid fabricating specifics, and keep answers focused on what was asked.',
    ].filter(Boolean).join(' ')

    try {
        const model = buildModel({ domainSettings, config })
        // The assistant has no patient context of its own, but staff paste clinical detail into it.
        // The guard strips contact details and named individuals, and refuses the turn if an
        // identifier it cannot attribute is about to leave.
        const guarded = guardOutgoingChat(
            { messages: await convertToModelMessages(trimmedMessages), system: systemPrompt },
            { channel: EGRESS_CHANNEL_ASSISTANT }
        )
        const result = streamText({
            model,
            system: guarded.system,
            messages: guarded.messages,
            abortSignal: request.signal,
        })
        return result.toUIMessageStreamResponse()
    } catch (error) {
        if (error instanceof PrivacyEgressError) {
            return NextResponse.json({ error: error.message }, { status: error.status })
        }
        const message = error?.message || 'Failed to initialise the AI provider.'
        return NextResponse.json({ error: message }, { status: 503 })
    }
}

function buildModel({ domainSettings, config }) {
    const provider = normalizeAssistantProvider(config.provider)
    const modelId = config.model

    if (provider === 'google-vertex') {
        const serviceAccount = loadGoogleServiceAccountCredentials()
        const providerInstance = vertex({
            project: config.projectId,
            location: config.location,
            googleAuthOptions: serviceAccount
                ? { credentials: serviceAccount.credentials }
                : undefined,
        })
        return providerInstance(modelId)
    }

    const apiKey = provider === 'openai'
        ? String(domainSettings?.aiApiKey || '').trim() || resolveAiProviderApiKey('openai')
        : resolveAiProviderApiKey(provider, { domainSettings })

    if (!apiKey) {
        throw new Error(`${getAiProviderMeta(provider).label} API key is not configured.`)
    }

    const baseUrl = provider === 'openai'
        ? String(domainSettings?.aiBaseUrl || '').trim() || undefined
        : resolveAiProviderBaseUrl(provider, { domainSettings })

    return createLanguageModel({
        provider,
        kind: getAiProviderMeta(provider).kind,
        model: modelId,
        apiKey,
        baseUrl,
    })
}
