import test from 'node:test'
import assert from 'node:assert/strict'
import {
    buildAppointmentActionToken,
    buildReminderMessage,
    buildReminderSchedule,
    buildWaitlistActionToken,
    normalizePhone,
    phoneMatchKey,
    rankWaitlistEntries,
    resolvePatientContact,
    verifyAppointmentActionToken,
    verifyWaitlistActionToken,
} from '../src/lib/appointmentMessaging.js'
import { decryptSecret, encryptSecret } from '../src/lib/secretBox.js'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

const SECRET = 'test-secret'

test('secret box round-trips and rejects tampering', () => {
    const encrypted = encryptSecret('refresh-token-value')
    assert.match(encrypted, /^v1\./)
    assert.equal(decryptSecret(encrypted), 'refresh-token-value')

    const parts = encrypted.split('.')
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]}.${Buffer.from('bad').toString('base64url')}`
    assert.equal(decryptSecret(tampered), null)
    assert.equal(decryptSecret('not-a-token'), null)
})

test('phone numbers normalise to E.164 and match on the last nine digits', () => {
    assert.equal(normalizePhone('0421 330 983'), '+61421330983')
    assert.equal(normalizePhone('+61 0421 330 983'), '+61421330983')
    assert.equal(normalizePhone('61421330983'), '+61421330983')
    assert.equal(normalizePhone(''), null)
    assert.equal(phoneMatchKey('+61 0421 330 983'), '421330983')
})

test('patient contact extraction ignores plan-manager addresses', () => {
    const contact = resolvePatientContact({
        splosePatient: { email: 'patient@example.com', mobile_phone: '+61 0421 330 983' },
        sploseAnswers: {
            plan_manager_email: 'manager@example.com',
            client_phone: '0421330983',
        },
    })
    assert.equal(contact.email, 'patient@example.com')
    assert.equal(contact.phone, '+61421330983')

    const managerOnly = resolvePatientContact({
        sploseAnswers: { plan_manager_email: 'manager@example.com' },
    })
    assert.equal(managerOnly.email, null)

    const labelled = resolvePatientContact({
        sploseLabelledAnswers: {
            'Email Address': 'labelled@example.com',
            'Phone Number': '0421 330 983',
        },
    })
    assert.equal(labelled.email, 'labelled@example.com')
    assert.equal(labelled.phone, '+61421330983')
})

test('reminder schedules skip past offsets and promote the next one to confirmation', () => {
    const now = new Date('2026-06-01T00:00:00Z')

    const tenDays = buildReminderSchedule({
        startsAt: '2026-06-11T00:00:00Z',
        now,
    })
    assert.deepEqual(tenDays.map((item) => item.offsetHours), [168, 72, 24, 2])
    assert.equal(tenDays[0].kind, 'confirmation')
    assert.equal(tenDays[1].kind, 'reminder')

    const twoDays = buildReminderSchedule({
        startsAt: '2026-06-03T00:00:00Z',
        now,
    })
    assert.deepEqual(twoDays.map((item) => item.offsetHours), [24, 2])
    assert.equal(twoDays[0].kind, 'confirmation')

    const confirmed = buildReminderSchedule({
        startsAt: '2026-06-11T00:00:00Z',
        now,
        confirmationStatus: 'confirmed',
    })
    assert.ok(confirmed.every((item) => item.kind === 'reminder'))

    const declined = buildReminderSchedule({
        startsAt: '2026-06-11T00:00:00Z',
        now,
        confirmationStatus: 'declined',
    })
    assert.deepEqual(declined, [])
})

test('overdue reminders are caught up inside the grace window', () => {
    // The 7-day reminder fired 2 hours ago; a runner restart should still send
    // it, but a 7-day-old overdue reminder should not be resurrected.
    const now = new Date('2026-06-05T02:00:00Z')
    const recent = buildReminderSchedule({
        startsAt: '2026-06-12T00:00:00Z',
        now,
        includePast: true,
        graceMinutes: 24 * 60,
    })
    assert.deepEqual(recent.map((item) => item.offsetHours), [168, 72, 24, 2])

    const old = buildReminderSchedule({
        startsAt: '2026-06-10T00:00:00Z',
        now,
        includePast: true,
        graceMinutes: 24 * 60,
    })
    assert.ok(!old.some((item) => item.offsetHours === 168))
})

test('appointment action tokens are bound to the action and expire', () => {
    const expiresAt = '2026-06-10T00:00:00Z'
    const token = buildAppointmentActionToken({
        domain: 'domain-a',
        appointmentId: 42,
        action: 'confirm',
        expiresAt,
        secret: SECRET,
    })

    assert.equal(verifyAppointmentActionToken({
        token,
        domain: 'domain-a',
        appointmentId: 42,
        action: 'confirm',
        secret: SECRET,
        now: new Date('2026-06-01T00:00:00Z'),
    }), true)
    assert.equal(verifyAppointmentActionToken({
        token,
        domain: 'domain-a',
        appointmentId: 42,
        action: 'decline',
        secret: SECRET,
        now: new Date('2026-06-01T00:00:00Z'),
    }), false)
    assert.equal(verifyAppointmentActionToken({
        token,
        domain: 'domain-a',
        appointmentId: 43,
        action: 'confirm',
        secret: SECRET,
        now: new Date('2026-06-01T00:00:00Z'),
    }), false)
    assert.equal(verifyAppointmentActionToken({
        token,
        domain: 'domain-a',
        appointmentId: 42,
        action: 'confirm',
        secret: SECRET,
        now: new Date('2026-06-11T00:00:00Z'),
    }), false)

    const waitlistToken = buildWaitlistActionToken({
        domain: 'domain-a',
        offerId: 7,
        action: 'accept',
        expiresAt,
        secret: SECRET,
    })
    assert.equal(verifyWaitlistActionToken({
        token: waitlistToken,
        domain: 'domain-a',
        offerId: 7,
        action: 'accept',
        secret: SECRET,
        now: new Date('2026-06-01T00:00:00Z'),
    }), true)
})

test('reminder message contains the local time and signed links', () => {
    const message = buildReminderMessage({
        appointment: {
            starts_at: '2026-05-31T23:00:00Z',
            timezone: 'Australia/Sydney',
            service: 'OT assessment',
            practitioner: 'Kate O’Callaghan',
            location: 'Acme OT',
        },
        patientName: 'Tuyen Vo Tran',
        practiceName: 'Acme OT',
        kind: 'confirmation',
        confirmationStatus: 'pending',
        urls: {
            confirm: 'https://example.com/confirm',
            decline: 'https://example.com/decline',
            reschedule: 'https://example.com/reschedule',
        },
    })

    assert.match(message.subject, /Please confirm your appointment/)
    assert.match(message.text, /Monday,? 1 June 2026 at 09:00/)
    assert.match(message.text, /https:\/\/example.com\/confirm/)
    assert.match(message.text, /https:\/\/example.com\/decline/)
    assert.match(message.text, /https:\/\/example.com\/reschedule/)
    assert.match(message.html, /Confirm appointment/)
})

test('waitlist ranking prefers service, practitioner and location matches', () => {
    const slot = {
        service_id: 1,
        practitioner_id: 10,
        location_id: 100,
        starts_at: '2026-06-01T00:00:00Z',
    }
    const ranked = rankWaitlistEntries([
        { id: 1, status: 'waiting', service_id: 1, practitioner_id: 10, location_id: 100, priority: 5 },
        { id: 2, status: 'waiting', service_id: 1, practitioner_id: 10, location_id: 100, priority: 0 },
        { id: 3, status: 'waiting', service_id: null, practitioner_id: null, location_id: null },
        { id: 4, status: 'booked', service_id: 1, practitioner_id: 10, location_id: 100, priority: 99 },
        { id: 5, status: 'waiting', service_id: 1, practitioner_id: 10, location_id: 100, earliest_date: '2026-07-01' },
        { id: 6, status: 'waiting', service_id: 2, practitioner_id: 10, location_id: 100 },
    ], slot)

    assert.deepEqual(ranked.map((item) => item.entry.id), [1, 2, 3])
    assert.ok(ranked[0].score > ranked[1].score)
})
