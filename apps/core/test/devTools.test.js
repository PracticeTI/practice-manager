import assert from 'node:assert/strict'
import test from 'node:test'

import { DEV_TOOLING_DISABLED_MESSAGE, isDevToolingEnabled } from '../src/lib/devTools.js'

function withNodeEnv(value, fn) {
    const saved = process.env.NODE_ENV
    if (value === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = value
    try {
        return fn()
    } finally {
        if (saved === undefined) delete process.env.NODE_ENV
        else process.env.NODE_ENV = saved
    }
}

test('developer tooling is disabled in production', () => {
    withNodeEnv('production', () => {
        assert.equal(isDevToolingEnabled(), false)
    })
})

test('developer tooling is enabled outside production', () => {
    withNodeEnv('development', () => {
        assert.equal(isDevToolingEnabled(), true)
    })
    withNodeEnv('test', () => {
        assert.equal(isDevToolingEnabled(), true)
    })
})

test('the disabled message explains why the tool cannot run remotely', () => {
    assert.match(DEV_TOOLING_DISABLED_MESSAGE, /developer-only/)
    assert.match(DEV_TOOLING_DISABLED_MESSAGE, /Chrome/)
})
