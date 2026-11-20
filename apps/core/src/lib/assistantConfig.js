// Shared normalization + defaults for the per-domain "AI Assistant" feature.
//
// This module is intentionally client-safe (no server-only imports) so both the
// domain settings UI and the server route can use the same normalization rules.
//
// The assistant is configured per domain via these flat settings fields:
//   assistantEnabled      boolean  – master switch (shown in /domains/settings Features)
//   assistantProvider     string   – 'google-vertex' | 'google' | 'openai'
//   assistantModel        string   – provider model override ('' => provider default)
//   assistantProjectId    string   – Vertex AI project (google-vertex only)
//   assistantLocation     string   – Vertex AI location (google-vertex only)

import { DEFAULT_DOMAIN_DEFINITIONS } from '@/lib/domainSettings'
import { normalizePracticeType } from '@/lib/practiceTypes'

export const ASSISTANT_PROVIDER_OPTIONS = [
    { id: 'google-vertex', label: 'Google Vertex AI (Gemini)' },
    { id: 'google', label: 'Google Gemini API key' },
    { id: 'openai', label: 'OpenAI' },
    { id: 'claude', label: 'Claude (Anthropic)' },
    { id: 'deepseek', label: 'DeepSeek' },
    { id: 'openrouter', label: 'OpenRouter' },
]

export const ASSISTANT_PROVIDER_DEFAULTS = {
    'google-vertex': {
        model: 'gemini-2.5-flash',
        location: 'us-central1',
    },
    google: {
        model: 'gemini-2.5-flash',
    },
    openai: {
        model: 'gpt-4.1-mini',
    },
    claude: {
        model: 'claude-sonnet-5-5',
    },
    deepseek: {
        model: 'deepseek-chat',
    },
    openrouter: {
        model: 'openai/gpt-4o-mini',
    },
}

// Domains default to Google-native Vertex AI when enabling the assistant.
export const DEFAULT_ASSISTANT_PROVIDER = 'google-vertex'
export const DEFAULT_ASSISTANT_LOCATION = 'us-central1'

export function normalizeAssistantProvider(value) {
    const normalized = String(value || '').trim().toLowerCase()
    return ASSISTANT_PROVIDER_OPTIONS.some((option) => option.id === normalized)
        ? normalized
        : DEFAULT_ASSISTANT_PROVIDER
}

export function getDefaultAssistantModel(provider, domainAiModel = '') {
    const resolvedProvider = normalizeAssistantProvider(provider)
    const fallback = ASSISTANT_PROVIDER_DEFAULTS[resolvedProvider]?.model || ASSISTANT_PROVIDER_DEFAULTS[DEFAULT_ASSISTANT_PROVIDER].model
    if (resolvedProvider === 'openai') {
        return String(domainAiModel || '').trim() || fallback
    }
    return fallback
}

export function makeDefaultAssistantSettings() {
    return {
        assistantEnabled: false,
        assistantProvider: DEFAULT_ASSISTANT_PROVIDER,
        assistantModel: '',
        assistantProjectId: '',
        assistantLocation: DEFAULT_ASSISTANT_LOCATION,
    }
}

/**
 * Normalize a raw domain settings object's assistant-related flat fields.
 * Returns a plain object with just the assistant fields (plus domainAiModel passthrough).
 */
export function normalizeAssistantSettings(source = {}) {
    const provider = normalizeAssistantProvider(source.assistantProvider)
    const model = String(source.assistantModel || '').trim()
    const projectId = String(source.assistantProjectId || '').trim()
    const location = String(source.assistantLocation || '').trim() || DEFAULT_ASSISTANT_LOCATION

    return {
        assistantEnabled: source.assistantEnabled === true,
        assistantProvider: provider,
        assistantModel: model,
        assistantProjectId: projectId,
        assistantLocation: location,
        assistantEffectiveModel: getDefaultAssistantModel(provider, model || source.aiModel),
    }
}

export function assistantProviderLabel(provider) {
    const option = ASSISTANT_PROVIDER_OPTIONS.find((item) => item.id === normalizeAssistantProvider(provider))
    return option ? option.label : ASSISTANT_PROVIDER_OPTIONS[0].label
}

function prettifyDomainKey(domainKey) {
    return String(domainKey || '')
        .split('-')
        .filter(Boolean)
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join(' ')
}

/**
 * Resolve a friendly, human-readable label for a domain (e.g. 'brand-key'
 * → 'Brand Key') so copy can name the actual domain instead of saying
 * "this domain". A meaningful configured displayName wins; otherwise the
 * canonical domain definition name is used; otherwise the key is prettified.
 */
export function getDomainDisplayLabel(domainKey, configuredDisplayName = '') {
    const key = String(domainKey || '').trim().toLowerCase()
    const configured = String(configuredDisplayName || '').trim()

    if (configured && configured.toLowerCase() !== key) {
        return configured
    }

    const definition = DEFAULT_DOMAIN_DEFINITIONS.find((item) => item.key === key)
    if (definition && String(definition.name || '').trim()) {
        return definition.name
    }

    return prettifyDomainKey(key) || 'Practice'
}

