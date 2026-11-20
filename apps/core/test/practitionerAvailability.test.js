import test from 'node:test'
import assert from 'node:assert/strict'
import {
    buildBusyIntervals,
    enumerateDateStrings,
    generateAvailability,
    getZonedParts,
    parseAvailabilityRangeBound,
    zonedDateTimeToUtc,
} from '../src/lib/practitionerAvailability.js'

const SYDNEY = 'Australia/Sydney'

function iso(epochMs) {
    return new Date(epochMs).toISOString()
}

test('zoned wall-clock times convert across Sydney daylight-saving boundaries', () => {
    // DST starts 2026-10-04 at 02:00 (AEST +10 -> AEDT +11).
    assert.equal(iso(zonedDateTimeToUtc('2026-10-04', '09:00', SYDNEY)), '2026-10-03T22:00:00.000Z')
    // DST ends 2026-04-05 at 03:00 (AEDT +11 -> AEST +10).
    assert.equal(iso(zonedDateTimeToUtc('2026-04-05', '09:00', SYDNEY)), '2026-04-04T23:00:00.000Z')
    // Standard time.
    assert.equal(iso(zonedDateTimeToUtc('2026-06-01', '09:00', SYDNEY)), '2026-05-31T23:00:00.000Z')
})

test('zoned parts round-trip a converted instant', () => {
    const instant = zonedDateTimeToUtc('2026-10-04', '09:00', SYDNEY)
    const parts = getZonedParts(new Date(instant), SYDNEY)
    assert.deepEqual(parts, {
        year: 2026,
        month: 10,
        day: 4,
        hour: 9,
        minute: 0,
        date: '2026-10-04',
    })
})

