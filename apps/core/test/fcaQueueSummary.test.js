import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFcaQueueSummary } from '../src/admin-ui/components/fcaQueueSummary.js'

test('builds a queue summary with recipient, purpose, inclusions, and page estimate', () => {
    const summary = buildFcaQueueSummary({
        patientName: 'Alex Example',
        formData: {
            additionalNotes: 'Follow-up note',
        },
        sectionPlan: [
            { id: 'one', minWords: 300 },
            { id: 'two', minWords: 200 },
        ],
    })

    assert.equal(summary.recipient, 'Alex Example')
    assert.equal(summary.purpose.includes('NDIS Functional Capacity Assessment'), true)
    assert.equal(summary.inclusions.includes('Participant details and demographics'), true)
    // 500 words of section targets is one A4 page at the shared page metrics; the old floor of 15
    // was standing in for a page size the estimate did not have.
    assert.equal(summary.estimatedPagesLabel, '2 A4 pages')
    assert.match(summary.queueNote, /Alex Example/)
})

test('reports the executive summary and the selected report style', () => {
    const summary = buildFcaQueueSummary({
        patientName: 'Alex Example',
        formData: {
            reportStyle: 'extended',
            additionalNotes: 'New funding is available - emphasise assistive technology.',
        },
        sectionPlan: [
            { id: 'executive-summary', minWords: 650 },
            { id: 'referral-purpose', minWords: 730 },
        ],
    })

    assert.equal(summary.inclusions[0], 'Executive summary for the NDIA planner')
    assert.equal(summary.inclusions.includes('Additional notes and suggestions'), false)
    assert.equal(summary.styleLabel, 'Extended')
    assert.equal(summary.steeringApplied, true)
    assert.equal(summary.estimatedWords, 1380)
    assert.match(summary.queueNote, /Extended length/)
})

test('defaults to the standard style when none is chosen', () => {
    const summary = buildFcaQueueSummary({
        patientName: 'Alex Example',
        formData: {},
        sectionPlan: [],
    })

    assert.equal(summary.styleLabel, 'Standard')
    assert.equal(summary.steeringApplied, false)
})
