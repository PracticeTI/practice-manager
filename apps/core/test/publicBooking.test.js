import assert from 'node:assert/strict'
import test from 'node:test'

import {
    buildBookingConfirmationEmail,
    buildBookingReference,
    defaultBookingSettingsForDomain,
    formatBookingWindow,
    mergeBookingSettings,
    normalizeBookingDomain,
    normalizeBookingSettings,
    selectAgentSlots,
    validateBookingRequest,
} from '../src/lib/publicBooking.js'

test('booking settings clamp unsafe values back into range', () => {
    const settings = normalizeBookingSettings({
        enabled: 'yes',
        minNoticeMinutes: 999999,
        maxAdvanceDays: 0,
        slotIntervalMinutes: 3,
    })

    assert.equal(settings.enabled, false)
    assert.equal(settings.minNoticeMinutes, 10080)
    assert.equal(settings.maxAdvanceDays, 1)
    assert.equal(settings.slotIntervalMinutes, 5)
    assert.equal(settings.requireConsent, true)
})

test('mergeBookingSettings keeps untouched values', () => {
    const merged = mergeBookingSettings(
        { enabled: true, minNoticeMinutes: 60, introText: 'Hello' },
        { minNoticeMinutes: 240 }
    )

    assert.equal(merged.enabled, true)
    assert.equal(merged.minNoticeMinutes, 240)
    assert.equal(merged.introText, 'Hello')
})

test('normalizeBookingDomain rejects anything that is not a tenant key', () => {
    assert.equal(normalizeBookingDomain(' Domain-A '), 'domain-a')
    assert.equal(normalizeBookingDomain('../../etc/passwd'), '')
    assert.equal(normalizeBookingDomain(''), '')
})

test('booking references are readable and stable', () => {
    assert.equal(buildBookingReference(42), 'BK-0042')
    assert.equal(buildBookingReference('17'), 'BK-0017')
    assert.equal(buildBookingReference(null), '')
})

test('validateBookingRequest requires a name, a time and one contact method', () => {
    const { errors } = validateBookingRequest({ patient_name: 'A' })
    assert.ok(errors.includes('Please enter your full name'))
    assert.ok(errors.includes('Enter an email address or mobile number so we can confirm'))
    assert.ok(errors.includes('Choose an appointment type'))
    assert.ok(errors.includes('Choose an appointment time'))
})

test('validateBookingRequest normalises contact details', () => {
    const { values, errors } = validateBookingRequest({
        patient_name: 'Jane Citizen',
        email: 'Jane@Example.com ',
        phone: '0450 150 301',
        service_id: '3',
        starts_at: '2026-11-02T01:00:00.000Z',
        consent: true,
    })

    assert.deepEqual(errors, [])
    assert.equal(values.email, 'jane@example.com')
    assert.equal(values.phone, '+61450150301')
    assert.equal(values.serviceId, 3)
    assert.equal(values.startsAt, '2026-11-02T01:00:00.000Z')
    assert.equal(values.consent, true)
})

test('validateBookingRequest rejects a filled honeypot as spam', () => {
    const result = validateBookingRequest({ patient_name: 'Bot', company_website: 'http://spam.example' })
    assert.deepEqual(result.errors, ['spam'])
    assert.equal(result.values, null)
})

test('formatBookingWindow renders in the practice timezone', () => {
    const label = formatBookingWindow({
        startsAt: '2026-10-20T00:00:00.000Z',
        endsAt: '2026-10-20T01:00:00.000Z',
        timezone: 'Australia/Melbourne',
    })

    assert.match(label, /Tuesday 20 October 2026/)
    assert.match(label, /11:00 am/)
    assert.match(label, /12:00 pm/)
})

test('selectAgentSlots honours the part of day and spreads across dates', () => {
    const slots = [
        { starts_at: '2026-10-20T09:00:00.000Z' },
        { starts_at: '2026-10-20T09:30:00.000Z' },
        { starts_at: '2026-10-20T10:00:00.000Z' },
        { starts_at: '2026-10-21T13:00:00.000Z' },
        { starts_at: '2026-10-21T13:30:00.000Z' },
        { starts_at: '2026-10-21T14:00:00.000Z' },
    ]

    const morning = selectAgentSlots(slots, { timeOfDay: 'morning', timezone: 'UTC', limit: 6 })
    assert.deepEqual(morning.map((slot) => slot.starts_at), [
        '2026-10-20T09:00:00.000Z',
        '2026-10-20T09:30:00.000Z',
    ])

    const afternoon = selectAgentSlots(slots, { timeOfDay: 'afternoon', timezone: 'UTC', limit: 6 })
    assert.deepEqual(afternoon.map((slot) => slot.starts_at), [
        '2026-10-21T13:00:00.000Z',
        '2026-10-21T13:30:00.000Z',
    ])

    const any = selectAgentSlots(slots, { timeOfDay: 'any', timezone: 'UTC', limit: 6 })
    assert.equal(any.length, 4)
    assert.equal(any[0].starts_at, '2026-10-20T09:00:00.000Z')
    assert.equal(any[3].starts_at, '2026-10-21T13:30:00.000Z')
})

test('booking is off unless a domain descriptor opts in', () => {
    assert.equal(defaultBookingSettingsForDomain('example-domain').enabled, false)
    assert.equal(defaultBookingSettingsForDomain('default').enabled, false)
    assert.equal(defaultBookingSettingsForDomain('').enabled, false)
})

test('the default booking policy is preserved', () => {
    const settings = defaultBookingSettingsForDomain('default')
    assert.equal(settings.minNoticeMinutes, 120)
    assert.equal(settings.maxAdvanceDays, 60)
    assert.equal(settings.slotIntervalMinutes, 30)
    assert.equal(settings.requireConsent, true)
})

test('notificationEmail is normalised and drops invalid addresses', () => {
    assert.equal(normalizeBookingSettings({ notificationEmail: ' Reception@Practice.com.au ' }).notificationEmail, 'reception@practice.com.au')
    assert.equal(normalizeBookingSettings({ notificationEmail: 'not-an-email' }).notificationEmail, '')
    assert.equal(normalizeBookingSettings({}).notificationEmail, '')
})

test('confirmation email carries the reference and self-service links', () => {
    const message = buildBookingConfirmationEmail({
        practiceName: 'Acme OT',
        booking: {
            reference: 'BK-0042',
            timeLabel: 'Tuesday 20 October 2026, 9:00 am – 10:00 am',
            serviceName: 'Assessment consultation',
            practitionerName: 'Kate O’Callaghan',
            manageUrl: 'https://example.test/api/scheduling/confirm?action=reschedule',
            cancelUrl: 'https://example.test/api/scheduling/confirm?action=decline',
        },
    })

    assert.equal(message.subject, 'Appointment confirmed — BK-0042')
    assert.match(message.text, /BK-0042/)
    assert.match(message.text, /Need a different time\?/)
    assert.match(message.text, /Cancel this appointment:/)
    assert.match(message.html, /action=reschedule&amp;|action=reschedule/)
})

test('confirmation email falls back to a plain instruction without links', () => {
    const message = buildBookingConfirmationEmail({
        practiceName: 'Acme OT',
        booking: { reference: 'BK-0001', serviceName: 'Assessment', timeLabel: 'Monday' },
    })

    assert.match(message.text, /reply to this email or call the practice/)
    assert.doesNotMatch(message.text, /Cancel this appointment/)
})
