import test from 'node:test'
import assert from 'node:assert/strict'
import {
    requestChatCompletion,
    resolveChatProvider,
    resolveChatProviderLabel,
    resolveChatBaseUrl,
    resolveChatApiKey,
    isUnsupportedChatProvider,
} from '../src/jobs/chatModelRequest.js'

function stubFetch(handler) {
    const originalFetch = globalThis.fetch
    const requests = []
    globalThis.fetch = async (url, options) => {
        const request = { url, options, body: JSON.parse(options.body) }
        requests.push(request)
        return handler(request)
    }
    return {
        requests,
        restore() {
            globalThis.fetch = originalFetch
        },
    }
}

test('resolves a blank provider from the model id so pre-provider rows still route', () => {
    assert.equal(resolveChatProvider({ provider: '', model: 'claude-opus-5-5' }), 'claude')
    assert.equal(resolveChatProvider({ provider: 'anthropic', model: '' }), 'claude')
    assert.equal(resolveChatProvider({ provider: '', model: 'gpt-5.6-sol' }), 'openai')
    assert.equal(resolveChatProvider({ provider: 'claude', model: 'gpt-5.6-sol' }), 'claude')
})

test('sends the Anthropic Messages dialect for claude', async () => {
    const stub = stubFetch(() => ({
        ok: true,
        status: 200,
        json: async () => ({
            content: [{ type: 'text', text: 'Section draft.' }],
            stop_reason: 'end_turn',
        }),
    }))

    try {
        const result = await requestChatCompletion({
            provider: 'claude',
            model: 'claude-opus-5-5',
            apiKey: 'claude-key',
            system: 'You are an occupational therapist.',
            messages: [{ role: 'user', content: 'Write the section.' }],
        })

        assert.equal(result.ok, true)
        assert.equal(result.text, 'Section draft.')

        const [request] = stub.requests
        assert.match(request.url, /api\.anthropic\.com\/v1\/messages$/)
        assert.equal(request.options.headers['x-api-key'], 'claude-key')
        assert.equal(request.options.headers['anthropic-version'], '2023-06-01')
        assert.equal(request.body.system, 'You are an occupational therapist.')
        assert.deepEqual(request.body.messages, [{ role: 'user', content: 'Write the section.' }])
        assert.ok(request.body.max_tokens > 0)
    } finally {
        stub.restore()
    }
})

test('forces JSON on claude by prefilling the assistant turn', async () => {
    const stub = stubFetch(() => ({
        ok: true,
        status: 200,
        json: async () => ({
            content: [{ type: 'text', text: '"household_goals": "Stay at home."}' }],
            stop_reason: 'end_turn',
        }),
    }))

    try {
        const result = await requestChatCompletion({
            provider: 'claude',
            model: 'claude-opus-5-5',
            apiKey: 'claude-key',
            system: 'Return valid JSON only.',
            messages: [{ role: 'user', content: 'Extract the fields.' }],
            jsonMode: true,
        })

        const [request] = stub.requests
        assert.deepEqual(request.body.messages.at(-1), { role: 'assistant', content: '{' })
        assert.equal(result.text, '{"household_goals": "Stay at home."}')
        assert.equal(JSON.parse(result.text).household_goals, 'Stay at home.')
    } finally {
        stub.restore()
    }
})

test('reports a claude reply cut off at max_tokens instead of returning half a section', async () => {
    const stub = stubFetch(() => ({
        ok: true,
        status: 200,
        json: async () => ({
            content: [{ type: 'text', text: 'Half a sect' }],
            stop_reason: 'max_tokens',
        }),
    }))

    try {
        const result = await requestChatCompletion({
            provider: 'claude',
            model: 'claude-opus-5-5',
            apiKey: 'claude-key',
            system: 'Write the section.',
            messages: [{ role: 'user', content: 'Write the section.' }],
            maxTokens: 16,
            errorLabel: 'Report section generation failed',
        })

        assert.equal(result.ok, false)
        assert.match(result.error, /max_tokens/)
    } finally {
        stub.restore()
    }
})