test('date enumeration crosses a DST boundary without skipping a day', () => {
    const { dates, truncated } = enumerateDateStrings('2026-10-03', '2026-10-06')
    assert.deepEqual(dates, ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06'])
    assert.equal(truncated, false)

    const capped = enumerateDateStrings('2026-01-01', '2026-12-31', 3)
    assert.equal(capped.dates.length, 3)
    assert.equal(capped.truncated, true)
})

function mondayRule(overrides = {}) {
    return {
        practitioner_id: 1,
        weekday: 1,
        start_time: '09:00:00',
        end_time: '12:00:00',
        valid_from: null,
        valid_to: null,
        location_id: null,
        service_id: null,
        active: true,
        ...overrides,
    }
}

function baseOptions(overrides = {}) {
    return {
        practitionerId: 1,
        service: { id: 7, duration_minutes: 60, buffer_before_minutes: 0, buffer_after_minutes: 0 },
        rules: [mondayRule()],
        exceptions: [],
        appointments: [],
        servicesById: { 7: { id: 7, buffer_before_minutes: 0, buffer_after_minutes: 0 } },
        timezone: SYDNEY,
        from: '2026-06-01',
        to: '2026-06-01',
        intervalMinutes: 60,
        minNoticeMinutes: 0,
        now: new Date('2026-05-01T00:00:00Z'),
        ...overrides,
    }
}

test('generates slots from a weekly rule at the requested interval', () => {
    const result = generateAvailability(baseOptions())
    assert.deepEqual(result.slots.map((slot) => slot.start), [
        '2026-05-31T23:00:00.000Z',
        '2026-06-01T00:00:00.000Z',
        '2026-06-01T01:00:00.000Z',
    ])
    assert.deepEqual(result.slots.map((slot) => slot.end), [
        '2026-06-01T00:00:00.000Z',
        '2026-06-01T01:00:00.000Z',
        '2026-06-01T02:00:00.000Z',
    ])
    assert.equal(result.timezone, SYDNEY)
    assert.equal(result.truncated, false)
})

test('leave exceptions subtract time and extra exceptions add it', () => {
    const leave = generateAvailability(baseOptions({
        exceptions: [{
            exception_type: 'leave',
            starts_at: '2026-06-01T00:00:00Z',
            ends_at: '2026-06-01T01:00:00Z',
        }],
    }))
    assert.deepEqual(leave.slots.map((slot) => slot.start), [
        '2026-05-31T23:00:00.000Z',
        '2026-06-01T01:00:00.000Z',
    ])

    const extra = generateAvailability(baseOptions({
        rules: [],
        exceptions: [{
            exception_type: 'extra',
            starts_at: '2026-06-01T03:00:00Z',
            ends_at: '2026-06-01T04:00:00Z',
        }],
    }))
    assert.deepEqual(extra.slots.map((slot) => slot.start), ['2026-06-01T03:00:00.000Z'])
})

test('existing appointments block overlapping slots', () => {
    const result = generateAvailability(baseOptions({
        appointments: [{
            appointment_status: 'confirmed',
            starts_at: '2026-05-31T23:30:00Z',
            ends_at: '2026-06-01T00:30:00Z',
            service_id: 7,
        }],
    }))
    assert.deepEqual(result.slots.map((slot) => slot.start), ['2026-06-01T01:00:00.000Z'])
})

test('cancelled and no-show appointments do not block, completed ones do', () => {
    const baseAppointment = {
        starts_at: '2026-05-31T23:30:00Z',
        ends_at: '2026-06-01T00:30:00Z',
        service_id: 7,
    }

    const cancelled = generateAvailability(baseOptions({
        appointments: [{ ...baseAppointment, appointment_status: 'cancelled' }],
    }))
    assert.equal(cancelled.slots.length, 3)

    const noShow = generateAvailability(baseOptions({
        appointments: [{ ...baseAppointment, appointment_status: 'no_show' }],
    }))
    assert.equal(noShow.slots.length, 3)

    const completed = generateAvailability(baseOptions({
        appointments: [{ ...baseAppointment, appointment_status: 'completed' }],
    }))
    assert.deepEqual(completed.slots.map((slot) => slot.start), ['2026-06-01T01:00:00.000Z'])
})

test('service buffers pad busy intervals around the appointment', () => {
    const appointments = [{
        appointment_status: 'confirmed',
        starts_at: '2026-05-31T23:30:00Z',
        ends_at: '2026-06-01T00:30:00Z',
        service_id: 7,
    }]
    const result = generateAvailability(baseOptions({
        appointments,
        servicesById: { 7: { id: 7, buffer_before_minutes: 0, buffer_after_minutes: 30 } },
        service: { id: 7, duration_minutes: 60, buffer_before_minutes: 15, buffer_after_minutes: 0 },
    }))
    // The previous appointment now blocks until 01:00Z, and the candidate's
    // 15-minute travel buffer would start at 00:45Z.
    assert.deepEqual(result.slots, [])
})

test('minimum notice skips slots that are too close to now', () => {
    const result = generateAvailability(baseOptions({
        now: new Date('2026-06-01T00:30:00Z'),
        minNoticeMinutes: 0,
    }))
    assert.deepEqual(result.slots.map((slot) => slot.start), ['2026-06-01T01:00:00.000Z'])
})

test('date-only range bounds cover the whole local day', () => {
    assert.equal(
        iso(parseAvailabilityRangeBound('2026-06-01', SYDNEY, { endOfDay: false })),
        '2026-05-31T14:00:00.000Z'
    )
    assert.equal(
        iso(parseAvailabilityRangeBound('2026-06-01', SYDNEY, { endOfDay: true })),
        '2026-06-01T13:59:59.999Z'
    )
})

test('limit and truncated flag cap large result sets', () => {
    const result = generateAvailability(baseOptions({ limit: 1 }))
    assert.equal(result.slots.length, 1)
    assert.equal(result.truncated, true)
})

test('rules can be scoped to a location and service', () => {
    const scoped = baseOptions({
        rules: [mondayRule({ location_id: 10, service_id: 7 })],
    })

    assert.equal(generateAvailability({ ...scoped, locationId: null }).slots.length, 3)
    assert.equal(generateAvailability({ ...scoped, locationId: 10 }).slots.length, 3)
    assert.equal(generateAvailability({ ...scoped, locationId: 11 }).slots.length, 0)
    assert.equal(generateAvailability({ ...scoped, service: { id: 8, duration_minutes: 60 } }).slots.length, 0)
})

test('busy intervals include unavailable blocks and skip archived rows', () => {
    const intervals = buildBusyIntervals([
        {
            appointment_status: 'confirmed',
            starts_at: '2026-06-01T00:00:00Z',
            ends_at: '2026-06-01T01:00:00Z',
            service_id: 7,
        },
        {
            appointment_status: 'cancelled',
            starts_at: '2026-06-02T00:00:00Z',
            ends_at: '2026-06-02T01:00:00Z',
            service_id: 7,
        },
        {
            unavailable_block: true,
            starts_at: '2026-06-03T00:00:00Z',
            ends_at: '2026-06-03T01:00:00Z',
        },
        {
            appointment_status: 'confirmed',
            archived: true,
            starts_at: '2026-06-04T00:00:00Z',
            ends_at: '2026-06-04T01:00:00Z',
            service_id: 7,
        },
    ], { 7: { id: 7, buffer_before_minutes: 0, buffer_after_minutes: 0 } })

    assert.equal(intervals.length, 2)
    assert.equal(iso(intervals[0].start), '2026-06-01T00:00:00.000Z')
    assert.equal(iso(intervals[1].start), '2026-06-03T00:00:00.000Z')
})
