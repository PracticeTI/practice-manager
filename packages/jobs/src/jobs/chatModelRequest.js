// Model transport for the worker's report, summary and analyst calls.
//
// The worker used to speak only the OpenAI chat-completions dialect. Claude speaks the Anthropic
// Messages dialect instead: a different auth header, a top-level `system` prompt, no
// `response_format`, and a different response envelope. Callers keep passing the same arguments;
// this module picks the dialect from the provider (falling back to the model id) and normalises the
// reply to plain text so the call sites do not branch on vendor.

export const ANTHROPIC_API_VERSION = '2023-06-01'
export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1'
export const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com/v1'

const ANTHROPIC_DEFAULT_MAX_TOKENS = 8192

// Reasoning tokens are billed as output AND count against the output cap, so an uncapped request
// to a reasoning model is both slow and expensive: an OpenRouter run spent ~25 minutes and ~$1.45
// on one report before anyone could see a draft. Both limits are per request, not per report.
const DEFAULT_MAX_OUTPUT_TOKENS = 16384
const DEFAULT_REQUEST_TIMEOUT_MS = 300000

/**
 * OpenRouter normalises per-vendor reasoning controls behind one `reasoning` object. Its models
 * default to their strongest setting - `moonshotai/kimi-k3` reports `default_effort: "max"` - which
 * is far more thinking than drafting a report section needs.
 */
const DEFAULT_OPENROUTER_REASONING_EFFORT = 'low'
const REASONING_EFFORTS = new Set(['max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none'])

export function normalizeChatProvider(provider) {
    const normalized = String(provider || '').trim().toLowerCase()
    if (normalized === 'claude' || normalized === 'anthropic') return 'claude'
    if (normalized === 'openai') return 'openai'
    return ''
}

/**
 * Vendors that expose the OpenAI chat-completions shape on their own host. They differ only in base
 * URL and key, so they ride the OpenAI dialect rather than needing an adapter each.
 */
const OPENAI_COMPATIBLE_PROVIDERS = new Map([
    ['openrouter', 'https://openrouter.ai/api/v1'],
    ['deepseek', 'https://api.deepseek.com/v1'],
])

const DEFAULT_BASE_URLS = new Map([
    ['openai', OPENAI_DEFAULT_BASE_URL],
    ['claude', ANTHROPIC_DEFAULT_BASE_URL],
    ...OPENAI_COMPATIBLE_PROVIDERS,
])

const API_KEY_ENV_NAMES = new Map([
    ['openai', ['OPENAI_API_KEY']],
    ['claude', ['CLAUDE_API_KEY', 'ANTHROPIC_API_KEY']],
    ['openrouter', ['OPENROUTER_API_KEY']],
    ['deepseek', ['DEEPSEEK_API_KEY']],
])

/**
 * The provider as configured, for metadata and log lines. `openrouter` must stay `openrouter` here:
 * it shares OpenAI's dialect but not its route, and the report records which one wrote it.
 */
export function resolveChatProviderLabel({ provider, model } = {}) {
    const declared = String(provider || '').trim().toLowerCase()
    const canonical = normalizeChatProvider(declared)
    if (canonical) return canonical
    if (OPENAI_COMPATIBLE_PROVIDERS.has(declared)) return declared
    return resolveChatProvider({ provider: declared, model })
}

/**
 * The dialect to speak. A blank provider means "whatever the model id says", which is how rows
 * queued before the provider was recorded still resolve to OpenAI.
 */
export function resolveChatProvider({ provider, model } = {}) {
    if (OPENAI_COMPATIBLE_PROVIDERS.has(String(provider || '').trim().toLowerCase())) return 'openai'
    const declared = normalizeChatProvider(provider)
    if (declared) return declared
    return /^claude/i.test(String(model || '').trim()) ? 'claude' : 'openai'
}

export function isUnsupportedChatProvider(provider) {
    const normalized = String(provider || '').trim().toLowerCase()
    if (!normalized) return false
    if (OPENAI_COMPATIBLE_PROVIDERS.has(normalized)) return false
    return normalizeChatProvider(normalized) === ''
}

