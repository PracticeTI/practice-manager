import test from 'node:test'
import assert from 'node:assert/strict'
import {
    resolveFcaSectionMinWords,
    composeReport,
    buildPromptGuardrails,
    sanitizeLlmContextText,
    deidentifyLlmText,
    buildFcaEvidenceMap,
    resolveFcaReportStyle,
    resolveFcaSteeringNotes,
    replaceDomainKeyWithPracticeName,
    buildFcaPromptTokens,
    buildFcaCalloutGuidance,
    FCA_REPORT_SECTIONS,
    FCA_EXECUTIVE_SUMMARY_SECTION,
    FCA_DEIDENTIFY_MAX_CHARS,
    FCA_CORPUS_NOTES_CHARS,
    FCA_CORPUS_ATTACHMENT_CHARS,
    generateFcaReportDraft,
} from '../src/jobs/fcaReportGeneration.js'

test('uses configured minimum words when provided', () => {
    const section = { id: 'demo', minWords: 140 }
    assert.equal(resolveFcaSectionMinWords(section, { minWords: 220 }), 220)
})

test('falls back to the section default when no override is configured', () => {
    const section = { id: 'demo', minWords: 140 }
    assert.equal(resolveFcaSectionMinWords(section, {}), 140)
})

test('uses a section-specific override when one is configured', () => {
    const section = { id: 'referral-purpose', minWords: 110 }
    assert.equal(resolveFcaSectionMinWords(section, { sectionMinWords: { 'referral-purpose': 180 } }), 180)
})

test('reserves callout boxes for the recommendation and opinion in a standard report', () => {
    const guidance = buildFcaCalloutGuidance('standard')
    assert.match(guidance, /\[!recommendation\]/)
    assert.match(guidance, /\[!opinion\]/)
    assert.match(guidance, /only a few/i)
    // Section summaries and findings are an extended-report treatment.
    assert.doesNotMatch(guidance, /\[!finding\]/)
})

test('describes each callout treatment for an extended report', () => {
    const guidance = buildFcaCalloutGuidance('extended')
    for (const marker of ['[!summary]', '[!evidence]', '[!finding]', '[!recommendation]', '[!opinion]']) {
        assert.ok(guidance.includes(marker), `expected ${marker} in the extended guidance`)
    }
    assert.match(guidance, /rather than forcing one into every section/i)
    assert.match(guidance, /never place two boxes together/i)
})

test('an unknown report style falls back to the standard callout rules', () => {
    assert.equal(buildFcaCalloutGuidance('not-a-style'), buildFcaCalloutGuidance('standard'))
    assert.equal(buildFcaCalloutGuidance(undefined), buildFcaCalloutGuidance('standard'))
})

