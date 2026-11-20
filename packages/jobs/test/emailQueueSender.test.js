import test from 'node:test'
import assert from 'node:assert/strict'

// The mail domain is read from the deployment at module load, so set it before importing.
process.env.FORM_ALERT_EMAIL_DOMAIN = 'mail.example.com'
const { buildMessage, resolveContactFormSender } = await import('../src/jobs/emailQueue.js')

test('derives the contact form sender from the domain and the configured mail domain', () => {
    assert.equal(
        resolveContactFormSender('example'),
        'Example Contact Form <example.contact@mail.example.com>'
    )
    assert.equal(resolveContactFormSender(''), '')
})

test('buildMessage uses the domain-derived sender for contact form alerts', () => {
    const message = buildMessage({
        id: 1,
        to_email: 'hello@example.com',
        category: 'contact_form',
        domain: 'example',
        payload_json: JSON.stringify({ domain: 'example', name: 'Jo Bloggs', message: 'Hi there' })
    })

    assert.equal(message.from, 'Example Contact Form <example.contact@mail.example.com>')
    assert.equal(message.category, 'contact_form')
})

test('buildMessage keeps an explicit per-message sender override', () => {
    const message = buildMessage({
        id: 2,
        to_email: 'supplier@example.com',
        category: 'contact_form',
        domain: 'example',
        payload_json: JSON.stringify({ domain: 'example', senderEmail: 'Custom Sender <custom@mail.example.com>' })
    })

    assert.equal(message.from, 'Custom Sender <custom@mail.example.com>')
})

test('buildMessage routes contact form replies to the submitter', () => {
    const message = buildMessage({
        id: 4,
        to_email: 'hello@example.com',
        category: 'contact_form',
        domain: 'example',
        payload_json: JSON.stringify({
            domain: 'example',
            name: 'Jo Bloggs',
            email: 'jo@example.com',
            replyToEmail: 'Jo Bloggs <jo@example.com>'
        })
    })

    assert.equal(message.from, 'Example Contact Form <example.contact@mail.example.com>')
    assert.equal(message.replyTo, 'Jo Bloggs <jo@example.com>')
})

test('buildMessage leaves non contact form alerts on the default EMAIL_FROM', () => {
    const message = buildMessage({
        id: 3,
        to_email: 'ops@example.com',
        category: 'website_backup',
        payload_json: JSON.stringify({ status: 'completed' })
    })

    assert.equal(message.from, null)
})