export function resolveChatApiKey({ provider, model, apiKey } = {}) {
    const explicit = String(apiKey || '').trim()
    if (explicit) return explicit
    const envNames = API_KEY_ENV_NAMES.get(resolveChatProviderLabel({ provider, model })) || ['OPENAI_API_KEY']
    for (const envName of envNames) {
        const value = String(process.env[envName] || '').trim()
        if (value) return value
    }
    return ''
}

export function resolveChatBaseUrl({ provider, model, baseUrl } = {}) {
    const explicit = String(baseUrl || '').trim()
    if (explicit) return explicit.replace(/\/+$/, '')
    return DEFAULT_BASE_URLS.get(resolveChatProviderLabel({ provider, model })) || OPENAI_DEFAULT_BASE_URL
}

export function supportsCustomTemperature(model) {
    return !/^(gpt-5|o[13-9])/i.test(String(model || '').trim())
}

/**
 * OpenAI's reasoning models reject the legacy `max_tokens` and want `max_completion_tokens`.
 * Everyone else on the OpenAI dialect (OpenRouter, DeepSeek, gpt-4.x) still reads `max_tokens`.
 */
function usesMaxCompletionTokens({ providerLabel, model }) {
    if (providerLabel !== 'openai') return false
    return /^(gpt-5|gpt-6|o[1-9])/i.test(String(model || '').trim())
}

function parsePositiveInt(value) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0) return null
    return Math.floor(parsed)
}

export function resolveMaxOutputTokens(maxTokens) {
    return parsePositiveInt(maxTokens)
        ?? parsePositiveInt(process.env.CHAT_MAX_OUTPUT_TOKENS)
        ?? DEFAULT_MAX_OUTPUT_TOKENS
}

/**
 * Only OpenRouter speaks the normalised `reasoning` object; the other hosts each take their own
 * shape, so this stays empty for them rather than guessing. `CHAT_REASONING_EFFORT=off` sends
 * `effort: "none"`, which is the documented way to switch reasoning off.
 */
export function resolveReasoningEffort({ providerLabel, effort } = {}) {
    if (providerLabel !== 'openrouter') return ''

    const raw = String(effort ?? process.env.CHAT_REASONING_EFFORT ?? '').trim().toLowerCase()
    if (!raw) return DEFAULT_OPENROUTER_REASONING_EFFORT
    if (raw === 'off' || raw === 'disabled' || raw === 'false') return 'none'
    return REASONING_EFFORTS.has(raw) ? raw : DEFAULT_OPENROUTER_REASONING_EFFORT
}

export function resolveRequestTimeoutMs(timeoutMs) {
    return parsePositiveInt(timeoutMs)
        ?? parsePositiveInt(process.env.CHAT_REQUEST_TIMEOUT_MS)
        ?? DEFAULT_REQUEST_TIMEOUT_MS
}

function finiteNumber(value) {
    const parsed = Number(value)
    return value === null || value === undefined || value === '' || !Number.isFinite(parsed)
        ? null
        : parsed
}

/**
 * The provider's own token counts, when it reports them. Report usage used to be priced from the
 * length of the notes and the finished markdown, which cannot see reasoning tokens at all.
 */
export function readProviderUsage(payload, dialect = 'openai') {
    const usage = payload?.usage
    if (!usage || typeof usage !== 'object') return null

    const inputTokens = dialect === 'claude'
        ? [usage.input_tokens, usage.cache_creation_input_tokens, usage.cache_read_input_tokens]
            .reduce((sum, value) => sum + (finiteNumber(value) ?? 0), 0)
        : finiteNumber(usage.prompt_tokens)
    const outputTokens = dialect === 'claude'
        ? finiteNumber(usage.output_tokens)
        : finiteNumber(usage.completion_tokens)

    if (inputTokens === null && outputTokens === null) return null

    return {
        inputTokens: inputTokens ?? 0,
        outputTokens: outputTokens ?? 0,
        totalTokens: finiteNumber(usage.total_tokens) ?? (inputTokens ?? 0) + (outputTokens ?? 0),
        // OpenRouter reports the amount actually charged, in USD.
        costUsd: finiteNumber(usage.cost),
        reasoningTokens: finiteNumber(usage.completion_tokens_details?.reasoning_tokens)
            ?? finiteNumber(usage.output_tokens_details?.reasoning_tokens),
    }
}

