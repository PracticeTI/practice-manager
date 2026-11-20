import test from 'node:test'
import assert from 'node:assert/strict'

import {
    buildAnalysisSourceFingerprint,
    describeAnalysisStaleness,
    isFcaAnalystEnabled,
    resolveAnalystCapturedDocumentIds,
    suppressAnalystScopedAttachments,
} from '../src/jobs/fcaAnalysisScope.js'
import { buildFcaEvidenceMap, collectAnalystEvidenceText } from '../src/jobs/fcaReportGeneration.js'

const CURRENT = {
    notesLength: 13513,
    transcriptCount: 3,
    transcriptSummaryCount: 3,
    documentIds: [43],
}

test('an analysis built from this record is fresh', () => {
    const staleness = describeAnalysisStaleness({
        analysis: { sourceStats: { notesLength: 13513, transcriptCount: 3, transcriptSummaryCount: 3, documentIds: [43] } },
        current: CURRENT,
    })

    assert.equal(staleness.stale, false)
    assert.deepEqual(staleness.reasons, [])
})

test('a patient with no analysis at all is stale, not fresh', () => {
    assert.deepEqual(describeAnalysisStaleness({ analysis: null, current: CURRENT }), {
        stale: true,
        reasons: ['no analysis has been run for this patient'],
    })
})

test('every changed input is reported, not just the first', () => {
    const staleness = describeAnalysisStaleness({
        analysis: { sourceStats: { notesLength: 12000, transcriptCount: 3, transcriptSummaryCount: 3, documentIds: [43] } },
        current: { ...CURRENT, notesLength: 13513, documentIds: [43, 44] },
    })

    assert.equal(staleness.stale, true)
    assert.equal(staleness.reasons.length, 2)
    assert.match(staleness.reasons[0], /the notes changed \(12000 -> 13513 characters\)/)
    assert.match(staleness.reasons[1], /documents in evidence scope changed \(\[43\] -> \[43, 44\]\)/)
})

test('documents compare as a set, so upload order does not look like a change', () => {
    const staleness = describeAnalysisStaleness({
        analysis: { sourceStats: { ...CURRENT, documentIds: [44, 43] } },
        current: { ...CURRENT, documentIds: [43, 44] },
    })

    assert.equal(staleness.stale, false)
})

test('the fingerprint ignores junk and sorts ids', () => {
    assert.deepEqual(buildAnalysisSourceFingerprint({ notesLength: '42', documentIds: ['7', 7, null, 'x'] }), {
        notesLength: 42,
        transcriptCount: 0,
        transcriptSummaryCount: 0,
        documentIds: [7],
    })
})

test('reads the analyst switch from either metadata shape', () => {
    assert.equal(isFcaAnalystEnabled({ patientAgents: { analyst: true } }), true)
    assert.equal(isFcaAnalystEnabled({ patientAgents: { analysis: true } }), true)
    assert.equal(isFcaAnalystEnabled({ agents: { analyst: true } }), true)
    assert.equal(isFcaAnalystEnabled({ patientAgents: { analyst: false } }), false)
    // The modern container wins even when it is present but off.
    assert.equal(isFcaAnalystEnabled({ patientAgents: {}, agents: { analyst: true } }), false)
    assert.equal(isFcaAnalystEnabled(null), false)
    assert.equal(isFcaAnalystEnabled('true'), false)
})

test('only a document whose recorded specifics were captured is dropped from the corpus', () => {
    const sourceStats = { documentIds: [43, 99], documentNames: ['Letter of Support.docx', 'Discharge Summary.pdf'] }

    // Cited, but the finding carries no recorded detail: keeping the document text is the safe choice.
    assert.deepEqual(
        resolveAnalystCapturedDocumentIds({
            structuredEvidenceFacts: [
                { domain: 'current-functioning', source: 'document', sourceName: 'Letter of Support.docx' },
            ],
            sourceStats,
        }),
        []
    )

    // Cited with the measures the document records, so the finding stands in for the text.
    assert.deepEqual(
        resolveAnalystCapturedDocumentIds({
            structuredEvidenceFacts: [
                {
                    domain: 'standardised-assessment-summary',
                    source: 'document',
                    sourceName: 'Letter of Support.docx',
                    evidenceDetail: 'FIM 50/126. WHODAS 2.0 112/144.',
                },
            ],
            sourceStats,
        }),
        [43]
    )

    assert.deepEqual(resolveAnalystCapturedDocumentIds({}), [])
})

