import { getSystemStateValue } from '@/lib/systemState'
import { isModelCompatibleWithProvider } from '@/lib/ai/providers'

export const FALLBACK_OPENAI_MODEL = 'gpt-5.6-sol'

// Display order for the live `/v1/models` list. Newest first.
//
// Every id here was confirmed chat-capable via `/v1/chat/completions` on 2026-09-29. The `-pro`
// ids the API returns (`gpt-5.5-pro`, `gpt-5.4-pro`, `gpt-5.2-pro`, `gpt-5-pro`, `o1-pro`) are
// deliberately absent: they are not chat models and 404 on that endpoint.
export const PREFERRED_OPENAI_MODELS = [
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.4-nano',
    'gpt-5.2',
    'gpt-5.1',
    'gpt-5',
    'gpt-5-mini',
    'gpt-5-nano',
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4o',
    'gpt-4o-mini'
]

export async function resolveOpenAiModel() {
    const storedModel = await getSystemStateValue('openai_model')
    const configured = (
        (typeof storedModel === 'string' && storedModel.trim())
        || process.env.OPENAI_MODEL
        || FALLBACK_OPENAI_MODEL
    ).trim()

    // A globally stored model may belong to a different vendor now that the
    // catalog supports Claude/Gemini/DeepSeek; never send it to OpenAI.
    if (!isModelCompatibleWithProvider('openai', configured)) {
        return FALLBACK_OPENAI_MODEL
    }

    return configured
}

export function normalizeOpenAiModels(rawModels) {
    if (!Array.isArray(rawModels)) return []

    const ids = rawModels
        .map((model) => String(model?.id || '').trim())
        .filter(Boolean)
        .filter((id) => /^(gpt|o[1-9])/i.test(id))

    const unique = Array.from(new Set(ids))

    const preferredFirst = []
    const seen = new Set()

    for (const preferred of PREFERRED_OPENAI_MODELS) {
        if (unique.includes(preferred)) {
            preferredFirst.push(preferred)
            seen.add(preferred)
        }
    }

    const remaining = unique
        .filter((id) => !seen.has(id))
        .sort((a, b) => a.localeCompare(b))

    return [...preferredFirst, ...remaining]
}
