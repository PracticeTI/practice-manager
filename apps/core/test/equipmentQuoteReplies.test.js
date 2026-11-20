import test from 'node:test'
import assert from 'node:assert/strict'
import {
    buildEquipmentQuoteReplyAlert,
    describeEquipmentQuoteReplyAlert,
    findEquipmentQuoteReplyMatches,
} from '../src/lib/equipmentQuoteReplies.js'

const SOURCING_ITEMS = [
    {
        name: 'Lightweight vacuum cleaner',
        patientId: 41,
        patientName: 'Avery Sample',
        supplierName: 'Mobility Hire Co',
        response: {
            id: 902,
            fromEmail: 'quotes@mobilityhire.com.au',
            subject: 'Re: Equipment quote request - Lightweight vacuum cleaner',
            preview: 'We can supply the vacuum for $420.',
            receivedAt: '2026-10-14T23:30:00.000Z',
        },
    },
    {
        name: 'Shower stool',
        patientId: 41,
        patientName: 'Avery Sample',
        supplierName: 'Bathroom Aids',
        response: {
            id: 903,
            fromEmail: 'sales@supplier.example',
            subject: 'Re: Equipment quote request - Shower stool',
            preview: 'The shower stool is $180.',
            receivedAt: '2026-10-14T22:00:00.000Z',
        },
    },
    { name: 'Riser recliner', patientId: 42, patientName: 'Ana Bell', response: null },
]

test('matches only the item whose supplier reply is the inbound message', () => {
    const matches = findEquipmentQuoteReplyMatches(SOURCING_ITEMS, 902)

    assert.equal(matches.length, 1)
    assert.equal(matches[0].name, 'Lightweight vacuum cleaner')
})

test('matches nothing when the inbound message answers no item', () => {
    assert.deepEqual(findEquipmentQuoteReplyMatches(SOURCING_ITEMS, 903).map((item) => item.name), ['Shower stool'])
    assert.deepEqual(findEquipmentQuoteReplyMatches(SOURCING_ITEMS, 999), [])
    assert.deepEqual(findEquipmentQuoteReplyMatches(SOURCING_ITEMS, null), [])
    assert.deepEqual(findEquipmentQuoteReplyMatches(null, 902), [])
})

test('builds the alert email and the payload the feed reads', () => {
    const matches = findEquipmentQuoteReplyMatches(SOURCING_ITEMS, 902)
    const alert = buildEquipmentQuoteReplyAlert({
        domain: 'example-domain',
        matches,
        senderEmail: 'Example Therapy Sourcing <example.sourcing@mail.example.com>',
        replyToEmail: 'Kate <kate@example.com>',
        sourcingUrl: 'https://example.com/admin/sourcing',
    })

    assert.equal(alert.title, 'Quote reply from Mobility Hire Co')
    assert.equal(alert.summary, 'Lightweight vacuum cleaner · Avery Sample')
    assert.equal(alert.subject, 'Quote reply from Mobility Hire Co · Lightweight vacuum cleaner · Avery Sample')
    assert.match(alert.text, /Item: Lightweight vacuum cleaner · Avery Sample/)
    assert.match(alert.text, /We can supply the vacuum for \$420\./)
    assert.match(alert.text, /https:\/\/example\.com\/admin\/sourcing/)
    assert.match(alert.html, /<a href="https:\/\/example\.com\/admin\/sourcing">/)
    assert.deepEqual(alert.payload, {
        domain: 'example-domain',
        source: 'one:equipment-quote-reply-alert',
        supplierEmail: 'quotes@mobilityhire.com.au',
        supplierName: 'Mobility Hire Co',
        replySubject: 'Re: Equipment quote request - Lightweight vacuum cleaner',
        preview: 'We can supply the vacuum for $420.',
        inboundMessageId: 902,
        receivedAt: '2026-10-14T23:30:00.000Z',
        items: [
            {
                patientId: 41,
                patientName: 'Avery Sample',
                itemName: 'Lightweight vacuum cleaner',
                supplierName: 'Mobility Hire Co',
            },
        ],
        senderEmail: 'Example Therapy Sourcing <example.sourcing@mail.example.com>',
        replyToEmail: 'Kate <kate@example.com>',
    })
})

test('escapes the reply preview in the html body', () => {
    const alert = buildEquipmentQuoteReplyAlert({
        domain: 'example-domain',
        matches: [{
            name: 'Shower stool',
            patientId: 41,
            supplierName: 'Bathroom <Aids>',
            response: { id: 903, fromEmail: 'sales@supplier.example', preview: 'We supply "premium" <stools>' },
        }],
    })

    assert.match(alert.html, /Bathroom &lt;Aids&gt;/)
    assert.match(alert.html, /We supply &quot;premium&quot; &lt;stools&gt;/)
})

test('summarises the extra items when one email answers several', () => {
    const alert = buildEquipmentQuoteReplyAlert({
        domain: 'example-domain',
        matches: SOURCING_ITEMS.filter((item) => item.response),
    })

    assert.equal(alert.summary, 'Lightweight vacuum cleaner · Avery Sample and 1 more')
})

test('builds no alert without a matched item', () => {
    assert.equal(buildEquipmentQuoteReplyAlert({ domain: 'example-domain', matches: [] }), null)
})

test('describes a payload that carries no items', () => {
    assert.deepEqual(describeEquipmentQuoteReplyAlert(null), { title: 'Quote reply from a supplier', summary: '' })
    assert.deepEqual(describeEquipmentQuoteReplyAlert({ supplierEmail: 'sales@supplier.example' }), {
        title: 'Quote reply from sales@supplier.example',
        summary: '',
    })
})