test('suppressing a cited document keeps the preamble and the other documents', () => {
    const context = [
        'Focus this report on the funding request.',
        '',
        '=== Attached file: Letter of Support.docx | application/vnd.openxmlformats-officedocument.wordprocessingml.document | file:43 ===',
        'MOBILITY AND TRANSFER DETAIL FROM THE LETTER.',
        '',
        '=== Attached file: Discharge Summary.pdf | application/pdf | file:99 ===',
        'MOBILITY AND TRANSFER DETAIL FROM THE SUMMARY.',
    ].join('\n')

    const result = suppressAnalystScopedAttachments(context, [43])

    assert.ok(!result.text.includes('FROM THE LETTER'))
    assert.ok(result.text.includes('MOBILITY AND TRANSFER DETAIL FROM THE SUMMARY.'))
    assert.ok(result.text.includes('Focus this report on the funding request.'))
    assert.equal(result.suppressed.length, 1)
    assert.match(result.suppressed[0], /Letter of Support\.docx/)

    // Nothing in scope, or nothing to suppress, leaves the context untouched.
    assert.equal(suppressAnalystScopedAttachments(context, []).text, context)
    assert.equal(suppressAnalystScopedAttachments('', [43]).text, '')
})

test('a labelled finding reaches its own section even with no keyword overlap', () => {
    // Regression: selection was purely keyword-scored, so a finding for `referral-purpose`
    // ("requested after a rapid functional decline") matched none of that section's keywords and was
    // dropped from the very section it was extracted for.
    const factLine = '[Evidence source: structured analysis findings] [referral-purpose] The assessment was requested after a rapid functional decline.'

    const evidenceMap = buildFcaEvidenceMap({
        notes: 'Unrelated note text.',
        transcripts: [],
        additionalContext: '',
        builderFormData: {},
        analysisEvidence: {
            structuredEvidenceFacts: [
                { domain: 'referral-purpose', observedIssue: 'The assessment was requested after a rapid functional decline.' },
            ],
        },
    })

    assert.equal((evidenceMap.bySection['referral-purpose'] || [])[0], factLine)

    // Placement by label does not spray it everywhere: it still has to be labelled for a section or
    // keyword-match it. ('assessment' is why the overview sections also see it; nothing unrelated
    // does.)
    assert.ok(!(evidenceMap.bySection['adl-personal-care'] || []).includes(factLine))
})

test('the evidence budget scales with the report style, and the analyst never takes all of it', () => {
    // Measured on a real record the candidate pool is 13-98 sentences a section, so Extended can be
    // given more source material instead of stretching the same nine lines over 2.2x the prose. The
    // analyst anchors the section but is capped at a share of it, so the record - including the
    // clinician's own support lists - always keeps some of the budget.
    const facts = Array.from({ length: 20 }, (_, index) => ({
        domain: 'current-functioning',
        observedIssue: `Mobility and transfer finding number ${index + 1}.`,
    }))
    const notes = 'Mobility is reduced and transfers need supervision at home.'

    const linesFor = (style) => (buildFcaEvidenceMap({
        notes,
        transcripts: [],
        additionalContext: '',
        builderFormData: {},
        analysisEvidence: { structuredEvidenceFacts: facts },
        style,
    }).bySection['current-functioning'] || [])

    const standard = linesFor('standard')
    const extended = linesFor('extended')

    assert.equal(standard.filter((line) => line.includes('[current-functioning]')).length, 7)
    assert.equal(extended.filter((line) => line.includes('[current-functioning]')).length, 12)
    assert.ok(standard.length <= 9 && extended.length <= 15, 'neither style exceeds its budget')
    assert.ok(extended.some((line) => !line.includes('[current-functioning]')), 'the record keeps a share of the section')
    assert.ok(standard.some((line) => !line.includes('[current-functioning]')), 'the record keeps a share of the section')

    // An absent style is Standard.
    assert.deepEqual(linesFor(undefined), standard)
})

