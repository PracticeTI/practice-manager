import test from 'node:test'
import assert from 'node:assert/strict'
import { isContactDeliveryDisabled, resolveContactRecipient } from '../src/lib/contactRecipient.js'

test('prefers the recipient configured in Settings → Domains', () => {
    assert.equal(
        resolveContactRecipient('example-domain', { contactEmailDelivery: { recipient: 'Enquiries@Example.com' } }),
        'enquiries@example.com'
    )
    assert.equal(resolveContactRecipient('example-domain', { emailContact: 'hello@example.com' }), 'hello@example.com')
    assert.equal(
        resolveContactRecipient('example-domain', {
            contactEmailDelivery: { recipient: 'delivery@example.com' },
            emailContact: 'legacy@example.com',
        }),
        'delivery@example.com'
    )
})

test('returns nothing when no recipient is configured', () => {
    // Core domains declare no descriptor default, so an empty entry means the form stays closed.
    assert.equal(resolveContactRecipient('example-domain', {}), '')
    assert.equal(resolveContactRecipient('default', null), '')
    assert.equal(resolveContactRecipient('', { emailContact: 'hello@example.com' }), 'hello@example.com')
    assert.equal(resolveContactRecipient('example-domain', { contactEmailDelivery: { recipient: 'not-an-email' } }), '')
})

test('honours an explicit delivery shutdown from Settings → Domains', () => {
    assert.equal(isContactDeliveryDisabled({ contactEmailDelivery: { enabled: false } }), true)
    assert.equal(isContactDeliveryDisabled({ contactEmailDelivery: { enabled: true } }), false)
    assert.equal(isContactDeliveryDisabled({}), false)
    assert.equal(isContactDeliveryDisabled(null), false)
})