test('keeps the OpenAI chat-completions dialect, including system message and temperature rules', async () => {
    const stub = stubFetch(() => ({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }),
    }))

    try {
        const result = await requestChatCompletion({
            provider: 'openai',
            model: 'gpt-5.6-sol',
            apiKey: 'openai-key',
            baseUrl: 'https://api.openai.com/v1/',
            system: 'Return valid JSON only.',
            messages: [{ role: 'user', content: 'Extract the fields.' }],
            jsonMode: true,
            temperature: 0.1,
        })

        assert.equal(result.text, '{"ok":true}')

        const [request] = stub.requests
        assert.equal(request.url, 'https://api.openai.com/v1/chat/completions')
        assert.equal(request.options.headers.Authorization, 'Bearer openai-key')
        assert.equal(request.body.messages[0].role, 'system')
        assert.deepEqual(request.body.response_format, { type: 'json_object' })
        // gpt-5 rejects a non-default temperature, so it must be omitted rather than sent.
        assert.equal('temperature' in request.body, false)
    } finally {
        stub.restore()
    }
})

test('fails loudly when no key is configured for the resolved provider', async () => {
    const originalClaudeKey = process.env.CLAUDE_API_KEY
    const originalAnthropicKey = process.env.ANTHROPIC_API_KEY
    delete process.env.CLAUDE_API_KEY
    delete process.env.ANTHROPIC_API_KEY

    try {
        const result = await requestChatCompletion({
            provider: 'claude',
            model: 'claude-opus-5-5',
            system: 'Write the section.',
            messages: [{ role: 'user', content: 'Write the section.' }],
        })

        assert.equal(result.ok, false)
        assert.match(result.error, /no API key configured for the claude provider/)
    } finally {
        if (originalClaudeKey !== undefined) process.env.CLAUDE_API_KEY = originalClaudeKey
        if (originalAnthropicKey !== undefined) process.env.ANTHROPIC_API_KEY = originalAnthropicKey
    }
})

test('treats OpenRouter and DeepSeek as OpenAI-dialect providers instead of blocking them', () => {
    for (const provider of ['openrouter', 'deepseek']) {
        assert.equal(resolveChatProvider({ provider, model: 'vendor/model' }), 'openai', provider)
        assert.equal(isUnsupportedChatProvider(provider), false, provider)
    }
    // Gemini speaks its own native API, so it stays unsupported rather than being guessed at.
    assert.equal(isUnsupportedChatProvider('gemini'), true)
})

test('keeps the real provider as the label while using the OpenAI dialect on the wire', () => {
    assert.equal(resolveChatProviderLabel({ provider: 'openrouter', model: 'xiaomi/mimo-v2.6-pro' }), 'openrouter')
    assert.equal(resolveChatProvider({ provider: 'openrouter', model: 'xiaomi/mimo-v2.6-pro' }), 'openai')
    assert.equal(resolveChatProviderLabel({ provider: 'anthropic', model: 'claude-opus-5-5' }), 'claude')
})

test('defaults the OpenRouter base URL to its own host, not OpenAI', () => {
    assert.equal(resolveChatBaseUrl({ provider: 'openrouter' }), 'https://openrouter.ai/api/v1')
    assert.equal(resolveChatBaseUrl({ provider: 'deepseek' }), 'https://api.deepseek.com/v1')
    assert.equal(resolveChatBaseUrl({ provider: 'claude' }), 'https://api.anthropic.com/v1')
    // An explicit baseUrl from the queued payload always wins.
    assert.equal(resolveChatBaseUrl({ provider: 'openrouter', baseUrl: 'https://proxy.test/v1/' }), 'https://proxy.test/v1')
})

