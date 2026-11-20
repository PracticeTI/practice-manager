// Grounded web search across providers.
//
// OpenAI, Claude and Gemini each expose a *provider-executed* search tool, so
// the model searches the web itself and we only see the final answer plus the
// citations. DeepSeek has no equivalent and returns an explicit unsupported
// error rather than silently answering from memory.

import { generateText, stepCountIs } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import {
    AI_PROVIDER_CLAUDE,
    AI_PROVIDER_DEEPSEEK,
    AI_PROVIDER_GEMINI,
    AI_PROVIDER_OPENAI,
    getAiProviderMeta,
    normalizeAiProvider,
} from './providers.js'
import { resolveAiConfig } from './credentials.js'
import { AI_SERVICE_WEB_SEARCH, resolveServiceProvider } from './services.js'
import { EGRESS_CHANNEL_WEB_SEARCH, guardOutgoingChat } from '../privacy/index.js'

const DEFAULT_MAX_STEPS = 4
const MAX_ERROR_MESSAGE_LENGTH = 600

function buildSearchTool(config) {
    const { apiKey, baseUrl, provider } = config

    if (provider === AI_PROVIDER_OPENAI) {
        return {
            name: 'web_search',
            tool: createOpenAI({ apiKey, baseURL: baseUrl }).tools.webSearch({}),
        }
    }

    if (provider === AI_PROVIDER_CLAUDE) {
        return {
            name: 'web_search',
            tool: createAnthropic({ apiKey, baseURL: baseUrl }).tools.webSearch_20250305({ maxUses: 3 }),
        }
    }

    if (provider === AI_PROVIDER_GEMINI) {
        return {
            name: 'google_search',
            tool: createGoogleGenerativeAI({ apiKey, baseURL: baseUrl }).tools.googleSearch({}),
        }
    }

    return null
}

function dedupeSources(entries) {
    const seen = new Set()
    const sources = []

    for (const entry of entries) {
        const url = String(entry?.url || '').trim()
        if (!url || seen.has(url)) continue
        seen.add(url)
        sources.push({
            url,
            title: String(entry?.title || '').trim(),
            provider: String(entry?.provider || '').trim(),
        })
    }

    return sources
}

function collectSources(result) {
    const entries = []

    for (const source of Array.isArray(result?.sources) ? result.sources : []) {
        if (source?.sourceType === 'url' && source.url) {
            entries.push({ url: source.url, title: source.title })
        }
    }

    // OpenAI reports the full result list on the tool output, not on `sources`.
    for (const toolResult of Array.isArray(result?.toolResults) ? result.toolResults : []) {
        for (const source of Array.isArray(toolResult?.output?.sources) ? toolResult.output.sources : []) {
            if (source?.url) entries.push({ url: source.url, title: source.title })
        }
    }

    return dedupeSources(entries)
}

function collectSearchQueries(result) {
    const queries = []

    for (const toolResult of Array.isArray(result?.toolResults) ? result.toolResults : []) {
        const output = toolResult?.output || {}
        if (Array.isArray(output.action?.queries)) queries.push(...output.action.queries)
        else if (typeof output.action?.query === 'string') queries.push(output.action.query)

        const input = toolResult?.input || {}
        if (typeof input.query === 'string') queries.push(input.query)
    }

    return Array.from(new Set(queries.map((query) => String(query).trim()).filter(Boolean)))
}

/**
 * Run a web-grounded completion.
 *
 * Returns `{ ok, status, text, sources, searchQueries, provider, model, error }`.
 */
export async function generateWebSearch({
    query,
    system,
    provider,
    model,
    signal,
    maxSteps = DEFAULT_MAX_STEPS,
} = {}) {
    const resolvedProvider = resolveServiceProvider(AI_SERVICE_WEB_SEARCH, provider)

    if (!resolvedProvider || resolvedProvider === AI_PROVIDER_DEEPSEEK) {
        return {
            ok: false,
            status: 400,
            text: '',
            sources: [],
            searchQueries: [],
            provider: resolvedProvider,
            model: '',
            error: 'No configured provider supports web search. Use OpenAI, Claude or Gemini.',
        }
    }

    const config = resolveAiConfig({ provider: resolvedProvider, model })

    if (!config.hasApiKey) {
        return {
            ok: false,
            status: 503,
            text: '',
            sources: [],
            searchQueries: [],
            provider: config.provider,
            model: config.model,
            error: `${config.providerLabel} API key is not configured.`,
        }
    }

    const tool = buildSearchTool(config)
    if (!tool) {
        return {
            ok: false,
            status: 400,
            text: '',
            sources: [],
            searchQueries: [],
            provider: config.provider,
            model: config.model,
            error: `${getAiProviderMeta(config.provider).label} does not support web search.`,
        }
    }

    const prompt = String(query || '').trim()
    if (!prompt) {
        return {
            ok: false,
            status: 400,
            text: '',
            sources: [],
            searchQueries: [],
            provider: config.provider,
            model: config.model,
            error: 'A search query is required.',
        }
    }

    try {
        // Research is not patient-scoped, but callers can still paste a record into a search box.
        // The guard strips contact details and named individuals either way.
        const guarded = guardOutgoingChat(
            { system, messages: [{ role: 'user', content: String(prompt || '') }] },
            { channel: EGRESS_CHANNEL_WEB_SEARCH }
        )
        const result = await generateText({
            model: createSearchModel(config),
            ...(guarded.system ? { system: guarded.system } : {}),
            prompt: guarded.messages[0].content,
            tools: { [tool.name]: tool.tool },
            stopWhen: stepCountIs(Math.max(1, Math.floor(maxSteps))),
            ...(signal ? { abortSignal: signal } : {}),
        })

        return {
            ok: true,
            status: 200,
            text: String(result.text || ''),
            sources: collectSources(result),
            searchQueries: collectSearchQueries(result),
            provider: config.provider,
            model: config.model,
            usage: result.usage,
        }
    } catch (error) {
        const status = Number(error?.statusCode || error?.status)
        return {
            ok: false,
            status: Number.isFinite(status) && status >= 400 && status <= 599 ? status : 502,
            text: '',
            sources: [],
            searchQueries: [],
            provider: config.provider,
            model: config.model,
            error: String(error?.responseBody || error?.message || 'Web search failed').slice(0, MAX_ERROR_MESSAGE_LENGTH),
        }
    }
}

function createSearchModel(config) {
    const { apiKey, baseUrl, model, provider } = config

    if (provider === AI_PROVIDER_CLAUDE) {
        return createAnthropic({ apiKey, baseURL: baseUrl })(model)
    }
    if (provider === AI_PROVIDER_GEMINI) {
        return createGoogleGenerativeAI({ apiKey, baseURL: baseUrl })(model)
    }
    if (normalizeAiProvider(provider) === AI_PROVIDER_OPENAI) {
        return createOpenAI({ apiKey, baseURL: baseUrl })(model)
    }

    throw new Error(`Web search is not supported for ${provider}.`)
}

export { AI_SERVICE_WEB_SEARCH }
