import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSourcingItem, findSourcingResponse, scoreSourcingResponse } from '../src/lib/equipmentSourcing.js'
import { baseSourcingSubject, isSourcingInProgress, sourcingStatusLabel } from '../src/lib/equipmentSourcingStatus.js'

// Shapes mirror the real domain-a / patient 9 rows (Lightweight vacuum
// cleaner quoted via GMS Rehab, answered by an inbound "Re: Quote request" email).
const quoteRequestedItem = {
    equipmentType: 'Lightweight vacuum cleaner',
    description: 'Current equipment is too heavy.',
    sourcingStatus: 'quote_requested',
    quoteRequest: {
        supplierId: '127',
        supplierName: 'GMS Rehab',
        toEmail: 'griffinmt@icloud.com',
        subject: 'Quote request — Lightweight vacuum cleaner (TAC 88/10682)',
        queueId: '16',
        requestedAt: '2026-09-16T04:59:25.682Z',
    },
}

const supplierReply = {
    id: 1,
    from_email: 'griffinmt@icloud.com',
    to_email: 'domain-a.sourcing@mail.example.com',
    category: 'quote_response',
    subject: 'Re: Quote request — Lightweight vacuum cleaner (TAC 88/10682)',
    text_body: 'Hi Kate,\n\nPlease find requested details below:\n-Large vacuum, $149 incl GST\n\nRegards, Janet\n\n> On 16 Sep 2026, at 3:00 pm, Acme OT Sourcing wrote:\n> Hello GMS Rehab team,',
    created_at: '2026-09-16T06:03:27.866Z',
}

test('strips reply/fwd prefixes when comparing subjects', () => {
    assert.equal(
        baseSourcingSubject('Re: Quote request — Lightweight vacuum cleaner (TAC 88/10682)'),
        baseSourcingSubject('Quote request — Lightweight vacuum cleaner (TAC 88/10682)'),
    )
    assert.equal(baseSourcingSubject('FWD: Re: hello  world'), 'hello world')
})

test('matches a supplier reply by sender + thread subject', () => {
    const score = scoreSourcingResponse(quoteRequestedItem, supplierReply)
    assert.equal(score, 4)

    const match = findSourcingResponse(quoteRequestedItem, [supplierReply])
    assert.equal(match.matchCount, 1)
    assert.equal(match.message.id, 1)
})

test('ignores messages that predate the quote request', () => {
    const earlier = { ...supplierReply, created_at: '2026-09-15T04:59:25.682Z' }
    assert.equal(scoreSourcingResponse(quoteRequestedItem, earlier), 0)
    assert.equal(findSourcingResponse(quoteRequestedItem, [earlier]), null)
})

test('ignores unrelated inbound mail', () => {
    const unrelated = {
        id: 2,
        from_email: 'someone@example.com',
        subject: 'Invoice for September',
        text_body: 'Please see attached.',
        created_at: '2026-09-16T06:30:00.000Z',
    }
    assert.equal(scoreSourcingResponse(quoteRequestedItem, unrelated), 0)
    assert.equal(findSourcingResponse(quoteRequestedItem, [unrelated]), null)
})

test('falls back to the item name when the supplier rewrites the subject', () => {
    const rewritten = {
        ...supplierReply,
        id: 3,
        subject: 'Vacuum quote',
        text_body: 'Here is pricing for the lightweight vacuum cleaner you asked about.',
    }
    assert.equal(scoreSourcingResponse(quoteRequestedItem, rewritten), 2)
})

test('items without a quote request never match', () => {
    assert.equal(scoreSourcingResponse({ equipmentType: 'Steam mop' }, supplierReply), 0)
})

test('builds an in-progress sourcing item from a matched reply', () => {
    const item = buildSourcingItem({
        domain: 'domain-a',
        patientId: 9,
        patientName: 'Test Patient',
        itemIndex: 0,
        suggestion: quoteRequestedItem,
        inboundMessages: [supplierReply],
    })

    assert.equal(item.status, 'quote_received')
    assert.equal(item.statusLabel, 'Quote received')
    assert.equal(item.supplierName, 'GMS Rehab')
    assert.equal(item.requestedAt, '2026-09-16T04:59:25.682Z')
    assert.equal(item.lastActivityAt, '2026-09-16T06:03:27.866Z')
    assert.equal(item.href, '/admin/patients?patientId=9&tab=equipment')
    // The quoted copy of our own request is stripped from the preview.
    assert.match(item.response.preview, /^Hi Kate, Please find requested details below:/)
    assert.doesNotMatch(item.response.preview, /Acme OT Sourcing wrote/)
})

test('keeps the quote-requested status while no reply has arrived', () => {
    const item = buildSourcingItem({
        domain: 'domain-a',
        patientId: 9,
        patientName: null,
        itemIndex: 0,
        suggestion: quoteRequestedItem,
        inboundMessages: [],
    })

    assert.equal(item.status, 'quote_requested')
    assert.equal(item.response, null)
    assert.equal(item.lastActivityAt, '2026-09-16T04:59:25.682Z')
})

test('status helpers classify in-progress states', () => {
    assert.equal(isSourcingInProgress('quote_requested'), true)
    assert.equal(isSourcingInProgress('quote_received'), true)
    assert.equal(isSourcingInProgress('unsourced'), false)
    assert.equal(sourcingStatusLabel(undefined), 'Unsourced')
})

test('exposes the supplier favicon captured when the request was sent', () => {
    const item = buildSourcingItem({
        domain: 'domain-a',
        patientId: 9,
        patientName: 'Test Patient',
        itemIndex: 0,
        suggestion: {
            ...quoteRequestedItem,
            quoteRequest: { ...quoteRequestedItem.quoteRequest, supplierDomain: 'gmsrehab.com.au' },
        },
        inboundMessages: [],
    })

    assert.equal(item.supplierDomain, 'gmsrehab.com.au')
    assert.equal(
        item.supplierLogoUrl,
        'https://www.google.com/s2/favicons?domain=gmsrehab.com.au&sz=128',
    )
})

test('falls back to no favicon for requests sent before the domain was captured', () => {
    const item = buildSourcingItem({
        domain: 'domain-a',
        patientId: 9,
        patientName: 'Test Patient',
        itemIndex: 0,
        suggestion: quoteRequestedItem,
        inboundMessages: [],
    })

    assert.equal(item.supplierDomain, null)
    assert.equal(item.supplierLogoUrl, '')
})
