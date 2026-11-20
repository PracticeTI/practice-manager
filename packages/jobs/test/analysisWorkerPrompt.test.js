import test from 'node:test'
import assert from 'node:assert/strict'

import {
    buildPatientAnalysis,
    buildPatientAnalysisFromEvidence,
    buildTranscriptEvidenceBlock,
    resolveAnalysisRecommendationBounds,
    resolveAnalysisWorkerPrompt,
} from '../src/jobs/analysisWorker.js'
import {
    FCA_ANALYSIS_DOCUMENT_CHARS,
    FCA_ANALYSIS_FALLBACK_MODEL,
    FCA_ANALYSIS_MAX_FACTS_PER_SECTION,
    buildAnalysisEvidenceUserPrompt,
    listAnalysisEvidenceDomains,
    normalizeAnalysisEvidencePayload,
    normalizeEvidenceDocuments,
    resolveAnalysisEvidenceModel,
} from '../src/jobs/fcaAnalysisEvidence.js'

test('reads an analyst worker prompt from patient metadata config', () => {
    const prompt = resolveAnalysisWorkerPrompt({
        metadata: {
            patientAgents: {
                analysisConfig: {
                    workerPrompt: 'Focus on recent risk indicators and functional goals.'
                }
            }
        }
    })

    assert.equal(prompt, 'Focus on recent risk indicators and functional goals.')
})

test('supports the legacy analystConfig shape', () => {
    const prompt = resolveAnalysisWorkerPrompt({
        metadata: {
            patientAgents: {
                analystConfig: {
                    workerPrompt: 'Prioritise support needs over general history.'
                }
            }
        }
    })

    assert.equal(prompt, 'Prioritise support needs over general history.')
})

test('falls back to the built-in analyst prompt when none is supplied', () => {
    const prompt = resolveAnalysisWorkerPrompt({ metadata: {} })

    assert.match(prompt, /FCA-relevant evidence/)
})

test('upgrades legacy default prompt text to the current default focus', () => {
    const prompt = resolveAnalysisWorkerPrompt({
        metadata: {
            patientAgents: {
                analysisConfig: {
                    workerPrompt: 'Review the patient notes and transcripts for FCA-relevant evidence. Focus on functional capacity, safety and risk, supports and recommendations, and goals and outcomes. Highlight evidence that would help build a strong, clinically grounded FCA report. When identifying supports or interventions, prefer specific, actionable suggestions such as occupational therapy, assistive technology, home modifications, personal care support, or community access supports, and note any important gaps or follow-up questions.'
                }
            }
        }
    })

    assert.match(prompt, /recommendedInterventions array/)
    assert.doesNotMatch(prompt, /important gaps or follow-up questions/)
})

test('resolves analyst recommendation bounds from config and clamps invalid values', () => {
    const bounds = resolveAnalysisRecommendationBounds({
        metadata: {
            patientAgents: {
                analysisConfig: {
                    minRecommendedInterventions: 70,
                    maxRecommendedInterventions: 2,
                }
            }
        }
    })

    assert.deepEqual(bounds, {
        minRecommendedInterventions: 50,
        maxRecommendedInterventions: 50,
    })
})

test('normalizes model evidence into section-labelled facts', () => {
    const evidence = normalizeAnalysisEvidencePayload({
        summaryText: 'The participant presents with reduced mobility and requires support with personal care.',
        facts: [
            { domain: 'mobility', observedIssue: 'Frequent falls during transfers.', functionalImpact: 'Cannot transfer unaided.', supportImplication: 'Requires supervision for transfers.' },
            { domain: 'adl-personal-care', observedIssue: 'Showering requires supervision.', functionalImpact: 'Reduced independence.', supportImplication: 'Personal care support.' },
            { domain: 'invented-section', observedIssue: 'Unplaced finding.', functionalImpact: '', supportImplication: '' },
            { domain: 'mobility', observedIssue: '   ' },
        ],
        recommendedInterventions: [{ intervention: 'Occupational therapy', justification: 'Falls during transfers.' }],
        addressedInterventions: [{ intervention: 'Support worker', justification: 'Currently attends.' }],
    })

    // `mobility` aliases onto the current-functioning section; an unknown label stays flat-only so
    // the finding is not lost, it is just not placed in a section.
    assert.deepEqual(Object.keys(evidence.sectionEvidence).sort(), ['adl-personal-care', 'current-functioning'])
    assert.equal(evidence.facts.length, 3)
    assert.equal(evidence.sectionEvidence['current-functioning'].length, 1)
    assert.deepEqual(evidence.sectionsCovered, ['adl-personal-care', 'current-functioning'])
    assert.equal(evidence.recommendedInterventions.length, 1)
    assert.equal(evidence.addressedInterventions.length, 1)
})

