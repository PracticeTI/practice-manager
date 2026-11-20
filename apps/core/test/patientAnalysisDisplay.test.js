import test from 'node:test'
import assert from 'node:assert/strict'

import { summarizeAnalysisDocuments } from '../src/lib/patientAnalysisDisplay.js'

// The real stored analysis for patient 21 (domain-a), which had one DOCX in scope and 9 of its
// 22 findings attributed to it. Keep the fixture faithful: this panel exists to answer exactly the
// question the operator could not answer - "was that document used?"
const PATIENT_21_SOURCE_STATS = {
    notesLength: 13513,
    transcriptCount: 3,
    transcriptSummaryCount: 3,
    transcriptEvidenceLength: 30260,
    documentIds: [43],
    documentNames: ['NDIS Letter of Support Justin McAdam- FINAL.docx'],
    documentLength: 21204,
    sourceSentenceCount: 608,
    sourceWordCount: 9458,
}

function documentFact(domain) {
    return {
        domain,
        source: 'document',
        sourceName: 'NDIS Letter of Support [participant redacted]- FINAL.docx',
        observedIssue: 'Requires supervision.',
    }
}

test('reports the documents an analysis read and how many findings came from them', () => {
    const summary = summarizeAnalysisDocuments({
        sourceStats: PATIENT_21_SOURCE_STATS,
        facts: [
            documentFact('medical-background'),
            documentFact('current-functioning'),
            documentFact('current-functioning'),
            { domain: 'notes-only', source: 'notes', observedIssue: 'Falls at the front steps.' },
        ],
    })

    assert.equal(summary.recorded, true)
    assert.equal(summary.count, 1)
    assert.equal(summary.factCount, 3)
    assert.equal(summary.tone, 'used')
    assert.match(summary.summaryLabel, /^1 reference document\(s\)/)
    assert.match(summary.summaryLabel, /3 finding\(s\) from them/)
    // The tooltip names the file the operator flagged and where its facts landed.
    assert.match(summary.title, /NDIS Letter of Support Justin McAdam- FINAL\.docx/)
    assert.match(summary.title, /21,204 characters/)
    assert.match(summary.title, /medical-background, current-functioning/)
})

test('says so when a document was in scope and contributed nothing', () => {
    const summary = summarizeAnalysisDocuments({
        sourceStats: PATIENT_21_SOURCE_STATS,
        facts: [{ domain: 'current-functioning', source: 'notes', observedIssue: 'Falls.' }],
    })

    assert.equal(summary.count, 1)
    assert.equal(summary.factCount, 0)
    assert.equal(summary.tone, 'unused')
    assert.match(summary.summaryLabel, /no findings from them/)
    assert.match(summary.title, /No finding is attributed to a document/)
})

test('distinguishes "no documents in scope" from "documents not recorded"', () => {
    const none = summarizeAnalysisDocuments({
        sourceStats: { ...PATIENT_21_SOURCE_STATS, documentIds: [], documentNames: [], documentLength: 0 },
        facts: [],
    })
    assert.equal(none.recorded, true)
    assert.equal(none.tone, 'none')
    assert.equal(none.summaryLabel, 'no reference documents')
    assert.match(none.title, /no reference documents in scope/)

    // A pre-document analysis has no `documentIds` key at all. Render nothing rather than claim the
    // analyst ran without documents it may never have been offered.
    const legacy = summarizeAnalysisDocuments({
        sourceStats: { notesLength: 13513, transcriptCount: 3, sourceSentenceCount: 608 },
        facts: [documentFact('current-functioning')],
    })
    assert.equal(legacy.recorded, false)
    assert.equal(legacy.summaryLabel, '')
    assert.equal(legacy.title, '')
})

test('handles a missing payload and a document list without names', () => {
    assert.deepEqual(summarizeAnalysisDocuments(), {
        recorded: false,
        count: 0,
        names: [],
        totalChars: 0,
        factCount: 0,
        factDomains: [],
        tone: 'none',
        summaryLabel: '',
        title: '',
    })

    const unnamed = summarizeAnalysisDocuments({
        sourceStats: { documentIds: [43, 44], documentNames: [], documentLength: 0 },
        facts: [documentFact('participant-context')],
    })
    assert.equal(unnamed.count, 2)
    assert.match(unnamed.title, /2 document\(s\)/)
    assert.doesNotMatch(unnamed.title, /characters/)
})
