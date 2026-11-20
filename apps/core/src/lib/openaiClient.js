// Back-compat wrapper around the unified AI chat entrypoint.
//
// Callers used to import `requestOpenAiChatCompletion`, which hardcoded the
// OpenAI endpoint. The name is kept for now so existing routes keep working,
// but dispatch is now provider-driven and results expose a normalized `text`.
//
// `identity` and `channel` are forwarded to the privacy guard in `ai/chat.js`, so a patient-scoped
// caller only has to pass the identity block it already has.

import { generateChat } from '@/lib/ai/chat'
import { resolveAiChatConfig } from '@/lib/ai/serverConfig'

export async function requestAiChatCompletion({
    provider,
    model,
    baseUrl,
    apiKey,
    domainSettings,
    messages,
    system,
    temperature,
    maxOutputTokens,
    signal,
    identity,
    channel,
    identityPolicy,
} = {}) {
    const config = await resolveAiChatConfig({ provider, model, baseUrl, domainSettings })

    return generateChat({
        ...config,
        apiKey: apiKey || config.apiKey,
        messages,
        system,
        temperature,
        maxOutputTokens,
        signal,
        ...(identity ? { identity } : {}),
        ...(channel ? { channel } : {}),
        ...(identityPolicy ? { identityPolicy } : {}),
    })
}

export const requestOpenAiChatCompletion = requestAiChatCompletion
