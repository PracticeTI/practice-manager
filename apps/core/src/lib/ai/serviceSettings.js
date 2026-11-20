// Server-side persistence for per-service provider selection.

import { getSystemStateValue, setSystemStateValue } from '@/lib/systemState'
import {
    AI_SERVICE_CHAT,
    AI_SERVICE_KEYS,
    AI_SERVICE_TRANSCRIPTION,
    AI_SERVICE_WEB_SEARCH,
    DEFAULT_SERVICE_PROVIDERS,
    normalizeAiServiceSettings,
} from '@/lib/ai/services'

export const AI_SERVICE_SETTINGS_KEY = 'ai_service_providers_v1'

const SEED_ENV_VARS = {
    [AI_SERVICE_CHAT]: 'AI_PROVIDER',
    [AI_SERVICE_WEB_SEARCH]: 'AI_WEB_SEARCH_PROVIDER',
    [AI_SERVICE_TRANSCRIPTION]: 'AI_TRANSCRIPTION_PROVIDER',
}

/**
 * Seed values used before anything is saved in the admin UI. Env vars only
 * provide the starting point; a saved setting always wins.
 */
export function buildDefaultServiceSettings() {
    const seed = {}
    for (const service of AI_SERVICE_KEYS) {
        const envValue = String(process.env[SEED_ENV_VARS[service]] || '').trim()
        seed[service] = { provider: envValue || DEFAULT_SERVICE_PROVIDERS[service] }
    }
    return normalizeAiServiceSettings(seed)
}

export async function readAiServiceSettings() {
    const stored = await getSystemStateValue(AI_SERVICE_SETTINGS_KEY).catch(() => null)
    const saved = stored?.services || stored
    // normalizeAiServiceSettings fills in every service, so merging the saved
    // subset over the seeded defaults keeps untouched services intact.
    return normalizeAiServiceSettings({ ...buildDefaultServiceSettings(), ...(saved || {}) })
}

export async function writeAiServiceSettings(input) {
    const services = normalizeAiServiceSettings(input)
    const saved = await setSystemStateValue(AI_SERVICE_SETTINGS_KEY, {
        version: 1,
        services,
        updatedAt: new Date().toISOString(),
    })

    return { success: Boolean(saved), services }
}

/** Resolve one service's selection, falling back to the seeded defaults. */
export async function readAiServiceSelection(service) {
    const services = await readAiServiceSettings()
    return services[service] || buildDefaultServiceSettings()[service]
}

export { AI_SERVICE_KEYS }