test('falls back to the OpenRouter env key for an OpenRouter run', () => {
    const original = process.env.OPENROUTER_API_KEY
    process.env.OPENROUTER_API_KEY = 'or-key'
    try {
        assert.equal(resolveChatApiKey({ provider: 'openrouter' }), 'or-key')
        // An explicit key on the payload still takes precedence.
        assert.equal(resolveChatApiKey({ provider: 'openrouter', apiKey: 'payload-key' }), 'payload-key')
        // The OpenAI key must not be borrowed for a different vendor.
        const originalOpenAi = process.env.OPENAI_API_KEY
        process.env.OPENAI_API_KEY = 'openai-key'
        try {
            assert.equal(resolveChatApiKey({ provider: 'openrouter' }), 'or-key')
        } finally {
            if (originalOpenAi === undefined) delete process.env.OPENAI_API_KEY
            else process.env.OPENAI_API_KEY = originalOpenAi
        }
    } finally {
        if (original === undefined) delete process.env.OPENROUTER_API_KEY
        else process.env.OPENROUTER_API_KEY = original
    }
})

test('posts an OpenRouter run to its chat-completions endpoint with the namespaced model', async () => {
    const stub = stubFetch(() => ({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'Section draft.' } }] }),
    }))

    try {
        const result = await requestChatCompletion({
            provider: 'openrouter',
            model: 'xiaomi/mimo-v2.6-pro',
            apiKey: 'or-key',
            system: 'Write the section.',
            messages: [{ role: 'user', content: 'Write the section.' }],
        })

        assert.equal(result.ok, true)
        const [request] = stub.requests
        assert.equal(request.url, 'https://openrouter.ai/api/v1/chat/completions')
        assert.equal(request.options.headers.Authorization, 'Bearer or-key')
        assert.equal(request.body.model, 'xiaomi/mimo-v2.6-pro')
        assert.equal(request.body.messages[0].role, 'system')
    } finally {
        stub.restore()
    }
})

test('bounds an OpenRouter call and dials its reasoning down from the model default', async () => {
    const stub = stubFetch(() => ({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'Section draft.' }, finish_reason: 'stop' }] }),
    }))

    try {
        await requestChatCompletion({
            provider: 'openrouter',
            model: 'moonshotai/kimi-k3',
            apiKey: 'or-key',
            system: 'Write the section.',
            messages: [{ role: 'user', content: 'Write the section.' }],
        })

        const [request] = stub.requests
        // Without a cap a reasoning model can spend unbounded tokens before writing a word.
        assert.equal(request.body.max_tokens > 0, true)
        // kimi-k3 reports default_effort "max"; the worker must not inherit that.
        assert.deepEqual(request.body.reasoning, { effort: 'low' })
        // OpenAI's own reasoning models reject max_tokens for max_completion_tokens.
        assert.equal('max_completion_tokens' in request.body, false)
    } finally {
        stub.restore()
    }
})

test('honours CHAT_REASONING_EFFORT and can switch reasoning off entirely', async () => {
    const stub = stubFetch(() => ({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'Draft.' } }] }),
    }))
    const original = process.env.CHAT_REASONING_EFFORT

    try {
        process.env.CHAT_REASONING_EFFORT = 'medium'
        await requestChatCompletion({
            provider: 'openrouter',
            model: 'qwen/qwen3.8-2.4t-a95b',
            apiKey: 'or-key',
            messages: [{ role: 'user', content: 'Write it.' }],
        })
        assert.deepEqual(stub.requests.at(-1).body.reasoning, { effort: 'medium' })

        process.env.CHAT_REASONING_EFFORT = 'off'
        await requestChatCompletion({
            provider: 'openrouter',
            model: 'qwen/qwen3.8-2.4t-a95b',
            apiKey: 'or-key',
            messages: [{ role: 'user', content: 'Write it.' }],
        })
        assert.deepEqual(stub.requests.at(-1).body.reasoning, { effort: 'none' })
    } finally {
        stub.restore()
        if (original === undefined) delete process.env.CHAT_REASONING_EFFORT
        else process.env.CHAT_REASONING_EFFORT = original
    }
})

