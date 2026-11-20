import assert from 'node:assert/strict'
import test from 'node:test'

import {
    buildAgentSystemPrompt,
    normalizeAgentIntent,
    parseAgentJson,
    parseAgentMessageFallback,
    sanitizeAgentHistory,
} from '../src/lib/publicBooking.js'

const services = [
    { id: 1, name: 'Assessment consultation' },
    { id: 2, name: 'OT therapy session' },
]
const practitioners = [
    { id: 10, display_name: 'Kate O’Callaghan' },
    { id: 11, display_name: 'Sam Lee' },
]
const context = {
    services,
    practitioners,
    today: '2026-10-19',
    maxAdvanceDays: 60,
}

test('parseAgentJson reads fenced and prose-wrapped JSON', () => {
    assert.deepEqual(parseAgentJson('```json\n{"service_id":1}\n```'), { service_id: 1 })
    assert.deepEqual(parseAgentJson('Sure! {"service_id":2,"reply":"ok"} hope that helps'), {
        service_id: 2,
        reply: 'ok',
    })
    assert.equal(parseAgentJson('no json here'), null)
    assert.equal(parseAgentJson(''), null)
})

test('normalizeAgentIntent resolves a service and practitioner by name', () => {
    const { intent, warnings } = normalizeAgentIntent({
        service_name: 'assessment',
        practitioner_name: 'kate',
        from_date: '2026-10-20',
        to_date: '2026-10-27',
        time_of_day: 'Morning',
    }, context)

    assert.deepEqual(warnings, [])
    assert.equal(intent.serviceId, 1)
    assert.equal(intent.serviceName, 'Assessment consultation')
    assert.equal(intent.practitionerId, 10)
    assert.equal(intent.practitionerName, 'Kate O’Callaghan')
    assert.equal(intent.fromDate, '2026-10-20')
    assert.equal(intent.toDate, '2026-10-27')
    assert.equal(intent.timeOfDay, 'morning')
})

test('normalizeAgentIntent clamps dates to today and the booking horizon', () => {
    const { intent } = normalizeAgentIntent({
        service_id: 2,
        from_date: '2020-01-01',
        to_date: '2030-01-01',
    }, context)

    assert.equal(intent.fromDate, '2026-10-19')
    assert.equal(intent.toDate, '2026-12-18')
    assert.equal(intent.timeOfDay, 'any')
})

test('normalizeAgentIntent defaults to a two week window', () => {
    const { intent } = normalizeAgentIntent({ service_id: 1 }, context)
    assert.equal(intent.fromDate, '2026-10-19')
    assert.equal(intent.toDate, '2026-11-01')
})

test('normalizeAgentIntent drops unknown ids with a warning', () => {
    const { intent, warnings } = normalizeAgentIntent(
        { service_id: 999, practitioner_id: 404 },
        context
    )

    assert.equal(intent.serviceId, null)
    assert.equal(intent.practitionerId, null)
    assert.deepEqual(warnings.sort(), ['practitioner_not_found', 'service_not_found'])
})

test('parseAgentMessageFallback narrows by service, practitioner and part of day', () => {
    const raw = parseAgentMessageFallback(
        'Can I see Kate for an OT therapy session next week in the morning?',
        context
    )

    assert.equal(raw.service_name, 'ot therapy session')
    assert.equal(raw.practitioner_name, 'kate o’callaghan')
    assert.equal(raw.time_of_day, 'morning')
    assert.equal(raw.from_date, '2026-10-26')
    assert.equal(raw.to_date, '2026-11-01')
})

test('parseAgentMessageFallback understands tomorrow', () => {
    const raw = parseAgentMessageFallback('anything tomorrow please', context)
    assert.equal(raw.from_date, '2026-10-20')
    assert.equal(raw.to_date, '2026-10-20')
})

test('sanitizeAgentHistory keeps the last six valid turns', () => {
    const history = Array.from({ length: 9 }, (_, index) => ({
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `turn ${index}`,
    }))
    history.push({ role: 'system', content: 'ignore me' })

    const sanitized = sanitizeAgentHistory(history)
    assert.equal(sanitized.length, 6)
    assert.equal(sanitized[0].content, 'turn 3')
    assert.ok(sanitized.every((turn) => turn.role !== 'system'))
})

test('buildAgentSystemPrompt names the catalogue and horizon', () => {
    const prompt = buildAgentSystemPrompt({
        practiceName: 'Acme OT',
        services,
        practitioners,
        today: '2026-10-19',
        maxAdvanceDays: 60,
    })

    assert.match(prompt, /Acme OT/)
    assert.match(prompt, /Assessment consultation \(id 1\)/)
    assert.match(prompt, /Kate O’Callaghan \(id 10\)/)
    assert.match(prompt, /2026-10-19/)
    assert.match(prompt, /60 days/)
})
