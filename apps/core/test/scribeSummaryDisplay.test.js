import test from 'node:test'
import assert from 'node:assert/strict'
import {
    describeEvidenceDomain,
    groupEvidenceFactsByDomain,
    isStructuredSummaryStyle,
    normalizeStructuredEvidenceFacts,
    splitScribeSummaryText,
} from '../src/lib/scribeSummaryDisplay.js'

// Shapes copied from real rows in patient_transcript_summaries (domain-a, 2026-09-15).
const FCA_TEXT = [
    '- Personal Care and Activities of Daily Living',
    '  Evidence: The patient reports difficulty managing morning personal care routines.',
    '  Functional impact: This limits independence with showering.',
    '  Support implication: Ongoing funded carer support is required.',
    '- Follow-up: Occupational therapist to liaise with the equipment provider.',
].join('\n')

const OTF10_TEXT = [
    '- Area: mobility',
    '  Evidence: The patient has limited knee range of motion.',
    '  Functional impact: Walking endurance is reduced to about 10 minutes.',
    '  Support implication: Provision of a lightweight four-wheel walker.',
].join('\n')

const GENERIC_TEXT = [
    '- Reports sliding of kitchen chairs on tiled floor impeding safe transfers.',
    '- Evidence (upper-limb-function): The patient reports difficulty managing chairs.',
    '- Reviews pacing and recovery planning.',
].join('\n')

test('only the report-specific styles are structured', () => {
    assert.equal(isStructuredSummaryStyle('otf10-home-services'), true)
    assert.equal(isStructuredSummaryStyle('fca-functional-capacity'), true)
    assert.equal(isStructuredSummaryStyle('topic-bullets-third-person'), false)
    assert.equal(isStructuredSummaryStyle(''), false)
})

test('split separates topics, evidence blocks and follow-ups', () => {
    const generic = splitScribeSummaryText(GENERIC_TEXT)
    assert.deepEqual(generic.topicLines, [
        'Reports sliding of kitchen chairs on tiled floor impeding safe transfers.',
        'Reviews pacing and recovery planning.',
    ])
    assert.deepEqual(generic.evidenceLines, [
        'Evidence (upper-limb-function): The patient reports difficulty managing chairs.',
    ])
    assert.deepEqual(generic.followUpLines, [])

    const otf10 = splitScribeSummaryText(OTF10_TEXT)
    assert.equal(otf10.evidenceLines.length, 1)
    assert.match(otf10.evidenceLines[0], /^Area: mobility Evidence: The patient has limited/)
    assert.deepEqual(otf10.topicLines, [])

    const fca = splitScribeSummaryText(FCA_TEXT)
    assert.equal(fca.evidenceLines.length, 1)
    assert.equal(fca.followUpLines.length, 1)
    assert.deepEqual(fca.topicLines, [])
})

test('the FCA section-title shape counts as an evidence block', () => {
    // Real stored shape: the section title is the bullet body and the fields are continuation lines.
    const parts = splitScribeSummaryText([
        '- Personal Care and Activities of Daily Living',
        '  Evidence: The patient reports difficulty managing morning personal care routines.',
        '  Functional impact: This limits independence with showering.',
        '  Support implication: Ongoing funded carer support is required.',
    ].join('\n'))
    assert.deepEqual(parts.topicLines, [])
    assert.equal(parts.evidenceLines.length, 1)
    assert.match(parts.evidenceLines[0], /^Personal Care and Activities of Daily Living Evidence:/)
})

test('split keeps document order for the untouched styles', () => {
    assert.deepEqual(splitScribeSummaryText(GENERIC_TEXT).items.map((item) => item.text), [
        'Reports sliding of kitchen chairs on tiled floor impeding safe transfers.',
        'Evidence (upper-limb-function): The patient reports difficulty managing chairs.',
        'Reviews pacing and recovery planning.',
    ])
})

test('a topic bullet that merely starts with "Evidence" stays a topic', () => {
    const parts = splitScribeSummaryText('- Evidence suggests the patient avoids stairs.')
    assert.deepEqual(parts.topicLines, ['Evidence suggests the patient avoids stairs.'])
    assert.deepEqual(parts.evidenceLines, [])
})

test('split treats bullet glyphs and blank-line paragraphs as separate items', () => {
    const parts = splitScribeSummaryText('* First point.\n\n\u2022 Second point.')
    assert.deepEqual(parts.topicLines, ['First point.', 'Second point.'])
})

test('normalize reads facts from an object or a JSON string payload', () => {
    const facts = [{ domain: 'pain', observedIssue: 'Constant left knee pain.', functionalImpact: '', supportImplication: '   ' }]
    const fromObject = normalizeStructuredEvidenceFacts({ structuredEvidenceFacts: facts })
    assert.equal(fromObject.length, 1)
    assert.equal(fromObject[0].domain, 'pain')
    assert.equal(fromObject[0].label, 'Pain')
    assert.equal(fromObject[0].supportImplication, '')

    const fromString = normalizeStructuredEvidenceFacts(JSON.stringify({ structuredEvidenceFacts: JSON.stringify(facts) }))
    assert.deepEqual(fromString, fromObject)
})

test('normalize drops empty facts and exact repeats within a domain', () => {
    const facts = normalizeStructuredEvidenceFacts({
        structuredEvidenceFacts: [
            { domain: 'pain', observedIssue: '', functionalImpact: '', supportImplication: '' },
            { domain: 'mobility', observedIssue: 'Near miss on the front step.' },
            { domain: 'mobility', observedIssue: 'near miss on the front step.' },
            { domain: 'mobility', observedIssue: 'Uses a four-wheel walker outside.' },
        ],
    })
    assert.equal(facts.length, 2)
    assert.deepEqual(facts.map((fact) => fact.observedIssue), [
        'Near miss on the front step.',
        'Uses a four-wheel walker outside.',
    ])
})

test('facts group by domain in summariser order', () => {
    const groups = groupEvidenceFactsByDomain(normalizeStructuredEvidenceFacts({
        structuredEvidenceFacts: [
            { domain: 'adl-personal-care', observedIssue: 'Showering is harder standing.' },
            { domain: 'mobility', observedIssue: 'Two near misses on the front step.' },
            { domain: 'adl-personal-care', observedIssue: 'Dressing takes longer.' },
        ],
    }))
    assert.deepEqual(groups.map((group) => group.key), ['adl-personal-care', 'mobility'])
    assert.equal(groups[0].label, 'Personal Care and Activities of Daily Living')
    assert.equal(groups[0].items.length, 2)
    assert.equal(groups[1].label, 'Mobility and Falls Safety')
})

test('unknown domains fall back to a title-cased label', () => {
    assert.equal(describeEvidenceDomain('household-tasks'), 'Household Tasks')
    assert.equal(describeEvidenceDomain(''), 'General')
})
