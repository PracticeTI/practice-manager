import test from 'node:test'
import assert from 'node:assert/strict'
import {
    buildCalendarFeedToken,
    buildCalendarFeedUrl,
    clampFeedRange,
    escapeIcsText,
    foldIcsLine,
    patientInitials,
    serializeCalendarFeed,
    verifyCalendarFeedToken,
} from '../src/lib/calendarFeed.js'

test('patient initials never expose the full name', () => {
    assert.equal(patientInitials('Tuyen Vo Tran'), 'T.T.')
    assert.equal(patientInitials('Madonna'), 'M.')
    assert.equal(patientInitials('  '), '')
})

test('ICS text escapes delimiters and newlines', () => {
    assert.equal(
        escapeIcsText('OT, assessment; follow-up\\review\nnext line'),
        'OT\\, assessment\\; follow-up\\\\review\\nnext line'
    )
})

test('ICS lines fold at 75 octets with a leading space on continuations', () => {
    const line = `SUMMARY:${'a'.repeat(120)}`
    const folded = foldIcsLine(line)
    const lines = folded.split('\r\n')

    assert.ok(lines.length > 1)
    lines.forEach((part) => {
        assert.ok(Buffer.byteLength(part) <= 75, `line is ${Buffer.byteLength(part)} bytes`)
    })
    lines.slice(1).forEach((part) => assert.ok(part.startsWith(' ')))

    // Multi-byte characters must not be split across lines.
    const unicode = `SUMMARY:${'é'.repeat(100)}`
    foldIcsLine(unicode).split('\r\n').forEach((part) => {
        assert.ok(Buffer.byteLength(part) <= 75)
    })
})

test('feed tokens are scoped to the domain and practitioner', () => {
    const secret = 'test-secret'
    const token = buildCalendarFeedToken({ domain: 'domain-a', practitionerId: 1, secret })

    assert.equal(verifyCalendarFeedToken({
        domain: 'domain-a',
        practitionerId: 1,
        token,
        secret,
    }), true)
    assert.equal(verifyCalendarFeedToken({
        domain: 'domain-b',
        practitionerId: 1,
        token,
        secret,
    }), false)
    assert.equal(verifyCalendarFeedToken({
        domain: 'domain-a',
        practitionerId: 2,
        token,
        secret,
    }), false)
    assert.equal(verifyCalendarFeedToken({
        domain: 'domain-a',
        practitionerId: 1,
        token: `${token}x`,
        secret,
    }), false)

    const allPractitioners = buildCalendarFeedToken({ domain: 'domain-a', secret })
    assert.equal(verifyCalendarFeedToken({
        domain: 'domain-a',
        practitionerId: 1,
        token: allPractitioners,
        secret,
    }), false)
})

test('feed URL carries the signed token', () => {
    const url = new URL(buildCalendarFeedUrl({
        origin: 'https://example.com',
        domain: 'domain-a',
        practitionerId: 4,
        secret: 'test-secret',
    }))

    assert.equal(url.pathname, '/api/calendar/feed')
    assert.equal(url.searchParams.get('domain'), 'domain-a')
    assert.equal(url.searchParams.get('practitioner_id'), '4')
    assert.ok(url.searchParams.get('token'))
})

test('serialized feed uses initials, UTC timestamps and cancellation status', () => {
    const calendar = serializeCalendarFeed({
        domain: 'domain-a',
        timezone: 'Australia/Sydney',
        now: new Date('2026-06-01T00:00:00Z'),
        appointments: [
            {
                id: 62,
                starts_at: '2026-06-01T00:00:00Z',
                ends_at: '2026-06-01T01:00:00Z',
                service: 'OT assessment, initial',
                location: 'Acme OT',
                patient_name: 'Tuyen Vo Tran',
                appointment_status: 'cancelled',
            },
        ],
    })

    assert.match(calendar, /^BEGIN:VCALENDAR\r\n/)
    assert.match(calendar, /\r\nEND:VCALENDAR\r\n$/)
    assert.match(calendar, /UID:appointment-62@domain-a\.scheduling/)
    assert.match(calendar, /DTSTART:20260601T000000Z/)
    assert.match(calendar, /DTEND:20260601T010000Z/)
    assert.match(calendar, /STATUS:CANCELLED/)
    assert.match(calendar, /SUMMARY:OT assessment\\, initial — T\.T\./)
    assert.doesNotMatch(calendar, /Tuyen Vo Tran/)
})

test('feed ranges are capped and default to a six-month window', () => {
    const defaults = clampFeedRange({ now: new Date('2026-06-01T00:00:00Z') })
    assert.equal(defaults.from, '2026-05-02T00:00:00.000Z')
    assert.equal(defaults.to, '2026-11-28T00:00:00.000Z')

    const capped = clampFeedRange({
        from: '2026-01-01T00:00:00Z',
        to: '2028-01-01T00:00:00Z',
    })
    assert.equal(capped.to, '2027-01-02T00:00:00.000Z')
})