async function postJson(fetchImpl, url, options, { errorLabel, timeoutMs }) {
    const signal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined
    try {
        const response = await fetchImpl(url, signal ? { ...options, signal } : options)
        const payload = await response.json().catch(() => ({}))
        return { response, payload, error: null }
    } catch (error) {
        if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
            return {
                response: null,
                payload: null,
                error: `${errorLabel}: request timed out after ${Math.round(timeoutMs / 1000)}s`,
            }
        }
        throw error
    }
}

function normalizeTurns(messages) {
    const turns = []
    for (const message of Array.isArray(messages) ? messages : []) {
        const role = String(message?.role || '').trim().toLowerCase()
        const content = String(message?.content ?? '')
        if (!content.trim()) continue
        if (role !== 'user' && role !== 'assistant') continue
        const last = turns[turns.length - 1]
        // Anthropic rejects consecutive same-role turns, so identical roles fold together. The
        // OpenAI dialect tolerates either shape, and folding keeps both dialects on the same turns.
        if (last && last.role === role) {
            last.content = `${last.content}\n\n${content}`
            continue
        }
        turns.push({ role, content })
    }
    return turns
}

function buildAnthropicRequest({ model, system, messages, jsonMode, temperature, maxTokens }) {
    const systemParts = [String(system || '').trim()].filter(Boolean)
    const turns = normalizeTurns(messages)

    if (turns.length === 0 || turns[0].role !== 'user') {
        turns.unshift({ role: 'user', content: 'Continue.' })
    }

    // Prefilling the assistant turn is the documented way to force JSON without `response_format`.
    const prefilled = jsonMode === true && turns[turns.length - 1].role === 'user'
    if (prefilled) {
        turns.push({ role: 'assistant', content: '{' })
    }

    const body = {
        model,
        max_tokens: Number.isFinite(maxTokens) && maxTokens > 0 ? Math.floor(maxTokens) : ANTHROPIC_DEFAULT_MAX_TOKENS,
        messages: turns,
    }
    if (systemParts.length > 0) {
        body.system = systemParts.join('\n\n')
    }
    if (Number.isFinite(temperature)) {
        body.temperature = temperature
    }

    return { body, prefilled }
}

function readAnthropicText(payload) {
    return (Array.isArray(payload?.content) ? payload.content : [])
        .filter((part) => part && part.type === 'text')
        .map((part) => String(part.text || ''))
        .join('')
        .trim()
}

/**
 * Run one completion and read the text back regardless of dialect.
 *
 * Returns `{ ok, status, text, usage, error }` rather than throwing so each call site keeps its
 * own contextual error message. A reply cut off at the output cap is reported as a failure: half
 * a section or half a JSON object is worse than a retry. `usage` carries the provider's own token
 * counts and, on OpenRouter, the amount it charged.
 */
