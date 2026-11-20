import assert from 'node:assert/strict'
import test from 'node:test'
import {
    parseResendInboundPayload,
    inferDomainFromRecipient,
    inferCategory,
    normalizeEmailAddress,
    normalizeEmailList
} from '../src/lib/inboundMessages.js'
import { DEFAULT_CONTENT_DOMAIN } from '../src/lib/domainMode.js'

test('normalizeEmailAddress handles plain and angle-bracketed emails', () => {
    assert.equal(normalizeEmailAddress('test@example.com'), 'test@example.com')
    assert.equal(normalizeEmailAddress('Jane Doe <jane@example.com>'), 'jane@example.com')
    assert.equal(normalizeEmailAddress({ email: 'OBJ@Example.COM ' }), 'obj@example.com')
    assert.equal(normalizeEmailAddress(''), '')
    assert.equal(normalizeEmailAddress(null), '')
})

test('normalizeEmailList handles arrays and single strings', () => {
    assert.deepEqual(normalizeEmailList(['Jane <jane@example.com>', 'bob@example.com']), ['jane@example.com', 'bob@example.com'])
    assert.deepEqual(normalizeEmailList('single@example.com'), ['single@example.com'])
    assert.deepEqual(normalizeEmailList(null), [])
})

test('inferDomainFromRecipient correctly extracts domain', () => {
    assert.equal(inferDomainFromRecipient('default.sourcing@practice.au'), 'default')
    assert.equal(inferDomainFromRecipient('contact@default.example'), 'default')
    assert.equal(inferDomainFromRecipient('unknown@otherdomain.com'), DEFAULT_CONTENT_DOMAIN)
    assert.equal(inferDomainFromRecipient('any@other.com', 'customdomain'), 'customdomain')
})

test('inferCategory recognizes quote responses, replies, and general emails', () => {
    assert.equal(inferCategory('Re: Equipment Quote Request #123', 'Here is our quotation.'), 'quote_response')
    assert.equal(inferCategory('Re: Follow up', 'Thanks for getting back.'), 'email_reply')
    assert.equal(inferCategory('New contact form submission', 'I would like to inquire...'), 'contact_inquiry')
    assert.equal(inferCategory('Patient Referral Notice', 'Clinical details attached'), 'clinical_intake')
    assert.equal(inferCategory('General update', 'Just checking in'), 'inbound_email')
})

test('parseResendInboundPayload handles Resend email.received webhook event', () => {
    const webhookBody = {
        type: 'email.received',
        created_at: '2026-09-16T12:00:00Z',
        data: {
            email_id: 're_123456789',
            from: 'Supplier Sales <sales@wheelchairs.com.au>',
            to: ['default.sourcing@practice.au'],
            subject: 'Quote for Wheelchair Model X',
            text: 'We have stock available at $1,250.00 each.',
            html: '<p>We have stock available at $1,250.00 each.</p>',
            headers: { 'message-id': '<abc@wheelchairs.com.au>' }
        }
    }

    const parsed = parseResendInboundPayload(webhookBody)
    assert.equal(parsed.fromEmail, 'sales@wheelchairs.com.au')
    assert.equal(parsed.toEmail, 'default.sourcing@practice.au')
    assert.equal(parsed.domain, 'default')
    assert.equal(parsed.category, 'quote_response')
    assert.equal(parsed.subject, 'Quote for Wheelchair Model X')
    assert.equal(parsed.textBody, 'We have stock available at $1,250.00 each.')
    assert.equal(parsed.provider, 'resend')
    assert.equal(parsed.providerMessageId, 're_123456789')
})

test('parseResendInboundPayload handles direct receiving payload format', () => {
    const directBody = {
        id: 'msg_987654',
        from: 'client@example.com',
        to: ['hello@default.example'],
        subject: 'Feedback regarding recent shoot',
        text: 'Great work on the patient note.',
        html: '<div>Great work on the patient note.</div>'
    }

    const parsed = parseResendInboundPayload(directBody)
    assert.equal(parsed.fromEmail, 'client@example.com')
    assert.equal(parsed.toEmail, 'hello@default.example')
    assert.equal(parsed.domain, 'default')
    assert.equal(parsed.category, 'inbound_email')
    assert.equal(parsed.subject, 'Feedback regarding recent shoot')
    assert.equal(parsed.providerMessageId, 'msg_987654')
})
