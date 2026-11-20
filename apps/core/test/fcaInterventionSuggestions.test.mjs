import test from 'node:test'
import assert from 'node:assert/strict'
import { extractInterventionSuggestionsFromAnalysisPayload, mergeInterventionSuggestions } from '../src/admin-ui/components/fcaInterventionSuggestions.js'

test('extracts intervention suggestions from analysis support groups', () => {
    const analysisPayload = {
        suggestions: [
            {
                key: 'supports',
                label: 'Support and recommendation signals',
                evidence: [
                    'Occupational therapy and assistive technology may improve daily task participation.',
                    'Home modifications and personal care support should be reviewed.',
                ],
            },
            {
                key: 'goals',
                label: 'Goal and outcome signals',
                evidence: ['Improve independence with morning routine.'],
            },
        ],
    }

    assert.deepEqual(
        extractInterventionSuggestionsFromAnalysisPayload(analysisPayload),
        ['Occupational therapy', 'Assistive technology', 'Home modifications', 'Personal care support']
    )
})

test('merges note-based and analysis-based intervention suggestions without duplicates', () => {
    // Analysis suggestions lead; note-derived ones follow as coverage.
    assert.deepEqual(
        mergeInterventionSuggestions(['Occupational therapy', 'Physiotherapy'], ['Assistive technology', 'Occupational therapy']),
        ['Assistive technology', 'Occupational therapy', 'Physiotherapy']
    )
})
