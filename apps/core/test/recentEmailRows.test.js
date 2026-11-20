import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeRecentEmailRows } from '../src/lib/recentEmailRows.js'

const sharedRecipient = 'admin@example.com'

test('excludes explicitly cross-domain messages that share a recipient', () => {
    const rows = [{
        id: 1,
        category: 'contact_form',
        domain: 'preview-domain',
        to_email: sharedRecipient,
        subject: '[Test] Acme message',
    }]

    assert.deepEqual(normalizeRecentEmailRows(rows, 'domain-b', sharedRecipient), [])
})

test('keeps recipient fallback for legacy messages without a domain', () => {
    const rows = [{
        id: 2,
        category: 'contact_form',
        to_email: sharedRecipient,
        subject: 'Legacy message',
    }]

    assert.deepEqual(
        normalizeRecentEmailRows(rows, 'domain-b', sharedRecipient).map((row) => row.id),
        [2]
    )
})