test('recorded specifics travel with their finding', () => {
    const evidenceMap = buildFcaEvidenceMap({
        notes: '',
        transcripts: [],
        additionalContext: '',
        builderFormData: {},
        analysisEvidence: {
            structuredEvidenceFacts: [
                {
                    domain: 'standardised-assessment-summary',
                    observedIssue: 'Requires total assistance for bowel management.',
                    evidenceDetail: 'FIM total 50 of 126; WHODAS 2.0 112 of 144.',
                },
            ],
        },
    })

    const lines = evidenceMap.bySection['standardised-assessment-summary'] || []
    assert.equal(lines.length, 1)
    assert.match(lines[0], /Requires total assistance for bowel management\./)
    assert.match(lines[0], /FIM total 50 of 126; WHODAS 2\.0 112 of 144\./)
})

test('the analyst findings lead the corpus and reach their own section', () => {
    const evidenceMap = buildFcaEvidenceMap({
        notes: 'Mobility is reduced and the participant uses a frame indoors.',
        transcripts: [],
        additionalContext: '',
        builderFormData: {},
        analysisEvidence: {
            structuredEvidenceFacts: [
                {
                    domain: 'current-functioning',
                    observedIssue: 'Reports reduced mobility and needs supervision to transfer safely.',
                    functionalImpact: 'Cannot stand from a chair without assistance.',
                    supportImplication: 'Requires supervision during all transfers.',
                },
            ],
        },
    })

    const lines = evidenceMap.bySection['current-functioning'] || []
    assert.ok(
        lines.some((line) => line.includes('needs supervision to transfer safely')),
        'the analyst finding is offered to the section it is labelled with'
    )
})

test('a cited document is replaced by its finding instead of being counted twice', () => {
    const additionalContext = [
        '=== Attached file: Letter of Support.docx | application/vnd.openxmlformats-officedocument.wordprocessingml.document | file:43 ===',
        'MOBILITY AND TRANSFER LETTER SENTENCE THAT MUST NOT APPEAR TWICE.',
        '',
        '=== Attached file: Discharge Summary.pdf | application/pdf | file:99 ===',
        'Requires transport and community access support, and a wheelchair trial.',
    ].join('\n')

    const analysisEvidence = {
        structuredEvidenceFacts: [
            {
                domain: 'current-functioning',
                source: 'document',
                sourceName: 'Letter of Support.docx',
                observedIssue: 'Reports reduced mobility and needs supervision to transfer safely.',
                evidenceDetail: 'FIM total 50 of 126.',
            },
        ],
        sourceStats: { documentIds: [43, 99], documentNames: ['Letter of Support.docx', 'Discharge Summary.pdf'] },
    }

    const evidenceMap = buildFcaEvidenceMap({
        notes: '',
        transcripts: [],
        additionalContext,
        builderFormData: {},
        analysisEvidence,
        analystCapturedDocumentIds: resolveAnalystCapturedDocumentIds(analysisEvidence),
    })

    const collected = Object.values(evidenceMap.bySection).flat().join('\n')

    assert.ok(!collected.includes('MUST NOT APPEAR TWICE'), 'the cited document is represented by its finding')
    assert.ok(collected.includes('wheelchair trial'), 'a document the analyst did not cite is still evidence')
})