test('keeps the composed FCA report header concise without redundant metadata', () => {
    const markdown = composeReport({
        patientName: 'Sarah Chen',
        domain: 'example',
        practiceName: 'Example Practice',
        jobId: '56',
        sectionDrafts: [{ title: 'Overview', content: 'A short summary.' }],
    })

    assert.match(markdown, /^# Functional Capacity Assessment \(Draft\)/)
    assert.match(markdown, /Participant: Sarah Chen/)
    assert.match(markdown, /Practice: Example Practice/)
    assert.doesNotMatch(markdown, /Domain:/)
    assert.doesNotMatch(markdown, /example/)
    assert.doesNotMatch(markdown, /Generated At:/)
    assert.doesNotMatch(markdown, /Source Job ID:/)
    assert.doesNotMatch(markdown, /This draft is AI-assisted/)
})

test('composes a numbered report hierarchy and highlights the executive recommendation', () => {
    const markdown = composeReport({
        patientName: 'Sarah Chen',
        practiceName: 'Example Practice',
        sectionDrafts: [
            {
                id: 'executive-summary',
                title: 'Executive Summary',
                content: '**Recommendation — plan review:** Increase support in line with documented need.\n\nJustin requires support with daily routines.',
            },
            { id: 'referral-purpose', title: 'Referral Context and Report Purpose', content: 'The current plan is under review.' },
        ],
    })

    assert.match(markdown, /^## 1\. Executive Summary/m)
    assert.match(markdown, /> \[!recommendation\] \*\*Recommendation — plan review:\*\*/m)
    assert.match(markdown, /^## 2\. Referral Context and Report Purpose$/m)
    assert.match(markdown, /Justin requires support with daily routines\./)
})

test('boxes the recommendation however the model labels it', () => {
    const render = (content) => composeReport({
        patientName: 'Sarah Chen',
        practiceName: 'Example Practice',
        sectionDrafts: [{ id: 'executive-summary', title: 'Executive Summary', content }],
    })

    // A heading label used to be left unboxed, because only a plain or bold paragraph matched.
    const heading = render('### Recommendation\n\nIncrease support to seven hours per day.\n\nFollowing paragraphs.')
    assert.match(heading, /^> \[!recommendation\] \*\*Recommendation\*\*$/m)
    assert.match(heading, /^> Increase support to seven hours per day\.$/m)
    assert.doesNotMatch(heading, /###\s*Recommendation/)
    assert.match(heading, /^Following paragraphs\.$/m)

    const boldLabel = render('**Recommendation**\n\nIncrease support to seven hours per day.')
    assert.match(boldLabel, /^> \[!recommendation\] \*\*Recommendation\*\*$/m)
    assert.match(boldLabel, /^> Increase support to seven hours per day\.$/m)

    // A summary with no recommendation paragraph is left exactly as written.
    const unlabelled = render('The participant requires support each morning.')
    assert.doesNotMatch(unlabelled, /^>/m)
})

test('leads the report with a participant and assessment detail table when the practice supplied the values', () => {
    const markdown = composeReport({
        patientName: 'Justin McAdam',
        practiceName: 'Example Occupational Therapy',
        detailsRows: [
            { label: 'Participant', value: 'Justin McAdam' },
            { label: 'NDIS participant number', value: '431874971' },
            { label: 'Date of birth', value: '28 October 1961' },
            { label: 'Support coordinator', value: '' },
        ],
        sectionDrafts: [{ id: 'referral-purpose', title: 'Referral Context and Report Purpose', content: 'Body.' }],
    })

    assert.match(markdown, /^\| Item \| Detail \|$/m)
    assert.match(markdown, /^\| NDIS participant number \| 431874971 \|$/m)
    // A row with no value would print an empty cell the practice then has to notice and delete.
    assert.doesNotMatch(markdown, /Support coordinator/)
    assert.ok(markdown.indexOf('| Item | Detail |') < markdown.indexOf('## 1. Referral Context and Report Purpose'))
})

test('omits the detail table entirely when no detail values are known', () => {
    const markdown = composeReport({
        patientName: 'Sarah Chen',
        practiceName: 'Example Practice',
        sectionDrafts: [{ id: 'referral-purpose', title: 'Referral Context and Report Purpose', content: 'Body.' }],
    })

    assert.doesNotMatch(markdown, /\| Item \| Detail \|/)
    assert.match(markdown, /^## 1\. Referral Context and Report Purpose$/m)
})

test('falls back to the domain key when no practice name is supplied', () => {
    const markdown = composeReport({
        patientName: 'Sarah Chen',
        domain: 'example',
        jobId: '56',
        sectionDrafts: [],
    })

    assert.match(markdown, /Practice: example/)
    assert.doesNotMatch(markdown, /Domain:/)
})

test('swaps a bare domain key for the practice name without touching emails or URLs', () => {
    assert.equal(
        replaceDomainKeyWithPracticeName('example has prepared this assessment.', 'example', 'Example Practice'),
        'Example Practice has prepared this assessment.'
    )
    assert.equal(
        replaceDomainKeyWithPracticeName('Contact kate@example.com or see example.com.', 'example', 'Example Practice'),
        'Contact kate@example.com or see example.com.'
    )
    assert.equal(
        replaceDomainKeyWithPracticeName('The example-signature theme applies.', 'example', 'Example Practice'),
        'The example-signature theme applies.'
    )
    assert.equal(
        replaceDomainKeyWithPracticeName('example attended.', 'example', 'example'),
        'example attended.'
    )
})

test('builds guardrails that discourage copying stems and generic openings', () => {
    const guardrails = buildPromptGuardrails()

    assert.match(guardrails, /Do not copy approved stems verbatim/)
    assert.match(guardrails, /direct observation/)
    assert.match(guardrails, /exact hours, days, and schedules/)
    assert.match(guardrails, /standardised assessments/)
    assert.doesNotMatch(guardrails, /Sarah Chen/)
})

test('sanitizes names, addresses, and contact details from LLM context', () => {
    const sanitized = sanitizeLlmContextText(
        'Sarah Chen lives at 26 Somers Ave Malvern VIC 3144. Contact 0400 123 456 or sarah@example.com. Support worker Mary Jones attended.',
        { patientName: 'Sarah Chen' }
    )

    // The participant is described by role, and the FCA writers are told to say "the participant",
    // never "the patient" (see buildPromptGuardrails / IDENTITY_LABELS).
    assert.match(sanitized, /the participant/i)
    assert.doesNotMatch(sanitized, /\bthe patient\b/i)
    assert.doesNotMatch(sanitized, /Sarah Chen/)
    assert.doesNotMatch(sanitized, /26 Somers Ave/i)
    assert.doesNotMatch(sanitized, /VIC\s*3144/i)
    assert.doesNotMatch(sanitized, /0400\s*123\s*456/)
    assert.doesNotMatch(sanitized, /sarah@example\.com/i)
    assert.doesNotMatch(sanitized, /Mary Jones/)
})

test('does not fall back to full transcript text when summaries are missing', () => {
    const evidenceMap = buildFcaEvidenceMap({
        notes: '',
        transcripts: [
            {
                transcript_text: 'Long transcript evidence that should not be injected when no summary exists.',
                transcript_summary_text: '',
            },
        ],
        additionalContext: '',
        builderFormData: null,
    })

    assert.equal(evidenceMap.transcriptEvidenceSource, 'none')
    assert.equal(evidenceMap.sourceTextLength, 0)
})

test('uses builder transcript summary when provided', () => {
    const evidenceMap = buildFcaEvidenceMap({
        notes: '',
        transcripts: [
            {
                transcript_text: 'Raw transcript text',
                transcript_summary_text: '',
            },
        ],
        additionalContext: '',
        builderFormData: {
            transcriptSummaryReview: 'Participant demonstrates variable endurance and requires pacing supports.',
        },
    })

    assert.equal(evidenceMap.transcriptEvidenceSource, 'builder-edited-summary')
    assert.ok(evidenceMap.sourceTextLength > 0)
})

test('uses stored structured transcript evidence when present', () => {
    const evidenceMap = buildFcaEvidenceMap({
        notes: '',
        transcripts: [
            {
                transcript_summary_text: '',
                transcript_summary_payload: {
                    structuredEvidenceFacts: [
                        {
                            domain: 'mobility',
                            observedIssue: 'Patient reports near-falls during toilet transfers when fatigued.',
                            functionalImpact: 'Transfer safety is inconsistent and supervision is intermittently required.',
                            supportImplication: 'Falls risk mitigation and transfer support planning are indicated.',
                        },
                    ],
                },
            },
        ],
        additionalContext: '',
        builderFormData: null,
    })

    assert.equal(evidenceMap.transcriptEvidenceSource, 'stored-transcript-structured-evidence')
    assert.ok(evidenceMap.sourceTextLength > 0)
})

test('assigns a source sentence to one report section instead of repeating it', () => {
    const evidenceMap = buildFcaEvidenceMap({
        notes: 'The participant uses a wheeled walker to complete transfers around the home.',
        transcripts: [],
        additionalContext: '',
        builderFormData: null,
        sections: [
            { id: 'mobility', title: 'Mobility', keywords: ['walker', 'transfers'] },
            { id: 'daily-living', title: 'Daily Living', keywords: ['walker', 'transfers'] },
        ],
    })

    const selected = Object.values(evidenceMap.bySection).flat()
    assert.equal(selected.length, 1)
    assert.match(selected[0], /^\[Evidence source: clinical notes\] The participant uses a wheeled walker/)
})

test('combines structured transcript evidence and stored summary text', () => {
    const evidenceMap = buildFcaEvidenceMap({
        notes: '',
        transcripts: [
            {
                transcript_summary_text: 'OT and the patient discussed fatigue pacing and transfer safety concerns.',
                transcript_summary_payload: {
                    structuredEvidenceFacts: [
                        {
                            domain: 'fatigue',
                            observedIssue: 'Endurance drops after morning routines and cognitive load.',
                            functionalImpact: 'Capacity fluctuates significantly across the day.',
                            supportImplication: 'Task pacing and support timing are required to maintain participation.',
                        },
                    ],
                },
            },
        ],
        additionalContext: '',
        builderFormData: null,
    })

    assert.equal(evidenceMap.transcriptEvidenceSource, 'stored-transcript-structured-evidence+summary')
    assert.ok(evidenceMap.sourceTextLength > 0)
})

test('scales body sections for the extended style and keeps the summary at its own target', () => {
    const section = { id: 'recommendations-funding', minWords: 780 }
    const standard = resolveFcaReportStyle('standard')
    const extended = resolveFcaReportStyle('extended')

    assert.equal(resolveFcaSectionMinWords(section, {}, standard), 780)
    assert.equal(resolveFcaSectionMinWords(section, {}, extended), 1720)
    assert.equal(resolveFcaSectionMinWords(FCA_EXECUTIVE_SUMMARY_SECTION, {}, standard), 800)
    assert.equal(resolveFcaSectionMinWords(FCA_EXECUTIVE_SUMMARY_SECTION, {}, extended), 1000)
})

test('scales a configured section override with the style instead of ignoring it', () => {
    const section = { id: 'recommendations-funding', minWords: 780 }
    const promptConfig = { sectionMinWords: { 'recommendations-funding': 900 } }

    assert.equal(resolveFcaSectionMinWords(section, promptConfig), 900)
    assert.equal(resolveFcaSectionMinWords(section, promptConfig, 'extended'), 1980)
})

test('falls back to the standard style for an unknown style value', () => {
    assert.equal(resolveFcaReportStyle('forensic').id, 'standard')
    assert.equal(resolveFcaReportStyle(undefined).id, 'standard')
})

test('reads steering notes from the builder without treating them as evidence', () => {
    const steering = resolveFcaSteeringNotes({ additionalNotes: '  New funding - emphasise assistive technology.  ' })

    assert.equal(steering, 'New funding - emphasise assistive technology.')
    assert.equal(resolveFcaSteeringNotes(null), '')
    assert.equal(resolveFcaSteeringNotes({ additionalNotes: '   ' }), '')
})

test('leads every report with the executive summary and keeps steering notes out of the copy', async () => {
    const steeringNote = 'Emphasise assistive technology because new funding is available.'
    const draft = await generateFcaReportDraft({
        patientName: 'Test Participant',
        domain: 'example',
        notes: 'The participant requires assistance with showering and reports reduced endurance for community outings.',
        transcripts: [],
        additionalContext: '',
        builderFormData: { reportStyle: 'extended', additionalNotes: steeringNote },
        // No key, so every section is written by the heuristic fallback.
        provider: 'openai',
        apiKey: '',
        jobId: 7,
    })

    const headings = draft.markdown.split('\n').filter((line) => line.startsWith('## '))
    assert.equal(headings[0], '## 1. Executive Summary')
    assert.equal(draft.meta.reportStyle.id, 'extended')
    assert.equal(draft.meta.steeringNotesSupplied, true)
    assert.equal(draft.meta.qa.findings.filter((finding) => finding.code === 'missing-section').length, 0)

    // The steering note is direction for the model, never report text.
    assert.doesNotMatch(draft.markdown, /Emphasise assistive technology because new funding is available\./)
})

test('restores known participant and family names in the final report, not model input', async () => {
    const draft = await generateFcaReportDraft({
        patientName: 'Justin McAdam',
        domain: 'example',
        notes: 'Justin lives with his spouse Mary, who supports him with daily routines.',
        transcripts: [],
        additionalContext: '',
        builderFormData: {
            participantIdentity: {
                participantName: 'Justin McAdam',
                people: [{ name: 'Mary', role: "participant's wife" }],
            },
        },
        provider: '',
        apiKey: '',
        jobId: 8,
    })

    assert.match(draft.markdown, /Justin lives with Mary, who supports him with daily routines/i)
    assert.doesNotMatch(draft.markdown, /Justin(?: McAdam)?['’]s spouse|the participant's wife/i)
    assert.deepEqual(draft.meta.identityGlossary.people, [{ name: 'Mary', role: "participant's wife" }])
})

test('legacy saved prompts cannot enforce paragraph-only output or padded minimum lengths', async () => {
    const originalFetch = globalThis.fetch
    const requests = []
    globalThis.fetch = async (_url, options) => {
        requests.push(JSON.parse(options.body))
        return {
            ok: true,
            json: async () => ({ choices: [{ message: { content: 'Evidence-led draft.' } }] }),
        }
    }

    try {
        await generateFcaReportDraft({
            patientName: 'Justin McAdam',
            domain: 'example',
            notes: 'Justin requires assistance with showering.',
            transcripts: [],
            additionalContext: '',
            builderFormData: {
                participantIdentity: { participantName: 'Justin McAdam' },
            },
            provider: 'openai',
            apiKey: 'test-key',
            jobId: 10,
            reportTypeConfig: {
                fcaPromptConfig: {
                    systemPromptTemplate: 'Return plain markdown paragraphs only (no heading). Minimum {{MIN_WORDS}} words.',
                    userPromptTemplate: 'Section: {{SECTION_TITLE}}\nParticipant: {{PATIENT_NAME}}\nEvidence:\n{{EVIDENCE_LINES_OR_NO_DIRECT_EVIDENCE}}',
                },
            },
        })
    } finally {
        globalThis.fetch = originalFetch
    }

    assert.equal(requests.length, FCA_REPORT_SECTIONS.length)
    assert.match(requests[0].messages[0].content, /Use concise markdown subheadings/)
    assert.match(requests[0].messages[0].content, /do not pad or repeat content/i)
    assert.doesNotMatch(requests[0].messages[0].content, /paragraphs only|Minimum \d+ words/i)
    assert.match(requests[0].messages[1].content, /direct observation/i)
    assert.doesNotMatch(JSON.stringify(requests), /Justin McAdam/)
})

test('rewrites a saved callout instruction that predates the four box treatments', async () => {
    const originalFetch = globalThis.fetch
    const requests = []
    globalThis.fetch = async (_url, options) => {
        requests.push(JSON.parse(options.body))
        return {
            ok: true,
            json: async () => ({ choices: [{ message: { content: 'Evidence-led draft.' } }] }),
        }
    }

    try {
        await generateFcaReportDraft({
            patientName: 'Justin McAdam',
            domain: 'example',
            notes: 'Justin requires assistance with showering.',
            transcripts: [],
            additionalContext: '',
            builderFormData: {
                participantIdentity: { participantName: 'Justin McAdam' },
                reportStyle: 'extended',
            },
            provider: 'openai',
            apiKey: 'test-key',
            jobId: 12,
            reportTypeConfig: {
                fcaPromptConfig: {
                    userPromptTemplate: 'Section: {{SECTION_TITLE}}\n\nBoxed callouts: open a blockquote with [!evidence] to render a weight-of-evidence box, or with [!opinion] to render a clinical-opinion box. Put the lead-in label in bold at the start of the box, use at most one per section, and keep tables and lists outside it.',
                },
            },
        })
    } finally {
        globalThis.fetch = originalFetch
    }

    const userPrompt = requests[0].messages[1].content
    assert.doesNotMatch(userPrompt, /at most one per section/i)
    assert.match(userPrompt, /\[!summary\], \[!evidence\], \[!finding\], \[!recommendation\] or \[!opinion\]/)
    // The style-specific rules ride on the system prompt, so the saved template cannot override them.
    assert.match(requests[0].messages[0].content, /\[!finding\] for a clinical determination/)
})

test('a saved prompt length ceiling cannot shorten a section below its target', async () => {
    const originalFetch = globalThis.fetch
    const requests = []
    globalThis.fetch = async (_url, options) => {
        requests.push(JSON.parse(options.body))
        return {
            ok: true,
            json: async () => ({ choices: [{ message: { content: 'Evidence-led draft.' } }] }),
        }
    }

    try {
        await generateFcaReportDraft({
            patientName: 'Justin McAdam',
            domain: 'example',
            notes: 'Justin requires assistance with showering.',
            transcripts: [],
            additionalContext: '',
            builderFormData: { participantIdentity: { participantName: 'Justin McAdam' } },
            provider: 'openai',
            apiKey: 'test-key',
            jobId: 11,
            reportTypeConfig: {
                fcaPromptConfig: {
                    systemPromptTemplate: 'Length: about {{MIN_WORDS}} words, and never more than 10% above it. That is the target for the section, not a minimum - once the evidence for the section is covered, stop rather than extending it.',
                    userPromptTemplate: '- Length: about {{MIN_WORDS}} words, and never more than 10% above that. Treat it as the target, not a floor: do not pad to reach it, and stop once the evidence relevant to this section has been covered.',
                },
            },
        })
    } finally {
        globalThis.fetch = originalFetch
    }

    const systemPrompt = requests[0].messages[0].content
    const userPrompt = requests[0].messages[1].content
    for (const prompt of [systemPrompt, userPrompt]) {
        assert.doesNotMatch(prompt, /never more than/i)
        assert.doesNotMatch(prompt, /stop rather than extending it/i)
        assert.doesNotMatch(prompt, /stop once the evidence relevant to this section has been covered/i)
    }
    assert.match(systemPrompt, /Cover the evidence for this section fully/)
    assert.match(userPrompt, /Cover the evidence for this section fully/)

    // The target survives the ceiling removal: the referral section keeps its own word count and
    // the summary keeps the raised one.
    assert.match(systemPrompt, /about 330 words/)
    assert.match(requests[requests.length - 1].messages[0].content, /about 800 words/)
})

test('carries measured facts from the body sections into the executive summary', async () => {
    const originalFetch = globalThis.fetch
    const requests = []
    const bodyText = 'The Barthel Index scored 25 out of 100, down from 45 out of 100 in June 2025.'
    globalThis.fetch = async (_url, options) => {
        requests.push(JSON.parse(options.body))
        return {
            ok: true,
            json: async () => ({ choices: [{ message: { content: `${bodyText}\n\nFurther narrative.` } }] }),
        }
    }

    try {
        await generateFcaReportDraft({
            patientName: 'Justin McAdam',
            domain: 'example',
            notes: 'Justin requires assistance with showering.',
            transcripts: [],
            additionalContext: '',
            builderFormData: { participantIdentity: { participantName: 'Justin McAdam' } },
            provider: 'openai',
            apiKey: 'test-key',
            jobId: 12,
        })
    } finally {
        globalThis.fetch = originalFetch
    }

    const summaryPrompt = requests[requests.length - 1].messages[1].content
    assert.match(summaryPrompt, /25 out of 100/)
    assert.match(summaryPrompt, /45 out of 100/)
})

test('the executive summary hands the writer topic headings instead of one block of prose', () => {
    assert.deepEqual(FCA_EXECUTIVE_SUMMARY_SECTION.subheadings, [
        'Assessed level of need',
        'The central clinical finding',
        'Consequences to date',
        'Carer sustainability',
        'The alternative',
    ])
})

test('de-identifies participant and family names in clinician steering notes', async () => {
    const originalFetch = globalThis.fetch
    const requests = []
    globalThis.fetch = async (_url, options) => {
        requests.push(JSON.parse(options.body))
        return {
            ok: true,
            json: async () => ({ choices: [{ message: { content: 'Evidence-led draft.' } }] }),
        }
    }

    try {
        await generateFcaReportDraft({
            patientName: 'Justin McAdam',
            domain: 'example',
            notes: 'Justin lives with Mary.',
            transcripts: [],
            additionalContext: '',
            builderFormData: {
                additionalNotes: 'Justin lives with his wife Mary. Emphasise home supervision.',
                participantIdentity: {
                    participantName: 'Justin McAdam',
                    people: [{ name: 'Mary', role: "participant's wife" }],
                },
            },
            provider: 'openai',
            apiKey: 'test-key',
            jobId: 11,
        })
    } finally {
        globalThis.fetch = originalFetch
    }

    const prompts = JSON.stringify(requests)
    assert.doesNotMatch(prompts, /Justin McAdam|Justin|Mary/)
    assert.match(prompts, /Emphasise home supervision/)
    assert.match(prompts, /Clinician steering notes/)
})

test('labels evidence source categories for the model without claiming observation', async () => {
    const originalFetch = globalThis.fetch
    const requests = []
    globalThis.fetch = async (_url, options) => {
        requests.push(JSON.parse(options.body))
        return {
            ok: true,
            json: async () => ({ choices: [{ message: { content: 'Evidence-led draft.' } }] }),
        }
    }

    try {
        await generateFcaReportDraft({
            patientName: 'Test Participant',
            domain: 'example',
            notes: 'The clinical notes report reduced transfer safety.',
            transcripts: [],
            additionalContext: '',
            builderFormData: null,
            provider: 'openai',
            apiKey: 'test-key',
            jobId: 12,
        })
    } finally {
        globalThis.fetch = originalFetch
    }

    const prompts = JSON.stringify(requests)
    assert.match(prompts, /\[Evidence source: clinical notes\]/)
    assert.match(prompts, /A clinical note does not automatically establish direct observation by the OT/)
    assert.match(prompts, /use the supplied topic headings as level-three markdown headings/i)
})

test('heuristic fallback does not pad sections with repeated generic clinical context', async () => {
    const draft = await generateFcaReportDraft({
        patientName: 'Test Participant',
        domain: 'example',
        notes: 'The participant reports needing assistance with showering.',
        transcripts: [],
        additionalContext: '',
        builderFormData: null,
        provider: '',
        apiKey: '',
        jobId: 9,
    })

    assert.doesNotMatch(draft.markdown, /Additional clinical context/)
    assert.doesNotMatch(draft.markdown, /structured support to maintain safety, consistency in daily routines/)
})

test('lists the executive summary ahead of the body sections in report order', () => {
    assert.equal(FCA_REPORT_SECTIONS[0].id, 'executive-summary')
    assert.equal(FCA_REPORT_SECTIONS.length, 19)

    // The sections that make a change of circumstances request arguable rather than merely
    // descriptive: what changed, what it has already cost, what happens overnight, what is
    // restricted, and what the alternative would be.
    for (const sectionId of [
        'change-of-circumstances',
        'falls-injury-history',
        'overnight-sleep',
        'restrictive-practice',
        'support-worker-training',
        'alternatives-considered',
    ]) {
        assert.ok(FCA_REPORT_SECTIONS.some((section) => section.id === sectionId), `${sectionId} must be in report order`)
    }
})

test('keeps an attached document in the corpus when the notes alone exceed the old 12k ceiling', () => {
    // Patient 21-scale notes. The attachment used to sit behind these in the join, so the 12,000
    // character de-identify ceiling truncated it out of the corpus entirely (11,921 of 13,513
    // characters survived, and the attachment never reached a single section).
    const fillerLine = 'Note entry recorded for the appointment on the day described.'
    const notes = Array.from({ length: 220 }, () => fillerLine).join('\n')
    assert.ok(notes.length > 12000, 'fixture notes must exceed the old de-identify ceiling')

    // Deliberately carries recommendations-funding keywords so it is selectable as evidence.
    const attachmentMarker = 'MARKER-ATTACHMENT'
    const evidenceMap = buildFcaEvidenceMap({
        notes,
        transcripts: [],
        additionalContext: `${attachmentMarker}: the letter recommends additional support hours and funding that the notes do not mention.`,
        builderFormData: null,
    })

    const allEvidence = Object.values(evidenceMap.bySection).flat().join('\n')
    assert.match(allEvidence, new RegExp(attachmentMarker))
    assert.ok(evidenceMap.sourceTextLength > 12000, 'the whole notes source must survive, not a truncated prefix')
})

test('the worker scores the whole attached-document block the builder sends', () => {
    // The builder now hands over up to 120,000 characters of attached-document text. A marker past
    // the old 40,000-character cap proves the worker no longer clips that block.
    assert.equal(FCA_CORPUS_ATTACHMENT_CHARS, 120000)

    const filler = Array.from({ length: 900 }, (_, index) => `Visit note ${index}: routine review of daily tasks and routines.`).join('\n')
    const marker = 'MARKER-DEEP-ATTACHMENT: the therapist recommends additional support hours and funding.'
    const additionalContext = `${filler}\n${marker}`
    assert.ok(additionalContext.length > 40000, 'the marker must sit past the old cap')

    const evidenceMap = buildFcaEvidenceMap({
        notes: '',
        transcripts: [],
        additionalContext,
        builderFormData: null,
    })

    const allEvidence = Object.values(evidenceMap.bySection).flat().join('\n')
    assert.match(allEvidence, /MARKER-DEEP-ATTACHMENT/)
})

test('de-identifies by default without truncating, and still honours an explicit cap', () => {
    const longText = 'x'.repeat(15000)

    // The default has to clear a single corpus source; the old 12,000 ceiling did not.
    assert.ok(FCA_DEIDENTIFY_MAX_CHARS >= FCA_CORPUS_NOTES_CHARS)
    assert.equal(deidentifyLlmText(longText).length, 15000)

    // Callers that do want a ceiling still get one.
    assert.equal(deidentifyLlmText(longText, { maxChars: 250 }).length, 250)
})

test('section prompt tokens name the practice rather than the domain key', () => {
    const tokens = buildFcaPromptTokens({
        section: { id: 'referral-purpose', title: 'Referral Context and Report Purpose' },
        minWords: 726,
        domain: 'example',
        practiceName: 'Example Practice',
        evidenceLines: ['One line.', 'Another line.'],
        snippets: ['Stem one.'],
    })

    assert.equal(tokens.PRACTICE_NAME, 'Example Practice')
    // Legacy alias: saved prompts that still say {{DOMAIN}} get the practice name too.
    assert.equal(tokens.DOMAIN, 'Example Practice')
    assert.equal(tokens.SECTION_TITLE, 'Referral Context and Report Purpose')
    assert.equal(tokens.MIN_WORDS, '726')
    assert.equal(tokens.EVIDENCE_LINES_OR_NO_DIRECT_EVIDENCE, 'One line.\n- Another line.')
    assert.equal(tokens.APPROVED_SNIPPETS_OR_NONE, 'Stem one.')
    assert.ok(!JSON.stringify(tokens).includes('example'))
})

test('section prompt tokens fall back to the domain key and empty-state text', () => {
    const tokens = buildFcaPromptTokens({
        section: { id: 'goals-outcomes', title: 'Goals and Expected Outcomes' },
        minWords: 858,
        domain: 'example',
        evidenceLines: [],
        snippets: [],
    })

    assert.equal(tokens.PRACTICE_NAME, 'example')
    assert.equal(tokens.EVIDENCE_LINES_OR_NO_DIRECT_EVIDENCE, 'No direct evidence available.')
    assert.equal(tokens.APPROVED_SNIPPETS_OR_NONE, 'None supplied')
})

test('a generated draft carries the identity values into the detail table without asking the model for them', async () => {
    const originalFetch = globalThis.fetch
    const requests = []
    globalThis.fetch = async (_url, options) => {
        requests.push(JSON.parse(options.body))
        return { ok: true, json: async () => ({ choices: [{ message: { content: 'Evidence-led draft.' } }] }) }
    }

    let draft
    try {
        draft = await generateFcaReportDraft({
            patientName: 'Justin McAdam',
            domain: 'example',
            notes: 'Justin requires assistance with showering.',
            transcripts: [],
            additionalContext: '',
            builderFormData: {
                participantIdentity: {
                    participantName: 'Justin McAdam',
                    ndisNumber: '431874971',
                    dateOfBirth: '28 October 1961',
                },
                diagnosisSummary: 'Myotonic Dystrophy Type 1',
            },
            provider: 'openai',
            apiKey: 'test-key',
            jobId: 13,
        })
    } finally {
        globalThis.fetch = originalFetch
    }

    assert.match(draft.markdown, /^\| NDIS participant number \| 431874971 \|$/m)
    assert.match(draft.markdown, /^\| Primary disability \| Myotonic Dystrophy Type 1 \|$/m)
    // The identity block is the practice's own record; it must not be handed to the model as prompt text.
    assert.doesNotMatch(JSON.stringify(requests), /431874971/)
})
