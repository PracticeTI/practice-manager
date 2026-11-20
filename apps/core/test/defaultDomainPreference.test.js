import test from 'node:test'
import assert from 'node:assert/strict'
import {
    DEFAULT_DOMAIN_STORAGE_KEY,
    clearStoredDefaultDomain,
    readStoredDefaultDomain,
    writeStoredDefaultDomain,
} from '../src/lib/defaultDomainPreference.js'

function createStorage(initial = {}) {
    const values = new Map(Object.entries(initial))
    return {
        getItem: (key) => (values.has(key) ? values.get(key) : null),
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: (key) => values.delete(key),
        entries: () => Object.fromEntries(values),
    }
}

test('reads the current preference key', () => {
    const storage = createStorage({ [DEFAULT_DOMAIN_STORAGE_KEY]: 'acme' })
    assert.equal(DEFAULT_DOMAIN_STORAGE_KEY, 'default_domain_v1')
    assert.equal(readStoredDefaultDomain(storage), 'acme')
})

test('migrates a preference saved under the retired key', () => {
    const storage = createStorage({ default_scout_v1: 'acme' })

    assert.equal(readStoredDefaultDomain(storage), 'acme')
    assert.deepEqual(storage.entries(), { [DEFAULT_DOMAIN_STORAGE_KEY]: 'acme' })
})

test('returns null when nothing is stored', () => {
    assert.equal(readStoredDefaultDomain(createStorage()), null)
})

test('writes and clears the preference', () => {
    const storage = createStorage()

    writeStoredDefaultDomain('acme', storage)
    assert.equal(readStoredDefaultDomain(storage), 'acme')

    clearStoredDefaultDomain(storage)
    assert.equal(readStoredDefaultDomain(storage), null)
})