test('drops duplicate findings and blank observations', () => {
    const evidence = normalizeAnalysisEvidencePayload({
        facts: [
            { domain: 'current-functioning', observedIssue: 'Frequent falls during transfers.' },
            { domain: 'current-functioning', observedIssue: 'Frequent falls during transfers.', functionalImpact: 'x' },
            { domain: 'current-functioning', observedIssue: '' },
        ],
    })

    assert.equal(evidence.facts.length, 1)
})

test('caps how many findings a single section keeps', () => {
    const facts = Array.from({ length: FCA_ANALYSIS_MAX_FACTS_PER_SECTION + 5 }, (_, index) => ({
        domain: 'current-functioning',
        observedIssue: `Finding number ${index}.`,
    }))

    const evidence = normalizeAnalysisEvidencePayload({ facts })

    assert.equal(evidence.sectionEvidence['current-functioning'].length, FCA_ANALYSIS_MAX_FACTS_PER_SECTION)
    // The flat list keeps everything that fits the global cap.
    assert.equal(evidence.facts.length, FCA_ANALYSIS_MAX_FACTS_PER_SECTION + 5)
})

test('builds an evidence prompt naming every report section and carrying the sources', () => {
    const prompt = buildAnalysisEvidenceUserPrompt({
        notes: 'Participant reports reduced endurance and falls at the front steps.',
        transcriptEvidence: 'Transcript #7\nThe participant avoids showering alone.',
        recommendationBounds: { minRecommendedInterventions: 2, maxRecommendedInterventions: 6 },
        addressedBounds: { maxAddressedInterventions: 4 },
    })

    for (const section of listAnalysisEvidenceDomains()) {
        assert.ok(prompt.includes(section), `prompt should name ${section}`)
    }
    assert.match(prompt, /reduced endurance and falls/)
    assert.match(prompt, /avoids showering alone/)
    assert.match(prompt, /Return 2 to 6 items/)
    assert.match(prompt, /Return up to 4 items/)
})

test('assembles the analyst payload from model evidence', () => {
    const analysis = buildPatientAnalysisFromEvidence({
        patient: { id: 21, patient_name: 'Justin McAdam' },
        domain: 'example',
        job: { event_type: 'analyst_enabled', requested_action: 'prepare_fca_suggestions' },
        payload: { source: 'test' },
        model: 'gpt-5-mini',
        workerPrompt: 'Focus on recent risk indicators and functional goals.',
        recommendationBounds: { minRecommendedInterventions: 2, maxRecommendedInterventions: 6 },
        addressedBounds: { minAddressedInterventions: 0, maxAddressedInterventions: 4 },
        evidence: normalizeAnalysisEvidencePayload({
            summaryText: 'Clinical summary.',
            facts: [{ domain: 'current-functioning', observedIssue: 'Falls at the front steps.', functionalImpact: 'Cannot leave home unaided.', supportImplication: 'Requires attendant care.' }],
            recommendedInterventions: [{ intervention: 'Occupational therapy', justification: 'Falls at the front steps.' }],
        }),
        sourceStats: {
            notesLength: 13513,
            transcriptCount: 3,
            transcriptSummaryCount: 3,
            notesIncludedLength: 13513,
            transcriptEvidenceLength: 900,
            sourceSentenceCount: 120,
            sourceWordCount: 2400,
        },
    })

    assert.equal(analysis.generator, 'two-analysis-worker-v2')
    assert.equal(analysis.adapter, 'openai')
    assert.equal(analysis.model, 'gpt-5-mini')
    assert.equal(analysis.summaryText, 'Clinical summary.')
    assert.equal(analysis.sourceStats.notesLength, 13513)
    assert.equal(analysis.structuredEvidenceFacts.length, 1)
    assert.equal(analysis.sectionEvidence['current-functioning'].length, 1)
    assert.deepEqual(analysis.evidenceDomains, ['current-functioning'])
    assert.equal(analysis.recommendedInterventions.length, 1)
    // The Analysis tab's "View prompt" action reads workerPrompt; losing it silently blanked the modal.
    assert.equal(analysis.workerPrompt, 'Focus on recent risk indicators and functional goals.')
    assert.deepEqual(analysis.recommendationBounds, { minRecommendedInterventions: 2, maxRecommendedInterventions: 6 })
    assert.deepEqual(analysis.addressedBounds, { minAddressedInterventions: 0, maxAddressedInterventions: 4 })
    // The old keyword-catalog shape is gone.
    assert.ok(!('suggestions' in analysis))
    assert.ok(!('gaps' in analysis))
})

