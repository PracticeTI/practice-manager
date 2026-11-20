import test from 'node:test'
import assert from 'node:assert/strict'
import {
    CORE_DOMAIN_MODES,
    DEFAULT_CONTENT_DOMAIN,
    DEFAULT_DOMAIN_KEY,
    DEFAULT_DOMAIN_MODE,
    VALID_DOMAIN_MODES,
    detectDomainFromHostname,
    getEffectiveDomainMode,
    getDomainLabel,
    resolveDomainModeFromHeaders,
} from '../src/lib/domainMode.js'

test('the public domain registry contains only the unbranded default', () => {
    assert.deepEqual(CORE_DOMAIN_MODES, [DEFAULT_DOMAIN_KEY])
    assert.deepEqual(VALID_DOMAIN_MODES.filter((mode) => CORE_DOMAIN_MODES.includes(mode)), ['default'])
    assert.ok(VALID_DOMAIN_MODES.includes(DEFAULT_CONTENT_DOMAIN))
    assert.ok(VALID_DOMAIN_MODES.includes(DEFAULT_DOMAIN_MODE))
})

test('detects localhost and configured aliases', () => {
    assert.equal(detectDomainFromHostname('localhost'), DEFAULT_DOMAIN_KEY)
    assert.equal(detectDomainFromHostname('localhost:3000'), DEFAULT_DOMAIN_KEY)

    const previous = process.env.NEXT_PUBLIC_HOSTNAME_DOMAIN_MAP
    process.env.NEXT_PUBLIC_HOSTNAME_DOMAIN_MAP = JSON.stringify({ 'acme.localhost': DEFAULT_DOMAIN_KEY })
    try {
        assert.equal(detectDomainFromHostname('acme.localhost:3000'), DEFAULT_DOMAIN_KEY)
        assert.equal(detectDomainFromHostname('other.localhost:3000'), null)
    } finally {
        if (previous === undefined) delete process.env.NEXT_PUBLIC_HOSTNAME_DOMAIN_MAP
        else process.env.NEXT_PUBLIC_HOSTNAME_DOMAIN_MAP = previous
    }
})

test('ignores malformed or nested localhost aliases', () => {
    assert.equal(detectDomainFromHostname('-invalid.localhost'), null)
    assert.equal(detectDomainFromHostname('preview.invalid.localhost'), null)
    assert.equal(detectDomainFromHostname('unknown.localhost'), null)
})

test('formats domain labels and falls back to the selected default', () => {
    assert.equal(getDomainLabel(DEFAULT_DOMAIN_KEY), 'Default')
    assert.equal(getDomainLabel('north-west'), 'North West')
    assert.equal(getDomainLabel(null), getDomainLabel(DEFAULT_DOMAIN_MODE))
})

test('unrecognized hosts use the overlay default or the public default', () => {
    assert.ok(VALID_DOMAIN_MODES.includes(DEFAULT_DOMAIN_MODE))
    assert.deepEqual(getEffectiveDomainMode('example.com', null), {
        mode: DEFAULT_DOMAIN_MODE,
        source: 'default',
    })
    assert.deepEqual(getEffectiveDomainMode('localhost', null), {
        mode: DEFAULT_DOMAIN_KEY,
        source: 'hostname',
    })
})

test('ignores unknown modes from stored values and explicit overrides', () => {
    assert.deepEqual(getEffectiveDomainMode('example.com', 'unknown-mode'), {
        mode: DEFAULT_DOMAIN_MODE,
        source: 'default',
    })
    assert.deepEqual(getEffectiveDomainMode('localhost', null, '', 'unknown-mode'), {
        mode: DEFAULT_DOMAIN_KEY,
        source: 'hostname',
    })
})

test('server resolution honors valid headers and falls back for unknown hosts', () => {
    const headers = (values) => ({ get: (name) => values[name] ?? null })

    assert.equal(resolveDomainModeFromHeaders(headers({ host: 'localhost:3000' })), DEFAULT_DOMAIN_KEY)
    assert.equal(resolveDomainModeFromHeaders(headers({ host: 'example.com' })), DEFAULT_DOMAIN_MODE)
    assert.equal(
        resolveDomainModeFromHeaders(headers({ 'x-domain-mode-override': 'unknown-mode', host: 'example.com' })),
        DEFAULT_DOMAIN_MODE
    )
})
