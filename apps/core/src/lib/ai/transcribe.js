// Audio transcription across providers.
//
// The AI SDK exposes a single `transcribe()` call over a provider transcription
// model, so switching vendors is a factory swap. OpenAI and Gemini offer
// speech-to-text; Claude and DeepSeek do not, and say so explicitly.

import { transcribe } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { AI_PROVIDER_GEMINI, AI_PROVIDER_OPENAI, getAiProviderMeta } from './providers.js'
import { resolveAiConfig } from './credentials.js'
import { AI_SERVICE_TRANSCRIPTION, resolveServiceProvider } from './services.js'
import { recordNonRedactableEgress } from '../privacy/index.js'

function createTranscriptionModel(config) {
    const { apiKey, baseUrl, model, provider } = config

    if (provider === AI_PROVIDER_OPENAI) {
        return createOpenAI({ apiKey, baseURL: baseUrl }).transcription(model)
    }
    if (provider === AI_PROVIDER_GEMINI) {
        return createGoogleGenerativeAI({ apiKey, baseURL: baseUrl }).transcription(model)
    }

    return null
}

function isNoTranscriptError(error) {
    const name = String(error?.name || '')
    return name.includes('NoTranscriptGenerated')
}

/**
 * Transcribe one audio chunk.
 *
 * Returns `{ ok, status, text, provider, model, error }`. An empty transcript is
 * a successful, non-error outcome: silence produces no text.
 */
export async function transcribeAudio({
    audio,
    mimeType,
    language = '',
    provider,
    model,
    signal,
} = {}) {
    const resolvedProvider = resolveServiceProvider(AI_SERVICE_TRANSCRIPTION, provider)
    // Never inherit the chat model: a chat model id is rejected by the audio
    // endpoint. An explicit transcription model always wins.
    const transcriptionModelId = String(model || '').trim()
        || getAiProviderMeta(resolvedProvider).transcriptionDefaultModel
        || ''
    const config = resolveAiConfig({ provider: resolvedProvider, model: transcriptionModelId })

    if (!config.hasApiKey) {
        return {
            ok: false,
            status: 503,
            text: '',
            provider: config.provider,
            model: config.model,
            error: `${config.providerLabel} API key is not configured.`,
        }
    }

    const transcriptionModel = createTranscriptionModel(config)
    if (!transcriptionModel) {
        return {
            ok: false,
            status: 400,
            text: '',
            provider: config.provider,
            model: config.model,
            error: `${config.providerLabel} does not support audio transcription.`,
        }
    }

    if (!audio) {
        return {
            ok: false,
            status: 400,
            text: '',
            provider: config.provider,
            model: config.model,
            error: 'Audio data is required.',
        }
    }

    // Session audio is the one channel that cannot be de-identified before it is sent: a name
    // spoken aloud is not a string we can rewrite. Every request is recorded as a disclosed,
    // non-redactable egress so the audit shows the exception rather than implying full coverage.
    recordNonRedactableEgress({ model: transcriptionModelId })

    try {
        const result = await transcribe({
            model: transcriptionModel,
            audio,
            // Only OpenAI accepts a language hint today; other providers ignore it.
            ...(language && config.provider === AI_PROVIDER_OPENAI
                ? { providerOptions: { openai: { language } } }
                : {}),
            ...(signal ? { abortSignal: signal } : {}),
        })

        return {
            ok: true,
            status: 200,
            text: String(result.text || '').trim(),
            segments: Array.isArray(result.segments) ? result.segments : [],
            language: result.language || '',
            durationInSeconds: result.durationInSeconds,
            provider: config.provider,
            model: config.model,
            mimeType,
        }
    } catch (error) {
        // Silence legitimately yields no transcript; the caller treats '' as
        // "nothing said in this chunk" rather than a failure.
        if (isNoTranscriptError(error)) {
            return {
                ok: true,
                status: 200,
                text: '',
                segments: [],
                provider: config.provider,
                model: config.model,
                mimeType,
            }
        }

        const status = Number(error?.statusCode || error?.status)
        return {
            ok: false,
            status: Number.isFinite(status) && status >= 400 && status <= 599 ? status : 502,
            text: '',
            provider: config.provider,
            model: config.model,
            error: String(error?.responseBody || error?.message || 'Transcription failed').slice(0, 600),
        }
    }
}

export { AI_SERVICE_TRANSCRIPTION }
