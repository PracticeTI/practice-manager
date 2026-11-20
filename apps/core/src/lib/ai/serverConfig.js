// Server-only provider selection that can consult persisted state.
//
// The pure resolver in `credentials.js` always returns a usable model. For
// OpenAI this layer additionally honours the `openai_model` state row that the
// settings UI and the model catalog have written for years, so upgrading to the
// provider registry does not silently change an operator's selected model.

import { getSystemStateValue } from '@/lib/systemState'
import { resolveAiConfig } from './credentials.js'
import { isModelCompatibleWithProvider } from './providers.js'

export async function resolveAiChatConfig({ provider, model, baseUrl, domainSettings } = {}) {
    const config = resolveAiConfig({ provider, model, baseUrl, domainSettings })

    // An explicit model, a domain model, or an env model always wins.
    if (config.provider !== 'openai' || config.modelSource !== 'default') {
        return config
    }

    const storedModel = await getSystemStateValue('openai_model').catch(() => null)
    const normalized = typeof storedModel === 'string' ? storedModel.trim() : ''
    if (!normalized || !isModelCompatibleWithProvider(config.provider, normalized)) {
        return config
    }

    return { ...config, model: normalized, modelSource: 'system_settings' }
}
