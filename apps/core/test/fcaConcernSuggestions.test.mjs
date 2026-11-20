import test from 'node:test'
import assert from 'node:assert/strict'
import {
    buildConcernPrefill,
    extractConcernLabels,
    extractConcernsFromAnalysisPayload,
    mergeConcernSuggestions,
} from '../src/admin-ui/components/fcaConcernSuggestions.js'

test('maps concern keywords to catalog labels in catalog order', () => {
    assert.deepEqual(
        extractConcernLabels('Reports fatigue after 10 minutes and needs help with dressing.'),
        ['Fatigue/energy limitations', 'Self-care support needed']
    )
})

test('handles empty input without throwing', () => {
    assert.deepEqual(extractConcernLabels(''), [])
    assert.deepEqual(extractConcernLabels(undefined), [])
    assert.deepEqual(extractConcernsFromAnalysisPayload(null), [])
})

test('derives concerns from analyst evidence and justifications', () => {
    const analysisPayload = {
        recommendedInterventions: [
            {
                intervention: 'Occupational therapy',
                justification: 'Recommended because the available evidence indicates difficulty with showering and dressing.',
                evidence: ['Needs prompting for meal preparation due to fatigue after 10 minutes.'],
            },
        ],
        addressedInterventions: [
            {
                intervention: 'Home modifications',
                justification: 'Already addressed: the available evidence indicates a ramp is in place but stairs remain a barrier.',
            },
        ],
    }

    assert.deepEqual(
        extractConcernsFromAnalysisPayload(analysisPayload),
        ['Fatigue/energy limitations', 'Self-care support needed', 'Home access barriers']
    )
})

test('reads evidence from the legacy grouped suggestions shape, ignoring non-functional groups', () => {
    const analysisPayload = {
        suggestions: [
            {
                key: 'supports',
                evidence: ['Uses a wheelchair for community participation and reports pain most days.'],
            },
            {
                key: 'goals',
                evidence: ['Improve walking endurance.'],
            },
        ],
    }

    assert.deepEqual(
        extractConcernsFromAnalysisPayload(analysisPayload),
        ['Pain management', 'Community participation limitations']
    )
})

test('merges analyst and note concerns with the analyst first and no duplicates', () => {
    assert.deepEqual(
        mergeConcernSuggestions(
            ['Mobility limitations', 'Cognitive impairment'],
            ['Pain management', 'Mobility limitations', null, '  ']
        ),
        ['Pain management', 'Mobility limitations', 'Cognitive impairment']
    )
})

test('prefills every merged concern instead of only the first three', () => {
    // Regression: patient 21's five merged concerns were pre-filled into three fixed slots, so
    // "Home access barriers" and "Community participation limitations" never reached the report.
    const merged = [
        'Fatigue/energy limitations',
        'Mobility limitations',
        'Cognitive impairment',
        'Home access barriers',
        'Community participation limitations',
    ]

    assert.deepEqual(buildConcernPrefill(['', '', ''], merged), merged)
    assert.deepEqual(buildConcernPrefill(undefined, merged), merged)
})

test('adds only the concerns a saved draft is missing, keeping what was listed', () => {
    // The analyst's third concern used to overwrite the slot a clinician had already been given,
    // so a re-run of the analysis silently changed the selected set.
    assert.deepEqual(
        buildConcernPrefill(
            ['Fatigue/energy limitations', 'Mobility limitations', 'Home access barriers'],
            ['Fatigue/energy limitations', 'Mobility limitations', 'Cognitive impairment']
        ),
        ['Fatigue/energy limitations', 'Mobility limitations', 'Home access barriers', 'Cognitive impairment']
    )

    // A clinician's own wording survives, and suggestions already present in any case are not doubled.
    assert.deepEqual(
        buildConcernPrefill([], ['Pain management', 'pain management']),
        ['Pain management']
    )
    assert.deepEqual(
        buildConcernPrefill(['Reduced hand function'], []),
        ['Reduced hand function']
    )
    // With nothing to add the existing shape is returned unchanged (whitespace-only trimmed).
    assert.deepEqual(buildConcernPrefill(['', '  '], []), ['', ''])
})
