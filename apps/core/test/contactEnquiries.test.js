// Tests for the website-enquiry queue.
//
// A contact form submission is only ever a `contact_form` row in the outbound email
// queue, so what matters here is which rows the practice-wide Tasks view treats as
// somebody waiting for a reply: a real submission yes, a Settings routing test no.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
    CONTACT_ENQUIRY_CATEGORY,
    isTestContactEnquiryRow,
    loadUnreviewedContactEnquiries,
    normalizeContactEnquiryRow,
} from '../src/lib/contactEnquiryReview.js'

const submissionRow = (overrides = {}) => ({
    id: 44,
    domain: 'domain-a',
    category: 'contact_form',
    subject: '',
    created_at: '2026-11-11T04:35:28.724Z',
    payload_json: JSON.stringify({
        name: 'Mary Mary',
        email: 'Mary@Mary.com',
        subject: 'Website Enquiry',
        message: 'Just testing out this contact form.',
        source: 'one-contact-form',
        domain: 'domain-a',
    }),
    ...overrides,
})

test('a submission becomes the row the Tasks queue lists', () => {
    const enquiry = normalizeContactEnquiryRow(submissionRow())

    assert.equal(enquiry.id, 44)
    assert.equal(enquiry.name, 'Mary Mary')
    assert.equal(enquiry.email, 'mary@mary.com')
    assert.equal(enquiry.subject, 'Website Enquiry')
    assert.equal(enquiry.message, 'Just testing out this contact form.')
    assert.equal(enquiry.createdAt, '2026-11-11T04:35:28.724Z')
})

test('the Settings routing test is not somebody waiting for a reply', () => {
    const routingTest = submissionRow({
        payload_json: JSON.stringify({
            name: 'Admin Test Submission',
            subject: '[Test] Contact email routing (domain-a)',
            source: 'one-admin-domain-settings-test',
        }),
    })

    assert.equal(isTestContactEnquiryRow(routingTest), true)
    assert.equal(normalizeContactEnquiryRow(routingTest), null)
})

test('a row with nothing to link to is dropped instead of rendered', () => {
    assert.equal(normalizeContactEnquiryRow(null), null)
    assert.equal(normalizeContactEnquiryRow({ name: 'No id' }), null)
})

test('the queue asks only for unreviewed enquiries and tolerates a queue table without the marker', async () => {
    const queries = []
    const connection = {
        query: async (sql, values) => {
            queries.push({ sql, values })
            if (queries.length === 1) {
                const error = new Error('column "reviewed_at" does not exist')
                error.code = '42703'
                throw error
            }
            return { rows: [submissionRow(), submissionRow({ id: 45, payload_json: '{"name":"Test","source":"one-admin-domain-settings-test"}' })] }
        },
    }

    const enquiries = await loadUnreviewedContactEnquiries(connection, { domain: 'domain-a', table: 'outbound_messages' })

    assert.equal(queries.length, 2)
    assert.match(queries[0].sql, /reviewed_at IS NULL/)
    assert.doesNotMatch(queries[1].sql, /reviewed_at/)
    assert.deepEqual(queries[0].values, ['domain-a', CONTACT_ENQUIRY_CATEGORY, 100])

    // The routing test in the fallback result is still filtered out in JavaScript.
    assert.deepEqual(enquiries.map((enquiry) => enquiry.id), [44])
})

test('a query failure that is not the missing marker is surfaced', async () => {
    const connection = {
        query: async () => {
            const error = new Error('relation "outbound_messages" does not exist')
            error.code = '42P01'
            throw error
        },
    }

    await assert.rejects(
        () => loadUnreviewedContactEnquiries(connection, { domain: 'domain-a' }),
        /outbound_messages/
    )
})