/**
 * URL that resolves a domain's artwork. The server prefers the domain override
 * (`public/allied-health/domains/<domain>/<file>`) and falls back to the shared
 * practice-type folder (`public/allied-health/<OT|physio|speech>/<file>`).
 *
 * Returns '' when there is no usable domain key.
 */
function getDomainArtworkIconUrl(domainKey, artwork) {
    const key = String(domainKey || '').trim().toLowerCase()
    if (!/^[a-z0-9-]+$/.test(key)) return ''
    return `/api/settings/domain-artwork?domain=${encodeURIComponent(key)}&art=${encodeURIComponent(artwork)}`
}

/**
 * Where a domain's optional assistant artwork lives. The mark worn by the assistant
 * launcher. Resolved by convention, so a domain adopts one by dropping
 * `assistant.png` into `public/allied-health/domains/<domain>/` (or the shared
 * practice-type folder) and needs no registry entry.
 *
 * Returns the URL to look up ('' when there is no usable domain key) – the caller
 * decides whether the file exists and falls back to the generic glyph.
 */
export function getDomainAssistantIconUrl(domainKey) {
    return getDomainArtworkIconUrl(domainKey, 'assistant')
}

/**
 * Where a domain's optional worker artwork lives. This is the mark worn by the
 * surfaces that group worker-written content, as opposed to the assistant launcher
 * artwork above. Returns the URL to look up ('' when there is no usable domain key) –
 * the caller decides whether the file exists.
 */
export function getDomainWorkerIconUrl(domainKey) {
    return getDomainArtworkIconUrl(domainKey, 'worker')
}

/**
 * Map a domain's enabled admin features to short, human-readable focus areas so
 * assistant copy reflects what that domain actually uses (e.g. an allied-health
 * practice with patients, reports, billing and an equipment directory).
 */
export function buildAssistantFocusAreas(domainSettings = {}) {
    const settings = domainSettings && typeof domainSettings === 'object' ? domainSettings : {}
    const patients = settings.patientsEnabled === true
    const reports = patients && settings.reportsCardEnabled !== false
    const billing = patients && settings.patientBillingEnabled === true
    const practiceType = normalizePracticeType(settings.practiceType)
    const isAlliedHealth = patients || practiceType !== 'general'

    const areas = []
    if (patients) areas.push('patient intake and notes')
    if (reports) areas.push('reports and assessments')
    if (billing) areas.push('billing records')
    if (isAlliedHealth) areas.push('the equipment supplier directory')
    areas.push('website content')
    return areas
}

function joinWithAnd(items) {
    const parts = items.filter(Boolean)
    if (parts.length === 0) return ''
    if (parts.length === 1) return parts[0]
    return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

export const FALLBACK_ASSISTANT_WELCOME =
    'Ask this assistant about the portal, drafting content, planning, or general questions.'

/**
 * Build the welcome copy shown inside the assistant. When the domain runs an
 * allied-health practice the copy names the clinical/admin areas the team can
 * get help with; otherwise it falls back to the generic portal copy.
 */
export function buildAssistantWelcome(domainSettings = {}) {
    const areas = buildAssistantFocusAreas(domainSettings)
    if (areas.length === 0) return FALLBACK_ASSISTANT_WELCOME
    return `Ask this assistant for help with ${joinWithAnd(areas)}, or any general admin question.`
}

/**
 * Build clickable starter prompts for the assistant's empty state, again derived
 * from the domain's enabled features so they match what the admin actually does
 * (e.g. an allied-health practice).
 */
const GENERIC_ASSISTANT_PROMPTS = [
    {
        label: 'Email draft',
        prompt: 'Draft a professional email I can edit and send.',
    },
    {
        label: 'Website copy',
        prompt: 'Help me draft a short website page about our services.',
    },
    {
        label: 'Content plan',
        prompt: 'Give me a quick content plan for the week.',
    },
]

export function buildAssistantSuggestions(domainSettings = {}) {
    const settings = domainSettings && typeof domainSettings === 'object' ? domainSettings : {}
    const patients = settings.patientsEnabled === true
    const reports = patients && settings.reportsCardEnabled !== false
    const billing = patients && settings.patientBillingEnabled === true
    const practiceType = normalizePracticeType(settings.practiceType)
    const isAlliedHealth = patients || practiceType !== 'general'

    const prompts = []
    if (patients) prompts.push({
        label: 'New referral',
        prompt: 'Draft a friendly first message for a new patient referral or enquiry.',
    })
    if (reports) prompts.push({
        label: 'Report outline',
        prompt: 'Help me outline the sections of a functional capacity assessment report.',
    })
    if (billing) prompts.push({
        label: 'Invoice reminder',
        prompt: 'Write a polite reminder to send about an outstanding invoice.',
    })
    if (isAlliedHealth) prompts.push({
        label: 'Supplier questions',
        prompt: 'What should I confirm with an equipment supplier before recommending them?',
    })

    // Top up with general starters so every domain offers a useful set and the
    // allied-health configuration picks up the fifth prompt.
    for (const generic of GENERIC_ASSISTANT_PROMPTS) {
        if (prompts.length >= 5) break
        if (!prompts.some((item) => item.label === generic.label)) {
            prompts.push(generic)
        }
    }

    return prompts.slice(0, 5)
}