test('retries once without the reasoning block when a host rejects it', async () => {
    let calls = 0
    const stub = stubFetch(() => {
        calls += 1
        if (calls === 1) {
            return {
                ok: false,
                status: 400,
                json: async () => ({ error: { message: 'reasoning is not supported for this model' } }),
            }
        }
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Draft.' } }] }) }
    })

    try {
        const result = await requestChatCompletion({
            provider: 'openrouter',
            model: 'xiaomi/mimo-v2.6-pro',
            apiKey: 'or-key',
            messages: [{ role: 'user', content: 'Write it.' }],
        })

        assert.equal(result.ok, true)
        assert.equal(result.text, 'Draft.')
        assert.equal(stub.requests.length, 2)
        assert.deepEqual(stub.requests[0].body.reasoning, { effort: 'low' })
        assert.equal('reasoning' in stub.requests[1].body, false)
        // The retry must keep the output cap.
        assert.equal(stub.requests[1].body.max_tokens > 0, true)
    } finally {
        stub.restore()
    }
})

test('uses max_completion_tokens for an OpenAI reasoning model', async () => {
    const stub = stubFetch(() => ({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'Report.' } }] }),
    }))

    try {
        await requestChatCompletion({
            provider: 'openai',
            model: 'gpt-5.6-sol',
            apiKey: 'openai-key',
            messages: [{ role: 'user', content: 'Write it.' }],
        })

        const [request] = stub.requests
        assert.equal(request.body.max_completion_tokens > 0, true)
        assert.equal('max_tokens' in request.body, false)
        // Only OpenRouter gets the normalised reasoning block.
        assert.equal('reasoning' in request.body, false)
    } finally {
        stub.restore()
    }
})

test('fails a reply cut off at the output cap instead of returning half a section', async () => {
    const stub = stubFetch(() => ({
        ok: true,
        status: 200,
        json: async () => ({
            choices: [{ message: { content: 'Half a sect' }, finish_reason: 'length' }],
            usage: { prompt_tokens: 900, completion_tokens: 200, completion_tokens_details: { reasoning_tokens: 199 } },
        }),
    }))

    try {
        const result = await requestChatCompletion({
            provider: 'openrouter',
            model: 'moonshotai/kimi-k3',
            apiKey: 'or-key',
            messages: [{ role: 'user', content: 'Write it.' }],
            maxTokens: 200,
            errorLabel: 'Report section generation failed',
        })

        assert.equal(result.ok, false)
        assert.match(result.error, /output cap/)
        assert.match(result.error, /199 were reasoning tokens/)
    } finally {
        stub.restore()
    }
})

test('returns a timed-out request as a failure instead of hanging the job', async () => {
    const stub = stubFetch(({ options }) => new Promise((resolve, reject) => {
        options.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'TimeoutError'))
        })
    }))

    try {
        const started = Date.now()
        const result = await requestChatCompletion({
            provider: 'openrouter',
            model: 'moonshotai/kimi-k3',
            apiKey: 'or-key',
            messages: [{ role: 'user', content: 'Write it.' }],
            timeoutMs: 20,
        })

        assert.equal(result.ok, false)
        assert.match(result.error, /timed out/)
        // A hung upstream must not hold the worker for the length of the provider's timeout.
        assert.ok(Date.now() - started < 5000)
    } finally {
        stub.restore()
    }
})

test('reports the provider usage, including reasoning tokens and the OpenRouter charge', async () => {
    const stub = stubFetch(() => ({
        ok: true,
        status: 200,
        json: async () => ({
            choices: [{ message: { content: 'Draft.' } }],
            usage: {
                prompt_tokens: 1200,
                completion_tokens: 3400,
                total_tokens: 4600,
                cost: 0.0548,
                completion_tokens_details: { reasoning_tokens: 2600 },
            },
        }),
    }))

    try {
        const result = await requestChatCompletion({
            provider: 'openrouter',
            model: 'moonshotai/kimi-k3',
            apiKey: 'or-key',
            messages: [{ role: 'user', content: 'Write it.' }],
        })

        assert.deepEqual(
            { ...result.usage },
            {
                inputTokens: 1200,
                outputTokens: 3400,
                totalTokens: 4600,
                costUsd: 0.0548,
                reasoningTokens: 2600,
            }
        )
    } finally {
        stub.restore()
    }
})
