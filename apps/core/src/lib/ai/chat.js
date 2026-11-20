// The single chat entrypoint for the app.
//
// Every provider is driven through a maintained AI SDK adapter, so callers get
// one normalized result shape and never deal with vendor-specific request
// bodies, auth headers, or `choices[0].message.content` parsing.

import { generateText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import {
    AI_PROVIDER_KIND_ANTHROPIC,
    AI_PROVIDER_KIND_GOOGLE,
    AI_PROVIDER_KIND_OPENAI_COMPATIBLE,
} from './providers.js'
import { resolveAiConfig } from './credentials.js'
import { EGRESS_CHANNEL_CHAT, PrivacyEgressError, guardOutgoingChat } from '../privacy/index.js'

const MAX_ERROR_MESSAGE_LENGTH = 600

/** The default: de-identify and verify inside this function. */
export const IDENTITY_POLICY_ENFORCE = 'enforce'
/**
 * The caller already guarded its payload and is deliberately forwarding one unredacted segment
 * under its own disclosed-egress record. Only the intake chat uses this.
 */
export const IDENTITY_POLICY_DELEGATED = 'delegated'

function normalizeMessage(message) {
    if (!message || typeof message !== 'object') return null
    const role = String(message.role || '').trim()
    if (!role) return null
    const content = typeof message.content === 'string'
        ? message.content
        : Array.isArray(message.content)
            ? message.content
            : String(message.content ?? '')
    return { role, content }
}

export function normalizeChatMessages(messages) {
    if (!Array.isArray(messages)) return []
    return messages.map(normalizeMessage).filter(Boolean)
}

/**
 * Build the AI SDK language model for a resolved provider config.
 * Exported so streaming surfaces (the admin assistant) can reuse the adapters.
 */
export function createLanguageModel(config) {
    const { apiKey, baseUrl, model, kind, provider } = config

    if (kind === AI_PROVIDER_KIND_ANTHROPIC) {
        return createAnthropic({ apiKey, baseURL: baseUrl })(model)
    }

    if (kind === AI_PROVIDER_KIND_GOOGLE) {
        return createGoogleGenerativeAI({ apiKey, baseURL: baseUrl })(model)
    }

    if (kind === AI_PROVIDER_KIND_OPENAI_COMPATIBLE) {
        return createOpenAICompatible({ name: provider, apiKey, baseURL: baseUrl })(model)
    }

    return createOpenAI({ apiKey, baseURL: baseUrl })(model)
}

/** Legacy OpenAI-shaped payload so unmigrated callers keep working. */
function toLegacyData(text) {
    return {
        choices: [
            {
                index: 0,
                message: { role: 'assistant', content: text },
                finish_reason: 'stop',
            },
        ],
    }
}

function errorStatus(error) {
    const status = Number(error?.statusCode || error?.status)
    return Number.isFinite(status) && status >= 400 && status <= 599 ? status : 502
}

function errorMessage(error) {
    const raw = error?.responseBody
        || error?.cause?.message
        || error?.message
        || 'AI provider request failed'
    return String(raw).slice(0, MAX_ERROR_MESSAGE_LENGTH)
}

function failure(config, error) {
    const message = errorMessage(error)
    return {
        ok: false,
        status: errorStatus(error),
        text: '',
        error: message,
        provider: config?.provider || '',
        model: config?.model || '',
        data: { error: { message } },
    }
}

/**
 * Run a single non-streaming chat completion.
 *
 * Every request is de-identified and verified before it is sent: pass `identity` (the patient's
 * identity block) for any patient-scoped call and the guard will replace every identifying value
 * with a role phrase, then refuse the call if anything identifying survived. Omitting `identity`
 * still strips contact patterns; it does not disable the guard.
 *
 * Returns `{ ok, status, text, data, usage, error, provider, model }` where
 * `data` mirrors the old OpenAI response so shared helpers stay compatible.
 */
export async function generateChat({
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
    channel = EGRESS_CHANNEL_CHAT,
    identityPolicy = IDENTITY_POLICY_ENFORCE,
} = {}) {
    const config = resolveAiConfig({ provider, model, baseUrl, domainSettings })
    if (apiKey) config.apiKey = String(apiKey)
    if (config.modelProviderMismatch) {
        const result = failure(
            config,
            new Error(`Model "${config.model}" does not belong to the ${config.providerLabel} provider.`)
        )
        result.status = 400
        return result
    }

    if (!config.apiKey) {
        const error = new Error(
            `${config.providerLabel} API key is not configured. Set ${config.provider === 'claude' ? 'ANTHROPIC_API_KEY' : `${config.provider.toUpperCase()}_API_KEY`}.`
        )
        const result = failure(config, error)
        result.status = 503
        return result
    }

    const normalizedMessages = normalizeChatMessages(messages)
    if (normalizedMessages.length === 0 && !system) {
        const result = failure(config, new Error('At least one message or a system prompt is required.'))
        result.status = 400
        return result
    }

    // `delegated` exists for exactly one caller: the intake chat, which guards its own payload and
    // then forwards the single form answer it is extracting under a disclosed-egress record. Any
    // other caller with patient content must use the default.
    let guarded = { messages: normalizedMessages, ...(system ? { system } : {}) }
    if (identityPolicy !== IDENTITY_POLICY_DELEGATED) {
        try {
            guarded = guardOutgoingChat({ messages: normalizedMessages, system }, { identity, channel })
        } catch (error) {
            if (!(error instanceof PrivacyEgressError)) throw error
            const result = failure(config, error)
            result.status = error.status
            result.privacyBlocked = true
            return result
        }
    }

    try {
        const result = await generateText({
            model: createLanguageModel(config),
            ...(guarded.system ? { system: guarded.system } : {}),
            messages: guarded.messages,
            ...(Number.isFinite(temperature) ? { temperature } : {}),
            ...(Number.isFinite(maxOutputTokens) && maxOutputTokens > 0
                ? { maxOutputTokens: Math.floor(maxOutputTokens) }
                : {}),
            ...(signal ? { abortSignal: signal } : {}),
        })

        const text = String(result.text || '')
        return {
            ok: true,
            status: 200,
            text,
            data: toLegacyData(text),
            usage: result.usage,
            finishReason: result.finishReason,
            provider: config.provider,
            model: config.model,
            raw: result,
        }
    } catch (error) {
        return failure(config, error)
    }
}