export async function requestChatCompletion({
    provider,
    model,
    baseUrl,
    apiKey,
    system,
    messages,
    jsonMode = false,
    temperature,
    maxTokens,
    reasoningEffort,
    timeoutMs,
    errorLabel = 'Model request failed',
    fetchImpl = fetch,
} = {}) {
    const resolvedModel = String(model || '').trim()
    if (!resolvedModel) {
        return { ok: false, status: 400, text: '', error: `${errorLabel}: model is required` }
    }

    // The dialect picks the request shape; the label picks the host and the key. They differ for
    // OpenAI-compatible vendors such as OpenRouter, which must not inherit api.openai.com.
    const providerLabel = resolveChatProviderLabel({ provider, model })
    const resolvedProvider = resolveChatProvider({ provider: providerLabel, model })
    const resolvedApiKey = resolveChatApiKey({ provider: providerLabel, apiKey })
    if (!resolvedApiKey) {
        return {
            ok: false,
            status: 401,
            text: '',
            error: `${errorLabel}: no API key configured for the ${providerLabel} provider`,
        }
    }

    const root = resolveChatBaseUrl({ provider: providerLabel, baseUrl })
    const requestTimeoutMs = resolveRequestTimeoutMs(timeoutMs)

    if (resolvedProvider === 'claude') {
        const { body, prefilled } = buildAnthropicRequest({
            model: resolvedModel,
            system,
            messages,
            jsonMode,
            temperature,
            maxTokens,
        })
        const { response, payload, error: transportError } = await postJson(
            fetchImpl,
            `${root}/messages`,
            {
                method: 'POST',
                headers: {
                    'x-api-key': resolvedApiKey,
                    'anthropic-version': ANTHROPIC_API_VERSION,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            },
            { errorLabel, timeoutMs: requestTimeoutMs }
        )
        if (transportError) {
            return { ok: false, status: 0, text: '', usage: null, error: transportError }
        }
        if (!response.ok) {
            return {
                ok: false,
                status: response.status,
                text: '',
                usage: readProviderUsage(payload, 'claude'),
                error: payload?.error?.message || `${errorLabel} (HTTP ${response.status})`,
            }
        }
        if (payload?.stop_reason === 'max_tokens') {
            return {
                ok: false,
                status: response.status,
                text: '',
                usage: readProviderUsage(payload, 'claude'),
                error: `${errorLabel}: reply reached max_tokens (${body.max_tokens}) before finishing`,
            }
        }
        const text = readAnthropicText(payload)
        return {
            ok: true,
            status: response.status,
            text: prefilled ? `{${text.replace(/^\{/, '')}` : text,
            usage: readProviderUsage(payload, 'claude'),
            error: null,
        }
    }

    const requestBody = {
        model: resolvedModel,
        messages: [
            ...(String(system || '').trim() ? [{ role: 'system', content: String(system).trim() }] : []),
            ...normalizeTurns(messages),
        ],
    }
    if (jsonMode === true) {
        requestBody.response_format = { type: 'json_object' }
    }
    if (Number.isFinite(temperature) && supportsCustomTemperature(resolvedModel)) {
        requestBody.temperature = temperature
    }
    // Reasoning tokens are billed as output, so an unbounded request is what turns one section
    // into twenty minutes of thinking. The cap applies to everything on the OpenAI dialect.
    const maxOutputTokens = resolveMaxOutputTokens(maxTokens)
    requestBody[usesMaxCompletionTokens({ providerLabel, model: resolvedModel }) ? 'max_completion_tokens' : 'max_tokens'] = maxOutputTokens

    const resolvedReasoningEffort = resolveReasoningEffort({ providerLabel, effort: reasoningEffort })
    if (resolvedReasoningEffort) {
        requestBody.reasoning = { effort: resolvedReasoningEffort }
    }

    const send = (body) => postJson(
        fetchImpl,
        `${root}/chat/completions`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${resolvedApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        },
        { errorLabel, timeoutMs: requestTimeoutMs }
    )

    let result = await send(requestBody)
    // A host that does not understand the normalised reasoning block rejects the whole request
    // with a 400 rather than ignoring the field, so retry once without it.
    if (!result.error && result.response && !result.response.ok
        && requestBody.reasoning && result.response.status === 400
        && /reasoning/i.test(String(result.payload?.error?.message || ''))) {
        const retryBody = { ...requestBody }
        delete retryBody.reasoning
        result = await send(retryBody)
    }

    const { response, payload, error: transportError } = result
    if (transportError) {
        return { ok: false, status: 0, text: '', usage: null, error: transportError }
    }
    if (!response.ok) {
        return {
            ok: false,
            status: response.status,
            text: '',
            usage: readProviderUsage(payload),
            error: payload?.error?.message || `${errorLabel} (HTTP ${response.status})`,
        }
    }

    const choice = payload?.choices?.[0] || {}
    const usage = readProviderUsage(payload)
    // Most hosts count reasoning against the output cap, so a reasoning model can spend the whole
    // budget thinking and return nothing. Report that instead of an empty section.
    if (choice?.finish_reason === 'length') {
        const reasoningNote = usage?.reasoningTokens
            ? ` (${usage.reasoningTokens} were reasoning tokens)`
            : ''
        return {
            ok: false,
            status: response.status,
            text: '',
            usage,
            error: `${errorLabel}: reply reached the ${maxOutputTokens}-token output cap before finishing${reasoningNote}`,
        }
    }

    return {
        ok: true,
        status: response.status,
        text: String(choice?.message?.content || '').trim(),
        usage,
        error: null,
    }
}
