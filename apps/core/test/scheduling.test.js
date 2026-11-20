import test from 'node:test'
import assert from 'node:assert/strict'
import {
    APPOINTMENT_STATUSES,
    availabilityRulesOverlap,
    buildEntityDedupeKey,
    deriveAppointmentStatus,
    mostCommonDurationMinutes,
    normalizeAppointmentStatus,
    normalizeAvailabilityExceptionFields,
    normalizeAvailabilityRuleFields,
    normalizeEntityName,
    normalizeLocationFields,
    normalizePractitionerFields,
    normalizePractitionerServiceFields,
    normalizeServiceFields,
} from '../src/lib/scheduling.js'

test('appointment status aliases map onto the native lifecycle', () => {
    assert.equal(normalizeAppointmentStatus('No status'), null)
    assert.equal(normalizeAppointmentStatus('Booked'), 'confirmed')
    assert.equal(normalizeAppointmentStatus('No Show'), 'no_show')
    assert.equal(normalizeAppointmentStatus('no_show'), 'no_show')
    assert.equal(normalizeAppointmentStatus('DNA'), 'no_show')
    assert.equal(normalizeAppointmentStatus('Did not attend'), 'no_show')
    assert.equal(normalizeAppointmentStatus('Checked in'), 'arrived')
    assert.equal(normalizeAppointmentStatus('Completed'), 'completed')
    assert.equal(normalizeAppointmentStatus('Cancelled'), 'cancelled')
    assert.equal(normalizeAppointmentStatus('waitlisted'), 'tentative')
    assert.equal(normalizeAppointmentStatus('something else'), null)
})

test('deriveAppointmentStatus defaults to confirmed and prefers an explicit status', () => {
    assert.equal(deriveAppointmentStatus({}), 'confirmed')
    assert.equal(deriveAppointmentStatus({ patientStatus: 'No status' }), 'confirmed')
    assert.equal(deriveAppointmentStatus({ patientStatus: 'Cancelled' }), 'cancelled')
    assert.equal(
        deriveAppointmentStatus({ patientStatus: 'Cancelled', appointmentStatus: 'completed' }),
        'completed'
    )
    assert.equal(
        deriveAppointmentStatus({ patientStatus: 'Cancelled', appointmentStatus: 'No Show' }),
        'no_show'
    )
    assert.ok(APPOINTMENT_STATUSES.includes(deriveAppointmentStatus({})))
})

test('practitioner fields are trimmed, validated and default to the practice timezone', () => {
    const created = normalizePractitionerFields({
        display_name: '  Kate O’Callaghan  ',
        email: 'kate@example.com',
        timezone: '',
        active: 'true',
    })
    assert.deepEqual(created.errors, [])
    assert.equal(created.fields.display_name, 'Kate O’Callaghan')
    assert.equal(created.fields.timezone, 'Australia/Sydney')
    assert.equal(created.fields.active, true)

    const missing = normalizePractitionerFields({})
    assert.equal(missing.errors[0], 'display_name is required')

    const invalidEmail = normalizePractitionerFields({
        display_name: 'Kate',
        email: 'not-an-email',
    })
    assert.match(invalidEmail.errors[0], /valid email/)

    const invalidTimezone = normalizePractitionerFields({
        display_name: 'Kate',
        timezone: 'Mars/Olympus',
    })
    assert.match(invalidTimezone.errors[0], /IANA timezone/)

    const partial = normalizePractitionerFields({ discipline: 'OT' }, { requireName: false })
    assert.deepEqual(partial.errors, [])
    assert.deepEqual(partial.fields, { discipline: 'OT' })
})

test('practice location fields validate coordinates and location type', () => {
    const valid = normalizeLocationFields({
        name: '  Acme OT  ',
        location_type: 'mobile',
        latitude: '-37.8136',
        longitude: '144.9631',
    })
    assert.deepEqual(valid.errors, [])
    assert.equal(valid.fields.name, 'Acme OT')
    assert.equal(valid.fields.latitude, -37.8136)
    assert.equal(valid.fields.longitude, 144.9631)

    const invalidType = normalizeLocationFields({ name: 'Clinic', location_type: 'warehouse' })
    assert.match(invalidType.errors[0], /must be one of/)

    const invalidLatitude = normalizeLocationFields({ name: 'Clinic', latitude: 120 })
    assert.match(invalidLatitude.errors[0], /between -90 and 90/)
})

test('service fields validate duration, price and funding types', () => {
    const valid = normalizeServiceFields({
        name: 'OT assessment',
        duration_minutes: '45',
        buffer_after_minutes: '15',
        price: '193.99',
        funding_types: ['NDIS', 'ndis', 'Private'],
    })
    assert.deepEqual(valid.errors, [])
    assert.equal(valid.fields.duration_minutes, 45)
    assert.equal(valid.fields.buffer_after_minutes, 15)
    assert.equal(valid.fields.price, 193.99)
    assert.deepEqual(valid.fields.funding_types, ['ndis', 'private'])

    const tooShort = normalizeServiceFields({ name: 'Bad', duration_minutes: 2 })
    assert.match(tooShort.errors[0], /between 5 and 1440/)

    const tooLongBuffer = normalizeServiceFields({ name: 'Bad', buffer_before_minutes: 500 })
    assert.match(tooLongBuffer.errors[0], /between 0 and 240/)
})