test('the analyst support decisions reach the funding section', () => {
    // Regression: the analyst's `recommendedInterventions`/`addressedInterventions` were read by the
    // builder's Step 5 prefill and by nothing else, so the report's largest section was written
    // without the recommendations the analyst had just made.
    const evidenceMap = buildFcaEvidenceMap({
        notes: '',
        transcripts: [],
        additionalContext: '',
        builderFormData: {},
        analysisEvidence: {
            structuredEvidenceFacts: [],
            recommendedInterventions: [
                { intervention: 'Occupational therapy', justification: 'Falls during transfers prevent safe showering.' },
            ],
            addressedInterventions: [
                { intervention: 'Home modifications', justification: 'A ramp is already in place.' },
            ],
        },
    })

    const lines = evidenceMap.bySection['recommendations-funding'] || []
    assert.equal(lines[0], '[Evidence source: structured analysis findings] [recommendations-funding] Support recommended: Occupational therapy. Falls during transfers prevent safe showering.')
    assert.ok(lines.some((line) => line === '[Evidence source: structured analysis findings] [recommendations-funding] Support already in place: Home modifications. A ramp is already in place.'))
})

test('support lines are labelled, ordered and skip empty entries', () => {
    const text = collectAnalystEvidenceText({
        recommendedInterventions: [
            { intervention: 'Occupational therapy', justification: 'Falls.' },
            { intervention: '   ', justification: '' },
            null,
        ],
        addressedInterventions: [{ intervention: 'Home modifications', justification: 'Ramp in place.' }],
    })

    // What is being asked for leads what is already funded.
    assert.deepEqual(text.split('\n'), [
        '[recommendations-funding] Support recommended: Occupational therapy. Falls.',
        '[recommendations-funding] Support already in place: Home modifications. Ramp in place.',
    ])
})

test('a support line says which sources state it', () => {
    const text = collectAnalystEvidenceText({
        recommendedInterventions: [
            { intervention: 'Occupational therapy', justification: 'Falls.', sources: ['notes', 'document'] },
            { intervention: 'Personal care support', justification: 'Showering.', sources: ['transcript'] },
            { intervention: 'Mobility equipment', justification: 'Frame.' },
        ],
        addressedInterventions: [
            {
                intervention: 'Home modifications',
                justification: 'Ramp in place.',
                sources: ['document'],
                sourceNames: ['NDIS Letter of Support Justin McAdam.docx'],
            },
        ],
    })

    const lines = text.split('\n')
    assert.equal(lines[0], '[recommendations-funding] Support recommended: Occupational therapy. Falls. (stated in the notes and an in-scope document)')
    assert.ok(lines.some((line) => line.endsWith('Showering. (stated in the consultation transcript)')))
    // No provenance is invented for an item the model left unlabelled.
    assert.ok(lines.some((line) => line === '[recommendations-funding] Support recommended: Mobility equipment. Frame.'))
    // Document file names never reach the corpus: they carry the participant's name, and a corpus
    // line is something the model can echo into report prose. Only reports from sourceStats show them.
    assert.ok(!text.includes('.docx'))
})

test('analyst findings become [domain] sentences', () => {
    const text = collectAnalystEvidenceText({
        structuredEvidenceFacts: [
            { domain: 'risk-safeguarding', observedIssue: 'Falls when unsupervised.', functionalImpact: 'Cannot be left alone.', supportImplication: 'Needs supervision.' },
            { domain: 'medical-background', observedIssue: 'Progressive myotonic dystrophy.', evidenceDetail: 'Weight fell from 74kg to 51.9kg.' },
            { domain: '', observedIssue: 'No domain supplied.' },
            { observedIssue: '   ' },
            null,
        ],
    })

    const lines = text.split('\n')
    assert.equal(lines.length, 3)
    assert.match(lines[0], /^\[risk-safeguarding\] Falls when unsupervised\./)
    assert.match(lines[1], /^\[medical-background\] Progressive myotonic dystrophy\. Weight fell from 74kg to 51\.9kg\.$/)
    assert.match(lines[2], /^\[general\] No domain supplied\.$/)
})
