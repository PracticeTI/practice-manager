import assert from 'node:assert/strict'
import test from 'node:test'

import { generateChat, normalizeChatMessages } from '../src/lib/ai/chat.js'

const PROVIDER_ENV_KEYS = [
    'AI_PROVIDER',
    'AI_MODEL',
    'OPENAI_API_KEY',
    'OPENAI_MODEL',
    'CLAUDE_API_KEY',
    'ANTHROPIC_API_KEY',
    'GEMINI_API_KEY',
    'GOOGLE_GENERATIVE_AI_API_KEY',
    'DEEPSEEK_API_KEY',
]

function withoutProviderKeys(fn) {
    const saved = new Map(PROVIDER_ENV_KEYS.map((key) => [key, process.env[key]]))
    for (const key of PROVIDER_ENV_KEYS) delete process.env[key]
    try {
        return fn()
    } finally {
        for (const [key, value] of saved) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
        }
    }
}

test('messages are normalised and invalid entries dropped', () => {
    const messages = normalizeChatMessages([
        { role: 'user', content: 'hello' },
        { content: 'no role' },
        null,
        { role: 'assistant', content: 42 },
    ])

    assert.deepEqual(messages, [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: '42' },
    ])
})

test('a missing API key is reported as 503 without making a request', async () => {
    await withoutProviderKeys(async () => {
        const result = await generateChat({
            provider: 'openai',
            messages: [{ role: 'user', content: 'hello' }],
        })

        assert.equal(result.ok, false)
        assert.equal(result.status, 503)
        assert.match(result.error, /OpenAI API key is not configured/)
        assert.equal(result.provider, 'openai')
    })
})

test('a model belonging to another vendor is rejected before dispatch', async () => {
    await withoutProviderKeys(async () => {
        const result = await generateChat({
            provider: 'openai',
            model: 'claude-sonnet-4-20250514',
            messages: [{ role: 'user', content: 'hello' }],
        })

        assert.equal(result.ok, false)
        assert.equal(result.status, 400)
        assert.match(result.error, /does not belong to the OpenAI provider/)
    })
})

test('an empty conversation is rejected', async () => {
    await withoutProviderKeys(async () => {
        process.env.OPENAI_API_KEY = 'test-key'
        const result = await generateChat({ provider: 'openai', messages: [] })

        assert.equal(result.ok, false)
        assert.equal(result.status, 400)
    })
})