test('availability rules normalise times and reject inverted ranges', () => {
    const valid = normalizeAvailabilityRuleFields({
        practitioner_id: 4,
        weekday: 1,
        start_time: '09:00',
        end_time: '17:00',
        valid_from: '2026-01-05',
        valid_to: '2026-12-31',
    })
    assert.deepEqual(valid.errors, [])
    assert.equal(valid.fields.start_time, '09:00:00')
    assert.equal(valid.fields.end_time, '17:00:00')
    assert.equal(valid.fields.weekday, 1)

    const inverted = normalizeAvailabilityRuleFields({
        practitioner_id: 4,
        weekday: 1,
        start_time: '17:00',
        end_time: '09:00',
    })
    assert.ok(inverted.errors.includes('end_time must be after start_time'))

    const invalidWeekday = normalizeAvailabilityRuleFields({
        practitioner_id: 4,
        weekday: 7,
        start_time: '09:00',
        end_time: '17:00',
    })
    assert.match(invalidWeekday.errors[0], /between 0 and 6/)

    const invalidDateRange = normalizeAvailabilityRuleFields({
        practitioner_id: 4,
        weekday: 1,
        start_time: '09:00',
        end_time: '17:00',
        valid_from: '2026-12-31',
        valid_to: '2026-01-01',
    })
    assert.ok(invalidDateRange.errors.includes('valid_to must be on or after valid_from'))

    const partial = normalizeAvailabilityRuleFields(
        { end_time: '18:00' },
        { requireCore: false }
    )
    assert.deepEqual(partial.errors, [])
    assert.deepEqual(partial.fields, { end_time: '18:00:00' })
})

test('availability exceptions validate the time window', () => {
    const valid = normalizeAvailabilityExceptionFields({
        practitioner_id: 2,
        exception_type: 'leave',
        starts_at: '2026-04-01T00:00:00Z',
        ends_at: '2026-04-05T00:00:00Z',
    })
    assert.deepEqual(valid.errors, [])
    assert.equal(valid.fields.starts_at, '2026-04-01T00:00:00.000Z')

    const inverted = normalizeAvailabilityExceptionFields({
        practitioner_id: 2,
        starts_at: '2026-04-05T00:00:00Z',
        ends_at: '2026-04-01T00:00:00Z',
    })
    assert.ok(inverted.errors.includes('ends_at must be after starts_at'))

    const partial = normalizeAvailabilityExceptionFields(
        { note: 'Training day' },
        { requireCore: false }
    )
    assert.deepEqual(partial.errors, [])
    assert.deepEqual(partial.fields, { note: 'Training day' })
})

test('practitioner service assignments require both ids', () => {
    const valid = normalizePractitionerServiceFields({ practitioner_id: 3, service_id: 7 })
    assert.deepEqual(valid.errors, [])
    assert.deepEqual(valid.fields, { practitioner_id: 3, service_id: 7 })

    const missing = normalizePractitionerServiceFields({ practitioner_id: 3 })
    assert.equal(missing.errors[0], 'service_id is required')

    const invalid = normalizePractitionerServiceFields({ practitioner_id: 0, service_id: 7 })
    assert.match(invalid.errors[0], /between 1/)

    const partial = normalizePractitionerServiceFields({ service_id: 9 }, { requireCore: false })
    assert.deepEqual(partial.errors, [])
    assert.deepEqual(partial.fields, { service_id: 9 })
})

test('availability overlap ignores separate locations and inactive rules', () => {
    const base = {
        practitioner_id: 1,
        weekday: 1,
        start_time: '09:00:00',
        end_time: '12:00:00',
        valid_from: null,
        valid_to: null,
        active: true,
        location_id: null,
    }

    assert.equal(availabilityRulesOverlap(base, { ...base, start_time: '11:00:00', end_time: '13:00:00' }), true)
    assert.equal(availabilityRulesOverlap(base, { ...base, start_time: '12:00:00', end_time: '14:00:00' }), false)
    assert.equal(availabilityRulesOverlap(base, { ...base, weekday: 2 }), false)
    assert.equal(availabilityRulesOverlap(base, { ...base, location_id: 10 }), true)
    assert.equal(
        availabilityRulesOverlap({ ...base, location_id: 10 }, { ...base, location_id: 11 }),
        false
    )
    assert.equal(availabilityRulesOverlap(base, { ...base, active: false }), false)
    assert.equal(
        availabilityRulesOverlap(
            { ...base, valid_to: '2026-06-30' },
            { ...base, valid_from: '2026-07-01' }
        ),
        false
    )
})

test('migration helpers normalise names and prefer external ids', () => {
    assert.equal(normalizeEntityName('  Kate   O’Callaghan '), 'Kate O’Callaghan')
    assert.equal(
        buildEntityDedupeKey({ domain: 'domain-a', externalId: '30119', name: 'Kate' }),
        'domain-a::external::30119'
    )
    assert.equal(
        buildEntityDedupeKey({ domain: 'Domain-A', externalId: '', name: '  Kate   O’Callaghan ' }),
        'domain-a::name::kate o’callaghan'
    )
    assert.equal(buildEntityDedupeKey({ domain: 'domain-a', name: '   ' }), null)
})

test('mostCommonDurationMinutes picks the mode and falls back safely', () => {
    assert.equal(mostCommonDurationMinutes([45, 45, 60]), 45)
    assert.equal(mostCommonDurationMinutes([60, 45]), 45)
    assert.equal(mostCommonDurationMinutes([], 60), 60)
    assert.equal(mostCommonDurationMinutes([0, -10, 'nope'], 60), 60)
})