test('falls back to a status summary when no findings are extracted', () => {
    const analysis = buildPatientAnalysisFromEvidence({
        patient: { id: 21, patient_name: 'Justin McAdam' },
        domain: 'example',
        job: {},
        payload: {},
        evidence: normalizeAnalysisEvidencePayload({ facts: [] }),
    })

    assert.match(analysis.summaryText, /no functional evidence/i)
    assert.equal(analysis.structuredEvidenceFacts.length, 0)
})

test('includes in-scope reference documents with a facts-only guardrail', () => {
    const prompt = buildAnalysisEvidenceUserPrompt({
        notes: 'Participant reports fatigue after ten minutes.',
        transcriptEvidence: '',
        evidenceDocuments: [
            {
                id: 43,
                fileName: 'NDIS Letter of Support Justin McAdam- FINAL.docx',
                text: 'FIM total 50 of 126. The treating OT requests an increase to six hours per day.',
            },
        ],
    })

    assert.match(prompt, /Reference documents in scope/)
    assert.match(prompt, /--- Document: NDIS Letter of Support Justin McAdam- FINAL\.docx ---/)
    assert.match(prompt, /FIM total 50 of 126/)

    // A Letter of Support argues for funding. Its conclusions and its request must not become
    // findings, and the guardrail has to travel with the document every time one is in scope.
    assert.match(prompt, /Rules for reference documents:/)
    assert.match(prompt, /Never treat a document's conclusions, requests or persuasive framing/)
    assert.match(prompt, /Do not turn a document's funding request into a recommended intervention/)
})

test('asks the analyst where each support came from', () => {
    const prompt = buildAnalysisEvidenceUserPrompt({ notes: 'Notes.' })

    // The app shows provenance per support, so the contract and the rules have to ask for it.
    assert.ok(prompt.includes('"recommendedInterventions": [{"intervention": "...", "justification": "...", "sources": ["notes"]}]'))
    assert.ok(prompt.includes('"addressedInterventions": [{"intervention": "...", "justification": "...", "sources": ["notes"]}]'))
    assert.match(prompt, /- sources: the sources that state the support/)
    assert.match(prompt, /a support can be evidenced by several sources at once/)
})

test('leaves the document rules out when no documents are in scope', () => {
    const prompt = buildAnalysisEvidenceUserPrompt({ notes: 'Notes only.', transcriptEvidence: '' })

    assert.doesNotMatch(prompt, /Reference documents in scope/)
    assert.doesNotMatch(prompt, /Rules for reference documents:/)
})

test('drops empty documents and states when the document source had to be capped', () => {
    const prompt = buildAnalysisEvidenceUserPrompt({
        evidenceDocuments: [
            { fileName: 'blank.docx', text: '   ' },
            { fileName: 'big.docx', text: 'x'.repeat(FCA_ANALYSIS_DOCUMENT_CHARS + 500) },
        ],
    })

    assert.doesNotMatch(prompt, /blank\.docx/)
    assert.match(prompt, /\[source truncated at \d+ of \d+ characters\]/)
})

test('normalizes the documents that arrive on the job payload', () => {
    assert.deepEqual(normalizeEvidenceDocuments(undefined), [])
    assert.deepEqual(
        normalizeEvidenceDocuments([
            null,
            'not an object',
            { fileName: 'no-text.docx' },
            { id: '7', fileName: 'letter.docx', text: '  FIM total 50 of 126.  ', truncated: true },
        ]),
        [{ id: 7, fileName: 'letter.docx', text: 'FIM total 50 of 126.', truncated: true }]
    )
})

test('keeps the specifics a source records, and omits the field when there are none', () => {
    const [withDetail] = normalizeAnalysisEvidencePayload({
        facts: [
            {
                domain: 'standardised-assessment-summary',
                observedIssue: 'Requires total assistance for bowel management.',
                evidenceDetail: 'FIM total 50 of 126; WHODAS 2.0 112 of 144.',
            },
        ],
    }).facts

    assert.equal(withDetail.evidenceDetail, 'FIM total 50 of 126; WHODAS 2.0 112 of 144.')

    const [withoutDetail] = normalizeAnalysisEvidencePayload({
        facts: [{ domain: 'adl-personal-care', observedIssue: 'Requires assistance to shower.' }],
    }).facts

    assert.equal(Object.hasOwn(withoutDetail, 'evidenceDetail'), false)
})

test('asks the analyst to quote specifics and to cover standardised measures', () => {
    const prompt = buildAnalysisEvidenceUserPrompt({ notes: 'Notes.' })

    // Without these, a record's measures never reach the report once the document is not attached.
    assert.match(prompt, /evidenceDetail: the specifics a source records/)
    assert.match(prompt, /standardised-assessment-summary/)
    assert.match(prompt, /Name only measures the record actually contains/)
})

test('records fact provenance, and drops a source it cannot vouch for', () => {
    const evidence = normalizeAnalysisEvidencePayload({
        facts: [
            {
                domain: 'current-functioning',
                observedIssue: 'Requires supervision to mobilise.',
                source: 'document',
                sourceName: 'Letter of Support.docx',
            },
            {
                domain: 'adl-personal-care',
                observedIssue: 'Requires assistance to shower.',
                source: 'somewhere-else',
            },
        ],
    })

    // Provenance is kept on the payload the app reads, not just inside the prompt.
    const analysis = buildPatientAnalysisFromEvidence({
        patient: { id: 21, patient_name: 'Justin McAdam' },
        domain: 'example',
        job: {},
        payload: {},
        evidence,
    })

    const [documentFact, unlabelledFact] = analysis.structuredEvidenceFacts
    assert.equal(documentFact.source, 'document')
    assert.equal(documentFact.sourceName, 'Letter of Support.docx')
    assert.equal(Object.hasOwn(unlabelledFact, 'source'), false)
    assert.equal(Object.hasOwn(unlabelledFact, 'sourceName'), false)
})

test('records the in-scope documents in sourceStats so a stale analysis is visible', () => {
    const analysis = buildPatientAnalysisFromEvidence({
        patient: { id: 21, patient_name: 'Justin McAdam' },
        domain: 'example',
        job: {},
        payload: {},
        evidence: normalizeAnalysisEvidencePayload({ facts: [] }),
        sourceStats: {
            notesLength: 10,
            documentIds: [43],
            documentNames: ['NDIS Letter of Support Justin McAdam- FINAL.docx'],
            documentLength: 21204,
        },
    })

    assert.deepEqual(analysis.sourceStats.documentIds, [43])
    assert.deepEqual(analysis.sourceStats.documentNames, ['NDIS Letter of Support Justin McAdam- FINAL.docx'])
    assert.equal(analysis.sourceStats.documentLength, 21204)
})

test('keeps the sources each support came from', () => {
    const evidence = normalizeAnalysisEvidencePayload({
        recommendedInterventions: [
            { intervention: 'Occupational therapy', justification: 'Falls.', sources: ['document', 'notes', 'notes'] },
            { intervention: 'Personal care support', justification: 'Showering.', source: 'transcript' },
            { intervention: 'Mobility equipment', justification: 'Frame.', sources: ['hearsay', 'notes'] },
        ],
        addressedInterventions: [
            {
                intervention: 'Home modifications',
                justification: 'Ramp in place.',
                sources: ['document'],
                sourceNames: ['NDIS Letter of Support.docx', 'ndis letter of support.docx'],
            },
        ],
    })

    const [recommended, singular, partlyUnknown] = evidence.recommendedInterventions
    // Ordered notes -> transcript -> document and deduped, so the chips read the same every time.
    assert.deepEqual(recommended.sources, ['notes', 'document'])
    // A model that answers with the singular key the facts use is understood, not discarded.
    assert.deepEqual(singular.sources, ['transcript'])
    // An unrecognised value is dropped while what the model did cite is kept.
    assert.deepEqual(partlyUnknown.sources, ['notes'])
    assert.equal(Object.hasOwn(partlyUnknown, 'sourceNames'), false)

    const [addressed] = evidence.addressedInterventions
    assert.deepEqual(addressed.sources, ['document'])
    assert.deepEqual(addressed.sourceNames, ['NDIS Letter of Support.docx'])
})

test('omits support provenance entirely when the model gave none', () => {
    const evidence = normalizeAnalysisEvidencePayload({
        recommendedInterventions: [{ intervention: 'Occupational therapy', justification: 'Falls.' }],
        addressedInterventions: [{ intervention: 'Transport', justification: 'Uses taxi.', sources: ['nowhere'] }],
    })

    // No `sources` key at all: the app shows nothing rather than guessing a source on the model's behalf.
    assert.equal(Object.hasOwn(evidence.recommendedInterventions[0], 'sources'), false)
    assert.equal(Object.hasOwn(evidence.addressedInterventions[0], 'sources'), false)
    assert.equal(Object.hasOwn(evidence.addressedInterventions[0], 'sourceNames'), false)
})

test('the analyst is model-only: a missing AI key is an error, not a keyword fallback', async () => {
    const previousKey = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY

    try {
        await assert.rejects(
            () => buildPatientAnalysis({
                patient: { id: 21, patient_name: 'Justin McAdam', metadata: '{}' },
                domain: 'example',
                job: {},
                payload: {},
                transcripts: [],
                notesText: 'Frequent falls during transfers and reduced endurance.',
                aiUsage: {},
            }),
            /requires an AI key/
        )
    } finally {
        if (previousKey === undefined) {
            delete process.env.OPENAI_API_KEY
        } else {
            process.env.OPENAI_API_KEY = previousKey
        }
    }
})

test('transcript evidence prefers the FCA summary over the generic one', () => {
    const block = buildTranscriptEvidenceBlock([
        {
            id: 7,
            title: 'OT session',
            // Both styles are stored; the generic one is the weaker paraphrase and must not win.
            transcript_summary_text: 'Generic paraphrase that should not be used.',
            transcript_fca_summary_text: 'FCA findings for this consultation.',
            transcript_fca_summary_payload: {
                structuredEvidenceFacts: [
                    {
                        domain: 'adl-personal-care',
                        observedIssue: 'Showering requires supervision.',
                        functionalImpact: 'Cannot shower alone.',
                        supportImplication: 'Personal care support.',
                    },
                ],
            },
        },
    ])

    assert.match(block, /OT session/)
    assert.match(block, /FCA findings for this consultation\./)
    assert.match(block, /\[adl-personal-care\] Showering requires supervision\./)
    assert.doesNotMatch(block, /Generic paraphrase/)
})

test('transcript evidence falls back to the generic summary when no FCA summary exists', () => {
    const block = buildTranscriptEvidenceBlock([
        { id: 9, title: '', transcript_summary_text: 'Generic summary only.', transcript_fca_summary_text: '' },
    ])

    assert.match(block, /Transcript #9/)
    assert.match(block, /Generic summary only\./)
})

test('the model carried on the job always beats the worker fallbacks', () => {
    const previous = {
        ANALYSIS_WORKER_AI_MODEL: process.env.ANALYSIS_WORKER_AI_MODEL,
        REPORT_WORKER_AI_MODEL: process.env.REPORT_WORKER_AI_MODEL,
    }

    try {
        process.env.ANALYSIS_WORKER_AI_MODEL = 'gpt-5.4-mini'
        process.env.REPORT_WORKER_AI_MODEL = 'gpt-5.4'

        // A job with a model uses it, whatever the environment says. This is the guard for the
        // regression where the worker's own backfill queued jobs with no model and every analysis
        // came back on the fallback instead of the operator's selection.
        assert.equal(resolveAnalysisEvidenceModel('gpt-5.6-sol'), 'gpt-5.6-sol')
        assert.equal(resolveAnalysisEvidenceModel(''), 'gpt-5.4-mini')
        assert.equal(resolveAnalysisEvidenceModel(undefined), 'gpt-5.4-mini')
    } finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
        }
    }
})

test('the analyst model chain ends in a single documented constant', () => {
    const previous = {
        ANALYSIS_WORKER_AI_MODEL: process.env.ANALYSIS_WORKER_AI_MODEL,
        REPORT_WORKER_AI_MODEL: process.env.REPORT_WORKER_AI_MODEL,
    }

    try {
        delete process.env.ANALYSIS_WORKER_AI_MODEL
        delete process.env.REPORT_WORKER_AI_MODEL

        assert.equal(resolveAnalysisEvidenceModel(''), FCA_ANALYSIS_FALLBACK_MODEL)

        process.env.REPORT_WORKER_AI_MODEL = 'gpt-5.4'
        assert.equal(resolveAnalysisEvidenceModel(''), 'gpt-5.4')
    } finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
        }
    }
})
