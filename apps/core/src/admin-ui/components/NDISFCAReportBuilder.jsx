'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { joinNoteText } from '@/lib/notes'
import { REPORT_WORDS_PER_PAGE_ESTIMATE } from '@/lib/reportPageMetrics'
import { getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import {
    buildAttachmentRows,
    formatAttachmentDate,
    formatFileSize,
    isRecordingAttachment,
    isTextExtractable,
    normalizeAttachmentFiles,
    parseAttachmentContext,
    serializeAttachmentContext,
    toAttachmentEntry,
} from '@/lib/fcaAttachments'
import { buildFcaQueueSummary } from './fcaQueueSummary.js'
import {
    buildFcaReferenceSourceMetadata,
    FCA_REFERENCE_DOCUMENTS,
    FCA_REFERENCE_INCLUSION_NOTE,
    NDIS_FCA_FUNCTIONAL_AREAS,
} from '@/lib/fcaReferenceDocuments'
import {
    buildConcernPrefill,
    extractConcernLabels,
    extractConcernsFromAnalysisPayload,
    mergeConcernSuggestions,
} from './fcaConcernSuggestions.js'
import {
    extractAddressedInterventionsFromAnalysisPayload,
    extractInterventionRecommendationsFromAnalysisPayload,
    mergeInterventionSuggestions,
} from './fcaInterventionSuggestions.js'
import { extractIntakeGoals, padGoalsForEditing } from './fcaIntakeGoals.js'
import {
    buildParticipantIdentityBlock,
    buildParticipantSources,
    isParticipantSourceIncluded,
    normalizeParticipantSourceSelection,
    participantSourcesForStep,
    resolveParticipantSourceText,
    setParticipantSourceIncluded,
} from './fcaParticipantSources.js'
import ParticipantSourcesPanel from './ParticipantSourcesPanel.jsx'
import { DEFAULT_DOMAIN_MODE } from '@/lib/domainMode'
import {
    buildTranscriptRows,
    findTranscriptsMissingEvidence,
    normalizeTranscriptSelection,
    setTranscriptIncluded,
    setTranscriptSummaryOverride,
    setTranscriptsIncluded,
} from '@/lib/fcaTranscriptSelection'

// How long the builder waits for FCA transcript summaries before letting the report queue anyway.
// The worker defers the job until the summaries exist, so this is a courtesy wait, not a gate.
const QUEUE_SUMMARY_WAIT_SECONDS = 90
const SUMMARY_POLL_INTERVAL_MS = 5000

const STEPS = [
    { id: 'intro', label: 'Start', title: 'NDIS Functional Capacity Assessment Builder' },
    { id: 'participant', label: 'Participant Info', title: 'Participant Details' },
    { id: 'background', label: 'Background', title: 'Background & History' },
    { id: 'concerns', label: 'Current Concerns', title: 'Current Functional Concerns' },
    { id: 'diagnosis', label: 'Diagnosis', title: 'Diagnosis Information' },
    { id: 'interventions', label: 'Interventions', title: 'Interventions & Supports' },
    { id: 'goals', label: 'Goals', title: 'Goals & Objectives' },
    { id: 'additional-notes', label: 'Notes', title: 'Report Focus & Attachments' },
    { id: 'transcripts', label: 'Transcripts', title: 'Transcripts & Summaries' },
    { id: 'review', label: 'Review', title: 'Review & Queue Your Report' },
]

const COMMON_CONCERNS = [
    'Mobility limitations',
    'Communication difficulties',
    'Cognitive impairment',
    'Self-care support needed',
    'Home access barriers',
    'Community participation',
    'Seizure management',
    'Pain management',
    'Fatigue/energy limitations',
    'Swallowing/eating support',
]

const COMMON_INTERVENTIONS = [
    'Physiotherapy',
    'Occupational therapy',
    'Speech pathology',
    'Home modifications',
    'Assistive technology',
    'Personal care support',
    'Mobility equipment rental/purchase',
    'Community access support',
    'Psychosocial support',
    'Pain management strategies',
]

const COMMON_GOALS = [
    'Improve safe and efficient mobility within home and community settings',
    'Increase independence with personal care and daily routines',
    'Build endurance for sustained participation in valued activities',
    'Improve confidence and consistency with community access',
    'Reduce reliance on informal supports through targeted capacity building',
]

const ADHD_FRIENDLY_TIPS = [
    '✓ Save progress frequently',
    '✓ Each section can be edited later',
    '✓ Focus on one area at a time',
    '✓ Take breaks between sections',
    '✓ Auto-filled suggestions are editable',
]

const DEFAULT_FORM_DATA = {
    participantName: '',
    ndisNumber: '',
    dateOfBirth: '',
    address: '',
    planNominee: '',
    planManager: '',
    // Stored participant answers that the earlier steps now surface (see fcaParticipantSources.js).
    // The identity fields above are never model input; these carry the NDIS context facts.
    fundingSource: '',
    supportCoordinator: '',
    interpreterRequired: '',
    accidentDate: '',
    referrerRelationship: '',
    // Per-source include/exclude and clinician rewrites for the stored participant data, mirroring
    // `transcriptSelection`. Identity sources are excluded from the model by sensitivity, not here.
    participantSources: { excludedIds: [], overrides: {} },
    backgroundSummary: '',
    concerns: ['', '', ''],
    diagnosisSummary: '',
    interventions: ['', '', ''],
    currentInterventions: ['', '', ''],
    recommendedInterventions: ['', '', ''],
    goals: ['', '', ''],
    // Report shape, chosen on the review step: how long the worker writes each section.
    reportStyle: 'standard',
    // Clinician steering notes. Direction for emphasis only - see the worker's
    // `resolveFcaSteeringNotes`. They are never report copy and never scored as evidence.
    additionalNotes: '',
    transcriptSummaryReview: '',
    // Step 9: which stored transcripts feed the report, and any clinician rewrites of their
    // FCA summaries. Read back by the worker as the transcript evidence selection.
    transcriptSelection: { excludedIds: [], summaryOverrides: {} },
    // Step 8 reference files: the attached patient files plus the text read out
    // of them, which is handed to the worker as report context.
    attachmentFiles: [],
    attachmentContext: '',
}

const FCA_OPENAI_SYSTEM_PROMPT_TEMPLATE = [
    'You are an expert occupational therapist writing FCA report sections for NDIS plan review.',
    'Use only the supplied participant evidence; approved language stems are loose style guidance, never facts.',
    'Do not invent diagnoses, scores, dates, medications, incidents, support hours, or assessment findings.',
    'Write in professional Australian clinical English: specific, measured, readable, and grounded in real-world function.',
    'Aim for about {{MIN_WORDS}} words, but evidence takes priority over length; never pad or repeat content to reach a target.',
    'The report shell supplies the cover page and starts every numbered section on a new A4 page. Do not add a cover page, a second title, page-break markup, or a horizontal rule yourself.',
].join(' ')

const FCA_OPENAI_USER_PROMPT_TEMPLATE = [
    'Section: {{SECTION_TITLE}}',
    '',
    // Kept identical to the worker's default so the Payload Preview shows what is actually sent.
    'Participant: {{PATIENT_NAME}}',
    '',
    'Practice: {{PRACTICE_NAME}}',
    '',
    'Evidence:',
    '- {{EVIDENCE_LINES_OR_NO_DIRECT_EVIDENCE}}',
    '',
    'Approved language stems (style guidance only):',
    '- {{APPROVED_SNIPPETS_OR_NONE}}',
    '',
    'Output requirements: link each relevant functional impact to practical support implications; attribute sources only as specifically as the evidence permits.',
    'Evidence may include [Evidence source: ...] labels. Use these to distinguish input categories, but do not copy the labels into the report or treat them as proof of who observed or said something.',
    'Write in the assessing OT’s clinical voice. Use first person for the OT’s assessment or observations only when the evidence explicitly identifies them; otherwise attribute reports to the named source when available and never invent a speaker.',
    'Do not claim direct observation, a formal assessment, family or support-worker report, or a clinical-record finding unless the evidence identifies that source.',
    'Separate current supports from requested supports. State exact hours and schedules only when the evidence supplies them. Include standardised measures only when instrument and result are explicitly documented; preserve scores and comparisons exactly.',
    'Boxed callouts: open a blockquote with [!summary], [!evidence], [!finding], [!recommendation] or [!opinion]; the system guidance says when each applies. Put the lead-in label in bold at the start of the box, and keep tables and lists outside it.',
    'Keep the section title as the main heading and use the provided topic headings as level-three headings when supported by evidence. Format the opening executive-summary recommendation as a short standalone callout; use concise lists or tables when they improve scanning. State each finding once, and avoid stock phrases, repetition, filler, template notices, and raw context dumps.',
    'Layout: the template supplies the cover page and the report assembler starts every numbered section on a new A4 page. Do not add a cover page, duplicate title, page-break markup, or "---" separators to the section body.',
].join('\n')

// Report styles, mirroring the worker (two/src/lib/jobs/fcaReportGeneration.js). The review step's
// length estimate is computed from the same targets the worker writes each section to.
const FCA_REPORT_STYLES = [
    {
        id: 'standard',
        label: 'Standard',
        bodyWordMultiplier: 1,
        summaryMinWords: 800,
        description: 'The usual assessment length, for a routine plan review. Boxes are reserved for the support request and the closing clinical opinion.',
    },
    {
        id: 'extended',
        label: 'Extended',
        bodyWordMultiplier: 2.2,
        summaryMinWords: 1000,
        description: 'Expanded evidence and funding rationale for complex or contested plans, with section summaries and key findings boxed.',
    },
]

// The length estimate uses the same page metrics the preview paginates with, so "about N A4 pages"
// and the page the report actually lays out do not disagree because of a stray constant.
const FCA_WORDS_PER_PAGE = REPORT_WORDS_PER_PAGE_ESTIMATE

const FCA_SECTION_PROMPT_PLAN = [
    // Leads every report, in both styles, for the NDIA planner who may read only this section.
    {
        id: 'executive-summary',
        title: 'Executive Summary',
        minWords: 800,
        role: 'executive-summary',
        subheadings: [
            'Assessed level of need',
            'The central clinical finding',
            'Consequences to date',
            'Carer sustainability',
            'The alternative',
        ],
    },
    { id: 'referral-purpose', title: 'Referral Context and Report Purpose', minWords: 330 },
    {
        id: 'participant-context',
        title: 'Participant Context and Living Situation',
        minWords: 420,
        subheadings: ['Living arrangements and informal supports', 'Current funded support and carer context'],
    },
    { id: 'medical-background', title: 'Clinical Background and Relevant History', minWords: 540 },
    {
        id: 'change-of-circumstances',
        title: 'Change of Circumstances Since the Last Plan Review',
        minWords: 420,
        subheadings: ['What has changed', 'Functional consequences of the change'],
    },
    {
        id: 'falls-injury-history',
        title: 'Falls and Injury History',
        minWords: 420,
        subheadings: ['Recorded falls and injuries', 'Pattern and contributing factors'],
    },
    {
        id: 'current-functioning',
        title: 'Current Functional Presentation',
        minWords: 660,
        subheadings: ['Mobility and transfers', 'Communication and cognition', 'Learning, self-management and social interaction'],
    },
    {
        id: 'adl-personal-care',
        title: 'Personal Care and Activities of Daily Living',
        minWords: 660,
        subheadings: ['Personal care', 'Continence and toileting', 'Eating, swallowing and medication'],
    },
    {
        id: 'domestic-community',
        title: 'Domestic Function and Community Participation',
        minWords: 570,
        subheadings: ['Domestic activities', 'Community access and participation'],
    },
    {
        id: 'overnight-sleep',
        title: 'Sleep, Overnight Needs and Wellbeing',
        minWords: 390,
        subheadings: ['Overnight support needs', 'Sleep and its functional consequences'],
    },
    {
        id: 'assistive-technology',
        title: 'Assistive Technology and Environmental Supports',
        minWords: 420,
        subheadings: ['Current equipment and its effectiveness', 'Home modifications and environmental supports'],
    },
    {
        id: 'risk-safeguarding',
        title: 'Risk Profile and Safeguarding Considerations',
        minWords: 540,
        subheadings: ['Specific risks and incidents', 'Supervision needs and limits of equipment', 'Informal support sustainability'],
    },
    {
        id: 'restrictive-practice',
        title: 'Restrictive Practice Considerations',
        minWords: 330,
        subheadings: ['Current arrangements', 'Characterisation and recommendations'],
    },
    {
        id: 'support-worker-training',
        title: 'Capability and Training Requirements for Support Workers',
        minWords: 330,
        subheadings: ['Reported incidents', 'Implications for support'],
    },
    {
        id: 'standardised-assessment-summary',
        title: 'Assessment Findings and Clinical Interpretation',
        minWords: 420,
        subheadings: ['Standardised measures', 'Clinical interpretation and evidence limitations'],
    },
    { id: 'goals-outcomes', title: 'Goals and Expected Outcomes', minWords: 390 },
    {
        id: 'alternatives-considered',
        title: 'Consideration of Alternatives',
        minWords: 420,
        subheadings: ['The medical position', 'Residential care considered'],
    },
    {
        id: 'recommendations-funding',
        title: 'Recommendations and Funding Rationale',
        minWords: 780,
        subheadings: ['Requested support and hours', 'Assistive technology and home modifications', 'Therapeutic supports and review'],
    },
    { id: 'rationale-conclusion', title: 'Conclusion and Review Recommendations', minWords: 360 },
]

function resolveFcaReportStyle(value) {
    const normalized = String(value || '').trim().toLowerCase()
    return FCA_REPORT_STYLES.find((style) => style.id === normalized) || FCA_REPORT_STYLES[0]
}

/**
 * Section targets for the chosen style. The executive summary keeps its own target rather than
 * scaling with the body: it is written to be read on its own in one sitting.
 */
function buildFcaSectionPlan(styleValue) {
    const style = resolveFcaReportStyle(styleValue)
    return FCA_SECTION_PROMPT_PLAN.map((section) => ({
        ...section,
        minWords: section.role === 'executive-summary'
            ? style.summaryMinWords
            : Math.round((Number(section.minWords) * style.bodyWordMultiplier) / 10) * 10,
    }))
}

/** Approximate finished length for the chosen style, shown on the review step. */
function estimateFcaReportLength(styleValue) {
    const words = buildFcaSectionPlan(styleValue).reduce((total, section) => total + section.minWords, 0)
    return { words, pages: Math.max(1, Math.ceil(words / FCA_WORDS_PER_PAGE)) }
}

// Mirrors the worker's transport (two/src/lib/jobs/chatModelRequest.js): OpenAI-compatible vendors
// ride the chat-completions adapter, Claude speaks the Messages API, and Gemini has no adapter.
const FCA_WORKER_PROVIDER_LABELS = {
    openai: 'OpenAI',
    claude: 'Claude',
    anthropic: 'Claude',
    openrouter: 'OpenRouter',
    deepseek: 'DeepSeek',
}

function resolveFcaPromptMode(options) {
    const source = options && typeof options === 'object' && !Array.isArray(options) ? options : {}
    const provider = String(source.provider || source.aiProvider || '').trim().toLowerCase()
    const adapter = provider || 'openai'
    const adapterLabel = FCA_WORKER_PROVIDER_LABELS[adapter] || ''
    const hasInlineApiKey = Boolean(String(source.apiKey || '').trim())
    const hasExplicitAvailabilityFlag = Object.prototype.hasOwnProperty.call(source, 'hasApiKey')
    const hasApiKey = source.hasApiKey === true || hasInlineApiKey

    if (!hasExplicitAvailabilityFlag && !hasInlineApiKey) {
        return {
            mode: 'worker-env-resolved',
            reason: 'Frontend queue context does not include API key state. Worker resolves the provider API key from server environment at run time.',
        }
    }

    if (!hasApiKey) {
        return {
            mode: 'heuristic-only',
            reason: `No API key configured for the ${adapterLabel || adapter} adapter.`,
        }
    }

    if (adapterLabel) {
        return {
            mode: `${adapter === 'anthropic' ? 'claude' : adapter}-with-heuristic-fallback`,
            reason: `${adapterLabel} adapter enabled; each FCA section is attempted with prompts, then falls back to heuristic generation on error.`,
        }
    }

    return {
        mode: 'heuristic-only',
        reason: `Unsupported provider "${provider}" for FCA adapter; worker falls back to heuristic generation.`,
    }
}

function normalizeArrayField(value, fallback) {
    if (!Array.isArray(value)) return [...fallback]
    const normalized = value.map((item) => String(item || ''))
    return normalized.length > 0 ? normalized : [...fallback]
}

// Fills an interventions/supports field with every identified suggestion (no arbitrary cap on
// count) unless the clinician has already typed something into it, in which case their draft wins.
function buildInterventionPrefill(prevArray, suggestions) {
    const existing = Array.isArray(prevArray) ? prevArray : []
    const hasTypedValue = existing.some((item) => String(item || '').trim() !== '')
    if (hasTypedValue) return existing
    return suggestions.length > 0 ? [...suggestions] : existing
}

function buildInterventionsField(source) {
    const normalizedPrimary = normalizeArrayField(source?.interventions, [])
        .map((item) => String(item || '').trim())
        .filter(Boolean)

    const normalizedLegacy = [
        ...normalizeArrayField(source?.currentInterventions, []),
        ...normalizeArrayField(source?.recommendedInterventions, []),
    ]
        .map((item) => String(item || '').trim())
        .filter(Boolean)

    const uniqueInterventions = [...new Set((normalizedPrimary.length > 0 ? normalizedPrimary : normalizedLegacy))]
    const editable = uniqueInterventions.length > 0 ? uniqueInterventions : []

    while (editable.length < 3) {
        editable.push('')
    }

    return editable
}

function safeObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function normalizeAddressText(value) {
    if (!value) return ''

    if (typeof value === 'string') {
        return String(value || '').trim()
    }

    if (typeof value !== 'object' || Array.isArray(value)) {
        return ''
    }

    const parts = [
        value.addressLine1 || value.line1 || value.street,
        value.city || value.suburb || value.town,
        value.state || value.region,
        value.postalCode || value.postcode || value.zip,
        value.country,
    ]
        .map((part) => String(part || '').trim())
        .filter(Boolean)

    if (parts.length === 0) return ''
    return parts.join(', ')
}

function extractParticipantFormData(patient) {
    const source = safeObject(patient)
    const metadata = safeObject(source.metadata)
    const answers = safeObject(metadata.sploseAnswers)
    const labels = safeObject(metadata.sploseLabelledAnswers)

    const participantName = String(
        source.patient_name
        || metadata.patientName
        || labels['Full name']
        || answers.patient_full_name
        || labels['Patient full name']
        || ''
    ).trim()

    const ndisNumber = String(
        metadata.ndisNumber
        || metadata.ndis_number
        || labels['NDIS number']
        || answers.claim_or_reference_number
        || answers.ndis_number
        || ''
    ).trim()

    const dateOfBirth = String(
        metadata.dateOfBirth
        || metadata.date_of_birth
        || labels['Date of birth']
        || answers.date_of_birth
        || ''
    ).trim()

    const address = String(
        normalizeAddressText(metadata.address || labels['Address'] || answers.address || answers.addressLine1)
    ).trim()

    const planNominee = String(
        metadata.planNominee
        || metadata.plan_nominee
        || labels['Plan Nominee']
        || answers.plan_nominee
        || ''
    ).trim()

    const planManager = String(
        metadata.planManager
        || metadata.plan_manager
        || labels['Plan Manager']
        || answers.plan_manager
        || ''
    ).trim()

    return {
        participantName,
        ndisNumber,
        dateOfBirth,
        address,
        planNominee,
        planManager,
    }
}

function buildInitialFormData(patientName, initialFormData) {
    const source = initialFormData && typeof initialFormData === 'object' && !Array.isArray(initialFormData)
        ? initialFormData
        : {}

    return {
        ...DEFAULT_FORM_DATA,
        ...source,
        participantName: String(source.participantName || patientName || '').trim(),
        concerns: normalizeArrayField(source.concerns, DEFAULT_FORM_DATA.concerns),
        interventions: buildInterventionsField(source),
        currentInterventions: normalizeArrayField(source.currentInterventions, DEFAULT_FORM_DATA.currentInterventions),
        recommendedInterventions: normalizeArrayField(source.recommendedInterventions, DEFAULT_FORM_DATA.recommendedInterventions),
        goals: normalizeArrayField(source.goals, DEFAULT_FORM_DATA.goals),
        participantSources: normalizeParticipantSourceSelection(source.participantSources),
        transcriptSelection: normalizeTranscriptSelection(source.transcriptSelection),
        attachmentFiles: normalizeAttachmentFiles(source.attachmentFiles),
        attachmentContext: String(source.attachmentContext || ''),
        appointmentHistory: String(source.appointmentHistory || ''),
    }
}

function formatAppointmentHistory(appointments) {
    if (!Array.isArray(appointments) || appointments.length === 0) return ''

    const lines = appointments
        .slice(0, 200)
        .map((appointment) => {
            const start = String(appointment?.starts_at || '').trim()
            if (!start) return ''

            const end = String(appointment?.ends_at || '').trim()
            const time = end ? `${start} to ${end}` : start
            const notes = String(appointment?.notes || '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 1000)
            const details = [
                appointment?.service,
                appointment?.practitioner && `practitioner: ${appointment.practitioner}`,
                appointment?.location && `location: ${appointment.location}`,
                appointment?.progress_note_status && `progress note: ${appointment.progress_note_status}`,
                notes,
            ]
                .map((value) => String(value || '').trim())
                .filter(Boolean)

            return `- ${time}${details.length > 0 ? ` | ${details.join(' | ')}` : ''}`
        })
        .filter(Boolean)

    return lines.length > 0
        ? `Appointment history (dates are recorded in ISO format):\n${lines.join('\n')}`
        : ''
}

function generateMarkdownReport(data) {
    const doc = data || {}
    const dateStr = new Date().toLocaleDateString('en-AU', { year: 'numeric', month: 'long', day: 'numeric' })

    let md = `# Occupational Therapy Functional Capacity Assessment\n\n`
    md += `**Date:** ${dateStr}\n\n`

    // Participant Info
    if (doc.participantName) {
        md += `## Participant Information\n\n`
        md += `**Name:** ${doc.participantName}\n`
        if (doc.ndisNumber) md += `**NDIS Number:** ${doc.ndisNumber}\n`
        if (doc.dateOfBirth) md += `**Date of Birth:** ${doc.dateOfBirth}\n`
        if (doc.address) md += `**Address:** ${doc.address}\n`
        if (doc.planNominee) md += `**Plan Nominee:** ${doc.planNominee}\n`
        if (doc.planManager) md += `**Plan Manager:** ${doc.planManager}\n`
        md += `\n`
    }

    // Background
    if (doc.backgroundSummary) {
        md += `## Background\n\n`
        md += `${doc.backgroundSummary}\n\n`
    }

    // Current Concerns
    if (doc.concerns && doc.concerns.length > 0) {
        md += `## Current Concerns\n\n`
        for (const concern of doc.concerns) {
            if (concern.trim()) md += `- ${concern}\n`
        }
        md += `\n`
    }

    // Diagnosis
    if (doc.diagnosisSummary) {
        md += `## Diagnosis\n\n`
        md += `${doc.diagnosisSummary}\n\n`
    }

    // Interventions & Supports: the FCA Analyst and clinical notes both identify these as either
    // already addressed (currentInterventions) or newly recommended (recommendedInterventions).
    // Older drafts only ever populated the combined `interventions` field; treat that as
    // "Recommended" so nothing is silently dropped from a pre-existing draft.
    const addressedInterventions = normalizeArrayField(doc.currentInterventions, [])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    const recommendedInterventionsList = [...new Set([
        ...normalizeArrayField(doc.recommendedInterventions, [])
            .map((item) => String(item || '').trim())
            .filter(Boolean),
        ...(addressedInterventions.length === 0
            ? normalizeArrayField(doc.interventions, [])
                .map((item) => String(item || '').trim())
                .filter(Boolean)
            : []),
    ])]

    if (addressedInterventions.length > 0 || recommendedInterventionsList.length > 0) {
        md += `## Interventions & Supports\n\n`
        if (addressedInterventions.length > 0) {
            md += `### Addressed\n\n`
            for (const intervention of addressedInterventions) {
                md += `- ${intervention}\n`
            }
            md += `\n`
        }
        if (recommendedInterventionsList.length > 0) {
            md += `### Recommended\n\n`
            for (const intervention of recommendedInterventionsList) {
                md += `- ${intervention}\n`
            }
            md += `\n`
        }
    }

    // Goals
    if (doc.goals && doc.goals.length > 0) {
        md += `## Goals and Objectives\n\n`
        for (const goal of doc.goals) {
            if (goal.trim()) md += `- ${goal}\n`
        }
        md += `\n`
    }

    // The clinician's steering notes are deliberately not written into the draft. They are prompt
    // guidance for the worker, not report copy; they stay on the builder form data, which the draft's
    // source metadata stores, so reopening the builder restores them.

    // Reference files attached at Step 8. Only the file names are written into the
    // draft - the extracted text is context for the worker, not report copy.
    const attachmentFiles = normalizeAttachmentFiles(doc.attachmentFiles)
    if (attachmentFiles.length > 0) {
        md += `## Reference Files\n\n`
        for (const file of attachmentFiles) {
            md += `- ${file.fileName}${file.mimeType ? ` (${file.mimeType})` : ''}\n`
        }
        md += `\n`
    }

    return md
}

function extractNotesData(notes) {
    if (!notes) return {}

    function normalizeWhitespace(value) {
        return String(value || '')
            .replace(/\r\n/g, '\n')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim()
    }

    function clipSection(value, max = 2500) {
        const normalized = normalizeWhitespace(value)
        if (!normalized) return ''
        return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized
    }

    function getSectionText(source, headingPattern, stopPatterns = []) {
        const text = String(source || '')
        if (!text) return ''

        const headingRegex = new RegExp(`(?:^|\\n)(?:\\d+(?:\\.\\d+)?\\)\\s*)?${headingPattern}\\s*:?\\s*`, 'im')
        const headingMatch = text.match(headingRegex)
        if (!headingMatch || typeof headingMatch.index !== 'number') return ''

        const start = headingMatch.index + headingMatch[0].length
        const remainder = text.slice(start)
        let end = remainder.length

        for (const stopPattern of stopPatterns) {
            const stopRegex = new RegExp(`(?:^|\\n)(?:\\d+(?:\\.\\d+)?\\)\\s*)?${stopPattern}\\s*:?\\s*`, 'im')
            const stopMatch = remainder.match(stopRegex)
            if (!stopMatch || typeof stopMatch.index !== 'number') continue
            end = Math.min(end, stopMatch.index)
        }

        return remainder.slice(0, end).trim()
    }

    function extractBulletItems(source) {
        const text = String(source || '')
        if (!text) return []

        const bullets = []
        const lines = text.split('\n')
        for (const line of lines) {
            const match = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.+)$/)
            if (!match) continue
            const item = normalizeWhitespace(match[1])
            if (!item) continue
            bullets.push(item)
        }
        return bullets
    }

    function pickInterventionLabel(rawItem) {
        const item = String(rawItem || '')
        const interventionPatterns = [
            { pattern: /physiotherapy|physio/i, intervention: 'Physiotherapy' },
            { pattern: /occupational therapy|\bot\b/i, intervention: 'Occupational therapy' },
            { pattern: /speech pathology|speech|slp|swallowing/i, intervention: 'Speech pathology' },
            { pattern: /home modification|ramp|rail|grab|bathroom|threshold/i, intervention: 'Home modifications' },
            { pattern: /assistive technology|ict|technology|keyboard|mouse|equipment/i, intervention: 'Assistive technology' },
            { pattern: /personal care|care support|carer|caregiver|support worker/i, intervention: 'Personal care support' },
            { pattern: /mobility|walker|wheelchair|device|aid/i, intervention: 'Mobility equipment rental/purchase' },
            { pattern: /transport|community access|community participation/i, intervention: 'Community access support' },
            { pattern: /psychosocial|counseling|counselling|mental|psychology|adjustment/i, intervention: 'Psychosocial support' },
            { pattern: /pain.*management|pain.*strategy/i, intervention: 'Pain management strategies' },
        ]

        for (const { pattern, intervention } of interventionPatterns) {
            if (pattern.test(item)) return intervention
        }

        return ''
    }

    const notesLower = notes.toLowerCase()
    const extracted = {
        concerns: [],
        interventions: [],
        currentInterventions: [],
        recommendedInterventions: [],
        diagnosis: '',
        backgroundSummary: ''
    }

    // Extract concerns from notes. The catalog lives in fcaConcernSuggestions.js so this pass and
    // the FCA Analyst pass cannot drift apart.
    extracted.concerns.push(...extractConcernLabels(notesLower))

    // Extract interventions from whole notes (keyword pass)
    const interventionPatterns = [
        { pattern: /physiotherapy|physio/i, intervention: 'Physiotherapy' },
        { pattern: /occupational therapy|ot\b/i, intervention: 'Occupational therapy' },
        { pattern: /speech pathology|speech|slp|swallowing/i, intervention: 'Speech pathology' },
        { pattern: /home modification|ramp|rail|grab|bathroom/i, intervention: 'Home modifications' },
        { pattern: /assistive technology|ict|technology|keyboard|mouse|software/i, intervention: 'Assistive technology' },
        { pattern: /personal care|care support|carer|caregiver/i, intervention: 'Personal care support' },
        { pattern: /mobility|walker|equipment|wheelchair|device|aid/i, intervention: 'Mobility equipment rental/purchase' },
        { pattern: /transport|community access|community participation support/i, intervention: 'Community access support' },
        { pattern: /psychosocial|counseling|mental|psychology|adjustment/i, intervention: 'Psychosocial support' },
        { pattern: /pain.*management|pain.*strategy/i, intervention: 'Pain management strategies' },
    ]

    for (const { pattern, intervention } of interventionPatterns) {
        if (pattern.test(notesLower) && !extracted.interventions.includes(intervention)) {
            extracted.interventions.push(intervention)
        }
    }

    // Extract diagnosis information (legacy and modern heading styles)
    const diagnosisSection = getSectionText(
        notes,
        '(?:diagnosis(?: information)?|medical and clinical background|clinical background)',
        [
            'current functional presentation',
            'current functioning',
            'functional capacity',
            'personal care',
            'domestic function',
            'community access',
            'recommendations',
            'ndis goal',
            'goal alignment',
        ]
    )
    if (diagnosisSection) {
        extracted.diagnosis = clipSection(diagnosisSection, 1500)
    }

    // Extract background and history information
    const backgroundSection = getSectionText(
        notes,
        '(?:background|history|participant profile and living context|referral context and purpose)',
        [
            'medical and clinical background',
            'clinical background',
            'diagnosis',
            'current functional presentation',
            'current functioning',
            'functional capacity',
            'personal care',
        ]
    )
    if (backgroundSection) {
        extracted.backgroundSummary = clipSection(backgroundSection, 1500)
    } else {
        // Fallback: try to extract from early paragraphs if no specific section
        const lines = notes.split('\n').slice(0, 5).join('\n')
        if (lines.length > 50) {
            extracted.backgroundSummary = lines.substring(0, 1500)
        }
    }

    // Extract interventions from dedicated current/recommendation sections when available.
    const currentManagementSection = getSectionText(
        notes,
        '(?:current management|current interventions?)',
        [
            'recommended supports?',
            'recommendations?',
            'ndis goal',
            'goal alignment',
            'review frequency',
            'clinical conclusion',
        ]
    )
    const recommendationsSection = getSectionText(
        notes,
        '(?:recommendations?(?: \(.*\))?|recommended supports?|assistive technology and equipment|capacity building supports?)',
        [
            'review frequency',
            'clinical conclusion',
            'end of clinical notes',
        ]
    )

    const currentCandidates = extractBulletItems(currentManagementSection)
    const recommendedCandidates = extractBulletItems(recommendationsSection)

    const currentMapped = [...new Set(currentCandidates.map(pickInterventionLabel).filter(Boolean))]
    const recommendedMapped = [...new Set(recommendedCandidates.map(pickInterventionLabel).filter(Boolean))]

    // Every support the clinician actually wrote down is worth surfacing - no arbitrary cap here.
    if (currentMapped.length > 0) {
        extracted.currentInterventions = currentMapped
    }

    if (recommendedMapped.length > 0) {
        extracted.recommendedInterventions = recommendedMapped
    }

    if (extracted.currentInterventions.length > 0 || extracted.recommendedInterventions.length > 0) {
        const combined = [...extracted.currentInterventions, ...extracted.recommendedInterventions]
        extracted.interventions = [...new Set(combined)]
    }

    return extracted
}

const AUTO_RESIZE_SUGGESTION_LIMIT = 6

// Step 1 preview of the official NDIS material the report is framed against. The same document is
// compiled into the worker's prompt as reference guidance (two/src/lib/jobs/fcaReferenceGuidance.js),
// so the card is also where the clinician learns what the model is being told.
function FcaReferenceCard() {
    const documents = FCA_REFERENCE_DOCUMENTS
    const [isExpanded, setIsExpanded] = useState(false)

    if (documents.length === 0) return null

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-900">Reference material</span>
                <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
                    Included in the AI context
                </span>
            </div>

            {documents.map((doc) => (
                <div
                    key={doc.id}
                    className="overflow-hidden rounded-xl border border-sky-200 bg-white shadow-sm"
                >
                    <div className="flex items-start gap-4 border-b border-sky-200 bg-sky-100 px-6 py-5">
                        <div className="flex h-11 w-11 flex-none items-center justify-center rounded-lg bg-white text-lg font-bold text-sky-700 shadow-sm ring-1 ring-sky-100">
                            NDIS
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">
                                {doc.publisherShort} official guidance
                            </p>
                            <h3 className="mt-1 text-base font-semibold text-gray-900">{doc.title}</h3>
                            <p className="mt-1 text-xs text-gray-600">
                                {doc.publisher} · Page current as of {doc.pageCurrentAsOf}
                            </p>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={() => setIsExpanded((expanded) => !expanded)}
                        aria-expanded={isExpanded}
                        aria-label={isExpanded ? 'Collapse reference material details' : 'Expand reference material details'}
                        className="flex w-full items-center justify-center border-b border-sky-100 bg-white py-2 text-sky-600 transition-colors hover:bg-sky-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-sky-500"
                    >
                        <svg
                            viewBox="0 0 20 20"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            className={`h-5 w-5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                            aria-hidden="true"
                        >
                            <path d="m5 7.5 5 5 5-5" />
                        </svg>
                    </button>

                    {isExpanded && <div className="px-6 py-5">
                        <p className="text-sm text-gray-700">{doc.summary}</p>

                        <ul className="mt-4 space-y-2">
                            {doc.keyPoints.map((point) => (
                                <li key={point} className="flex gap-2 text-sm text-gray-700">
                                    <span aria-hidden="true" className="mt-0.5 text-sky-600">•</span>
                                    <span>{point}</span>
                                </li>
                            ))}
                        </ul>

                        <div className="mt-5 rounded-lg border border-sky-100 bg-sky-50/60 px-4 py-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">
                                The NDIA splits functional capacity into six areas
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                                {NDIS_FCA_FUNCTIONAL_AREAS.map((area) => (
                                    <span
                                        key={area}
                                        className="rounded-full bg-white px-3 py-1 text-xs font-medium text-sky-800 ring-1 ring-sky-200"
                                    >
                                        {area}
                                    </span>
                                ))}
                            </div>
                        </div>

                        <div className="mt-5 flex flex-wrap items-center gap-3">
                            <a
                                href={doc.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-2 rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sky-700"
                            >
                                Read it on ndis.gov.au
                                <span aria-hidden="true">↗</span>
                            </a>
                            {doc.pdfUrl && (
                                <a
                                    href={doc.pdfUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-2 rounded-md border border-sky-200 bg-white px-4 py-2 text-sm font-medium text-sky-700 transition-colors hover:bg-sky-50"
                                >
                                    Save the page as PDF
                                    <span aria-hidden="true">↗</span>
                                </a>
                            )}
                        </div>

                        {Array.isArray(doc.relatedLinks) && doc.relatedLinks.length > 0 && (
                            <p className="mt-4 text-xs text-gray-500">
                                Related:{' '}
                                {doc.relatedLinks.map((link, idx) => (
                                    <span key={link.url}>
                                        {idx > 0 && ' · '}
                                        <a
                                            href={link.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="font-medium text-sky-700 underline decoration-sky-200 hover:text-sky-900"
                                        >
                                            {link.title}
                                        </a>
                                    </span>
                                ))}
                            </p>
                        )}

                        <div className="mt-5 border-t border-sky-100 bg-gray-50 px-0 pt-3">
                            <p className="text-xs text-gray-600">{FCA_REFERENCE_INCLUSION_NOTE}</p>
                        </div>
                    </div>
                    }
                </div>
            ))}
        </div>
    )
}

// Single-line inputs clipped long goals, so each goal row is a textarea that
// grows to fit its content while keeping the previous datalist-style suggestions.
function AutoResizeTextarea({ value, onChange, suggestions = [], placeholder, className = '' }) {
    const textareaRef = useRef(null)
    const [showSuggestions, setShowSuggestions] = useState(false)

    useEffect(() => {
        const element = textareaRef.current
        if (!element) return
        element.style.height = 'auto'
        element.style.height = `${element.scrollHeight}px`
    }, [value])

    const query = String(value || '').trim().toLowerCase()
    const matches = useMemo(() => {
        if (!query) return []
        return suggestions
            .filter((item) => {
                const text = String(item || '').trim()
                return text && text.toLowerCase() !== query && text.toLowerCase().includes(query)
            })
            .slice(0, AUTO_RESIZE_SUGGESTION_LIMIT)
    }, [query, suggestions])

    const applySuggestion = (suggestion) => {
        onChange(suggestion)
        setShowSuggestions(false)
    }

    return (
        <div className="relative">
            <textarea
                ref={textareaRef}
                rows={1}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setShowSuggestions(false)}
                placeholder={placeholder}
                className={`w-full resize-none overflow-hidden px-4 py-2 leading-relaxed rounded-md border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent ${className}`}
            />
            {showSuggestions && matches.length > 0 && (
                <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg">
                    {matches.map((item) => (
                        <li key={item}>
                            <button
                                type="button"
                                onMouseDown={(event) => {
                                    event.preventDefault()
                                    applySuggestion(item)
                                }}
                                className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-blue-50"
                            >
                                {item}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

// One category ("Addressed" or "Recommended") of the Interventions & Supports step. The FCA
// Analyst and clinical notes each identify suggestions per category (see
// analysisAddressedInterventionSuggestions/analysisInterventionSuggestions), so the two
// categories are rendered with the same layout but their own field, suggestions and accent color.
function InterventionCategoryEditor({
    field,
    title,
    description,
    emptyPlaceholder,
    values,
    suggestions,
    justificationMap,
    accent,
    onArrayChange,
    onAddItem,
    onToggleSuggestion,
    onShowJustification,
}) {
    const accentClasses = accent === 'sky'
        ? {
            bg: 'bg-sky-50', border: 'border-sky-200', text: 'text-sky-900',
            chipSelected: 'bg-sky-600 text-white font-medium', chipUnselected: 'bg-sky-100 text-sky-800 hover:bg-sky-200',
            infoBorder: 'border-sky-300', infoText: 'text-sky-700', infoHover: 'hover:bg-sky-100',
        }
        : {
            bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-900',
            chipSelected: 'bg-emerald-600 text-white font-medium', chipUnselected: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200',
            infoBorder: 'border-emerald-300', infoText: 'text-emerald-700', infoHover: 'hover:bg-emerald-100',
        }

    return (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900 mb-1">{title}</h3>
            <p className="text-sm text-gray-600 mb-4">{description}</p>
            {suggestions.length > 0 && (
                <div className={`mb-4 p-3 ${accentClasses.bg} border ${accentClasses.border} rounded`}>
                    <p className={`text-xs font-medium ${accentClasses.text} mb-2`}>💡 Suggested (click to add):</p>
                    <div className="flex flex-wrap gap-2">
                        {suggestions.map((intervention) => {
                            const isSelected = values.includes(intervention)
                            const justification = justificationMap.get(String(intervention || '').trim().toLowerCase()) || ''
                            return (
                                <div key={intervention} className="inline-flex items-center gap-1">
                                    <button
                                        type="button"
                                        onClick={() => onToggleSuggestion(field, intervention)}
                                        className={`text-xs px-2 py-1 rounded transition-colors ${isSelected ? accentClasses.chipSelected : accentClasses.chipUnselected}`}
                                    >
                                        {intervention} {isSelected ? '✓' : ''}
                                    </button>
                                    {justification && (
                                        <button
                                            type="button"
                                            onClick={() => onShowJustification({ intervention, justification })}
                                            className={`inline-flex h-5 w-5 items-center justify-center rounded-full border ${accentClasses.infoBorder} bg-white text-[11px] font-semibold ${accentClasses.infoText} ${accentClasses.infoHover}`}
                                            aria-label={`Show justification for ${intervention}`}
                                        >
                                            i
                                        </button>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}
            <div className="space-y-3">
                {values.map((intervention, idx) => (
                    <div key={idx} className="flex gap-2">
                        <input
                            type="text"
                            value={intervention}
                            onChange={(e) => onArrayChange(field, idx, e.target.value)}
                            title={justificationMap.get(String(intervention || '').trim().toLowerCase()) || undefined}
                            className="flex-1 px-4 py-2 rounded-md border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder={suggestions[idx] || COMMON_INTERVENTIONS[idx] || emptyPlaceholder}
                            list={`${field}-list-${idx}`}
                        />
                        <datalist id={`${field}-list-${idx}`}>
                            {[...new Set([...suggestions, ...COMMON_INTERVENTIONS])].map((item) => (
                                <option key={item} value={item} />
                            ))}
                        </datalist>
                    </div>
                ))}
            </div>
            <button
                type="button"
                onClick={() => onAddItem(field)}
                className="mt-4 text-sm font-medium text-blue-600 hover:text-blue-700"
            >
                + Add another
            </button>
        </div>
    )
}

export default function NDISFCAReportBuilder({ patientName, patientId, initialFormData, queueContext, onSaveDraft, onSave, onClose }) {
    const [currentStep, setCurrentStep] = useState(0)
    const [loading, setLoading] = useState(!!patientId)
    const [savingDraft, setSavingDraft] = useState(false)
    const [showQueueActionsMenu, setShowQueueActionsMenu] = useState(false)
    const [showQueueContextMenu, setShowQueueContextMenu] = useState(false)
    const [patientNotes, setPatientNotes] = useState('')
    const [suggestedConcerns, setSuggestedConcerns] = useState([])
    const [suggestedInterventions, setSuggestedInterventions] = useState([])
    const [suggestedAddressedInterventions, setSuggestedAddressedInterventions] = useState([])
    const [intakeGoals, setIntakeGoals] = useState([])
    const [analysisInterventionSuggestions, setAnalysisInterventionSuggestions] = useState([])
    const [analysisAddressedInterventionSuggestions, setAnalysisAddressedInterventionSuggestions] = useState([])
    const [interventionInfoSuggestion, setInterventionInfoSuggestion] = useState(null)
    const [patientFiles, setPatientFiles] = useState([])
    const [patientFilesLoading, setPatientFilesLoading] = useState(false)
    // Which participant the file list was loaded for, so switching participant
    // inside an open builder refetches rather than showing the previous list.
    const [patientFilesLoadedFor, setPatientFilesLoadedFor] = useState('')
    const [attachmentsError, setAttachmentsError] = useState('')
    const [attachmentsNotice, setAttachmentsNotice] = useState('')
    const [attachmentBusyId, setAttachmentBusyId] = useState('')
    const [attachmentUploading, setAttachmentUploading] = useState(false)
    const [attachmentPreviewId, setAttachmentPreviewId] = useState('')
    const [showRecordingFiles, setShowRecordingFiles] = useState(false)
    const [transcriptSummaryError, setTranscriptSummaryError] = useState('')
    // Step 9 ("Transcripts & Summaries"): the participant's stored transcripts, the FCA-style
    // summaries prepared for them, and the readiness report driving the progress UI.
    const [transcripts, setTranscripts] = useState([])
    const [expandedTranscriptId, setExpandedTranscriptId] = useState('')
    const [transcriptSummaries, setTranscriptSummaries] = useState([])
    const [fcaReadiness, setFcaReadiness] = useState(null)
    const [transcriptStepLoadedFor, setTranscriptStepLoadedFor] = useState('')
    const [transcriptStepLoading, setTranscriptStepLoading] = useState(false)
    const [transcriptStepError, setTranscriptStepError] = useState('')
    const [preparingSummaries, setPreparingSummaries] = useState(false)
    const [prepareMessage, setPrepareMessage] = useState('')
    const [prepareTone, setPrepareTone] = useState('info')
    const [queuePreparation, setQueuePreparation] = useState(null)
    // `proceedWithQueue` is defined after the effects that may trigger it, so it is held in a ref
    // to keep those effects free of definition-order coupling.
    const proceedWithQueueRef = useRef(null)
    const [formData, setFormData] = useState(() => buildInitialFormData(patientName, initialFormData))
    // Every stored participant answer the builder can use, loaded with the patient record. The rows
    // carry provenance + sensitivity so the steps can show what came from the record and keep
    // identity values out of the model context.
    const [participantSourceRows, setParticipantSourceRows] = useState([])
    const hasInitialFormData = useMemo(() => {
        return Boolean(initialFormData && typeof initialFormData === 'object' && !Array.isArray(initialFormData) && Object.keys(initialFormData).length > 0)
    }, [initialFormData])

    const step = STEPS[currentStep]
    const queueDomain = useMemo(() => {
        const source = queueContext && typeof queueContext === 'object' && !Array.isArray(queueContext)
            ? queueContext
            : {}
        return String(source.domain || DEFAULT_DOMAIN_MODE).trim().toLowerCase() || DEFAULT_DOMAIN_MODE
    }, [queueContext])

    const participantSourceRowsForStep = useCallback(
        (stepNumber) => participantSourcesForStep(participantSourceRows, stepNumber),
        [participantSourceRows]
    )

    // The stored participant text that would land in a step's field right now, with the clinician's
    // rewrites applied and excluded sources left out. Used both for the prefill and to decide whether
    // unticking a source can safely clear the field it filled.
    const handleParticipantSourceToggle = useCallback((sourceId, included) => {
        setFormData((prev) => {
            const nextSelection = setParticipantSourceIncluded(prev.participantSources, sourceId, included)
            const row = participantSourceRows.find((entry) => entry.id === sourceId)
            const field = row?.field
            if (!field) return { ...prev, participantSources: nextSelection }

            // Unticking only clears the field while it still holds the untrimmed source text. Once
            // the clinician has edited the field their wording wins, so re-ticking cannot clobber it.
            const current = String(prev[field] ?? '').trim()
            const original = resolveParticipantSourceText(row, prev.participantSources).trim()
            if (included || (current && current !== original)) {
                return { ...prev, participantSources: nextSelection }
            }

            return { ...prev, participantSources: nextSelection, [field]: '' }
        })
    }, [participantSourceRows])

    // `formData.attachmentContext` is the store of truth for the attached text, so
    // the per-file text is read back out of it instead of being kept twice.
    const attachmentFiles = useMemo(
        () => normalizeAttachmentFiles(formData.attachmentFiles),
        [formData.attachmentFiles]
    )

    const attachmentTexts = useMemo(
        () => parseAttachmentContext(formData.attachmentContext),
        [formData.attachmentContext]
    )

    const attachmentRows = useMemo(
        () => buildAttachmentRows(patientFiles, formData.attachmentFiles),
        [patientFiles, formData.attachmentFiles]
    )

    // Recordings are hidden from the picker: they have no readable text, and the consultation's
    // content already reaches the report through its transcript summary. Anything already attached
    // stays listed so a recording can never sit in the report context unseen.
    const attachedFileIds = useMemo(
        () => new Set(attachmentFiles.map((file) => file.id)),
        [attachmentFiles]
    )

    // Documents the FCA Analyst already reads as evidence. Their content reaches the report through
    // the analyst's findings, so attaching them here is optional - which is the point of putting a
    // Letter of Support in the analyst's scope rather than re-attaching it to every report.
    const analystScopedFileIds = useMemo(
        () => new Set(
            (Array.isArray(patientFiles) ? patientFiles : [])
                .filter((file) => file?.analysis_evidence === true)
                .map((file) => String(file.id))
        ),
        [patientFiles]
    )

    const hiddenRecordingRows = useMemo(
        () => (showRecordingFiles
            ? []
            : attachmentRows.filter((file) => isRecordingAttachment(file) && !attachedFileIds.has(file.id))),
        [attachmentRows, attachedFileIds, showRecordingFiles]
    )

    const visibleAttachmentRows = useMemo(() => {
        if (hiddenRecordingRows.length === 0) return attachmentRows
        const hiddenIds = new Set(hiddenRecordingRows.map((file) => file.id))
        return attachmentRows.filter((file) => !hiddenIds.has(file.id))
    }, [attachmentRows, hiddenRecordingRows])

    const recordingFileCount = useMemo(
        () => attachmentRows.filter((file) => isRecordingAttachment(file)).length,
        [attachmentRows]
    )

    const attachmentTextLength = useMemo(
        () => [...attachmentTexts.values()].reduce((total, text) => total + text.length, 0),
        [attachmentTexts]
    )

    const transcriptSelection = useMemo(
        () => normalizeTranscriptSelection(formData.transcriptSelection),
        [formData.transcriptSelection]
    )

    const transcriptRows = useMemo(
        () => buildTranscriptRows({
            transcripts,
            summaries: transcriptSummaries,
            fca: fcaReadiness,
            selection: transcriptSelection,
        }),
        [transcripts, transcriptSummaries, fcaReadiness, transcriptSelection]
    )

    // Included transcripts that have neither an FCA summary nor a clinician override. The worker
    // defers report generation while this is non-empty, so the builder warns instead of queueing
    // into a silent wait.
    const missingEvidenceRows = useMemo(
        () => findTranscriptsMissingEvidence(transcriptRows),
        [transcriptRows]
    )

    const includedTranscriptCount = useMemo(
        () => transcriptRows.filter((row) => row.included).length,
        [transcriptRows]
    )

    // Summary work already underway. It can be in flight without this session asking for it (a
    // previous visit, or the queue-time defer), so it drives polling on its own.
    const summariesInFlight = useMemo(
        () => transcriptRows.some((row) => row.summaryStatus === 'queued' || row.summaryStatus === 'processing'),
        [transcriptRows]
    )

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            setFormData(buildInitialFormData(patientName, initialFormData))
            setCurrentStep(0)
        }, 0)
        return () => window.clearTimeout(timeoutId)
    }, [patientName, initialFormData])

    // The Notes entity endpoint enforces the admin Bearer token (unlike the patient/analysis
    // reads, which answer unauthenticated), so admin-scoped calls share this helper.
    const getAttachmentRequestHeaders = useCallback(async () => {
        const token = await getOrCreateAdminTokenForLocalhost()
        return token ? { Authorization: `Bearer ${token}` } : {}
    }, [])

    // Load patient notes if patientId is available
    useEffect(() => {
        if (!patientId) {
            const timeoutId = window.setTimeout(() => {
                setLoading(false)
                setTranscriptSummaryError('')
            }, 0)
            return () => window.clearTimeout(timeoutId)
        }

        // Step 7 ("Goals & Objectives") is populated from the participant's
        // intake response to "What are their NDIS Goals?". The goals belong to the
        // participant, so nothing here is derived from the clinical notes; anything
        // already typed by the clinician (or restored from a draft) is kept.
        const applyIntakeGoals = (patient) => {
            const goals = extractIntakeGoals(patient)
            if (goals.length === 0) return

            setIntakeGoals(goals)
            setFormData((prev) => {
                // Unticking the stored goals on the Participant Details panel is a real opt-out.
                const selection = normalizeParticipantSourceSelection(prev?.participantSources)
                if (!isParticipantSourceIncluded(selection, 'ndis_goals')) return prev

                const existing = (Array.isArray(prev?.goals) ? prev.goals : [])
                    .map((goal) => String(goal || '').trim())
                if (existing.some((goal) => goal !== '')) return prev

                return { ...prev, goals: padGoalsForEditing(goals) }
            })
        }

        const loadPatientNotes = async () => {
            try {
                // An existing draft renders immediately: its note-driven suggestions arrive
                // afterwards and only fill the fields the draft left empty.
                if (hasInitialFormData) {
                    setLoading(false)
                }

                const notesHeaders = await getAttachmentRequestHeaders()
                const [patientResponse, analysisResponse, summaryResponse, notesResponse, appointmentsResponse] = await Promise.all([
                    fetch(`/api/database/patients/${patientId}?domain=${encodeURIComponent(queueDomain)}`, { headers: notesHeaders }),
                    fetch(`/api/database/patients/analysis?domain=${encodeURIComponent(queueDomain)}&patient_id=${patientId}`, { headers: notesHeaders }),
                    fetch(`/api/database/patients/scribe-summary?domain=${encodeURIComponent(queueDomain)}&patient_id=${patientId}`, { headers: notesHeaders }),
                    // The note bodies come from the Notes entity - the patient record
                    // no longer carries a denormalised copy of them. This call needs the
                    // Bearer token: without it the request 401s and every note-derived
                    // suggestion (concerns, goals, background) silently disappears.
                    fetch(`/api/database/notes?domain=${encodeURIComponent(queueDomain)}&patient_id=${patientId}&compact=text&limit=200`, {
                        cache: 'no-store',
                        headers: notesHeaders,
                    }),
                    fetch(`/api/database/appointments?domain=${encodeURIComponent(queueDomain)}&patient_id=${encodeURIComponent(patientId)}&limit=200`, {
                        cache: 'no-store',
                        headers: notesHeaders,
                    }),
                ])

                let patientData = null
                let notes = ''
                let analysisPayload = null
                let latestSummary = null

                if (appointmentsResponse.ok) {
                    const appointmentsData = await appointmentsResponse.json().catch(() => ({}))
                    const loadedAppointments = Array.isArray(appointmentsData?.data) ? appointmentsData.data : []
                    setFormData((prev) => ({
                        ...prev,
                        appointmentHistory: formatAppointmentHistory(loadedAppointments),
                    }))
                }

                if (patientResponse.ok) {
                    patientData = await patientResponse.json()
                }

                if (notesResponse.ok) {
                    const notesData = await notesResponse.json().catch(() => ({}))
                    notes = joinNoteText(notesData?.data)
                } else {
                    // An empty note set looks identical to a failed fetch in the UI, so say why.
                    console.warn('Unable to load participant notes for FCA suggestions:', notesResponse.status)
                }

                if (analysisResponse.ok) {
                    const analysisData = await analysisResponse.json()
                    const patientAnalysis = analysisData?.analysis && typeof analysisData.analysis === 'object'
                        ? analysisData.analysis
                        : null
                    const firstAnalysis = Array.isArray(analysisData?.data) && analysisData.data.length > 0
                        ? analysisData.data[0]
                        : null
                    const resolvedAnalysis = patientAnalysis || firstAnalysis
                    analysisPayload = resolvedAnalysis?.analysisPayload || resolvedAnalysis?.analysis_payload || null
                }

                if (summaryResponse.ok) {
                    const summaryData = await summaryResponse.json().catch(() => ({}))
                    latestSummary = summaryData?.summary && typeof summaryData.summary === 'object'
                        ? summaryData.summary
                        : null
                    setTranscriptSummaryError('')
                    const latestSummaryText = String(latestSummary?.summaryText || '').trim()
                    if (latestSummaryText) {
                        setFormData((prev) => {
                            const current = String(prev?.transcriptSummaryReview || '').trim()
                            if (current) return prev
                            return {
                                ...prev,
                                transcriptSummaryReview: latestSummaryText,
                            }
                        })
                    }
                } else {
                    setTranscriptSummaryError('Transcript summary is not available yet.')
                }

                const participantData = extractParticipantFormData(patientData?.patient)

                // Every stored participant answer the builder knows how to use. The rows drive the
                // per-step "stored participant data" panels and the prefill below; identity rows are
                // reference-only and never reach the model.
                const sourceRows = buildParticipantSources(patientData?.patient)
                setParticipantSourceRows(sourceRows)

                // Field values implied by the stored answers, in the order the clinician left them:
                // an excluded source contributes nothing, and an edited source contributes its edit.
                const storedFieldPrefillFor = (previous) => {
                    const selection = normalizeParticipantSourceSelection(previous?.participantSources)
                    const prefill = {}
                    for (const row of sourceRows) {
                        if (!row.field) continue
                        if (!isParticipantSourceIncluded(selection, row.id)) continue
                        const text = resolveParticipantSourceText(row, selection)
                        if (text) prefill[row.field] = text
                    }
                    return prefill
                }

                if (notes) {
                    setPatientNotes(notes)
                    const extracted = extractNotesData(notes)

                    setFormData((prev) => {
                        const prefill = storedFieldPrefillFor(prev)
                        if (!participantData.participantName && !participantData.ndisNumber && !participantData.dateOfBirth
                            && !participantData.address && !participantData.planNominee && !participantData.planManager
                            && Object.keys(prefill).length === 0) {
                            return prev
                        }
                        return {
                            ...prev,
                            participantName: participantData.participantName || prev.participantName,
                            ndisNumber: participantData.ndisNumber || prev.ndisNumber,
                            dateOfBirth: participantData.dateOfBirth || prev.dateOfBirth,
                            address: participantData.address || prev.address,
                            planNominee: participantData.planNominee || prev.planNominee,
                            planManager: participantData.planManager || prev.planManager,
                            fundingSource: prefill.fundingSource || prev.fundingSource,
                            supportCoordinator: prefill.supportCoordinator || prev.supportCoordinator,
                            interpreterRequired: prefill.interpreterRequired || prev.interpreterRequired,
                            accidentDate: prefill.accidentDate || prev.accidentDate,
                            referrerRelationship: prefill.referrerRelationship || prev.referrerRelationship,
                        }
                    })

                    // Pre-fill diagnosis and background. The stored intake answers outrank the
                    // note-derived guesses: the referral reason is what the referrer asked for,
                    // and the diagnosis note is typed by hand at intake.
                    setFormData((prev) => {
                        const prefill = storedFieldPrefillFor(prev)
                        const nextDiagnosis = prefill.diagnosisSummary || extracted.diagnosis || prev.diagnosisSummary
                        const nextBackground = prefill.backgroundSummary || extracted.backgroundSummary || prev.backgroundSummary
                        if (nextDiagnosis === prev.diagnosisSummary && nextBackground === prev.backgroundSummary) {
                            return prev
                        }
                        return {
                            ...prev,
                            diagnosisSummary: nextDiagnosis,
                            backgroundSummary: nextBackground,
                        }
                    })
                } else if (participantData.participantName || participantData.ndisNumber || participantData.dateOfBirth || participantData.address || participantData.planNominee || participantData.planManager) {
                    setFormData((prev) => {
                        const prefill = storedFieldPrefillFor(prev)
                        return {
                            ...prev,
                            participantName: participantData.participantName || prev.participantName,
                            ndisNumber: participantData.ndisNumber || prev.ndisNumber,
                            dateOfBirth: participantData.dateOfBirth || prev.dateOfBirth,
                            address: participantData.address || prev.address,
                            planNominee: participantData.planNominee || prev.planNominee,
                            planManager: participantData.planManager || prev.planManager,
                            fundingSource: prefill.fundingSource || prev.fundingSource,
                            supportCoordinator: prefill.supportCoordinator || prev.supportCoordinator,
                            interpreterRequired: prefill.interpreterRequired || prev.interpreterRequired,
                            accidentDate: prefill.accidentDate || prev.accidentDate,
                            referrerRelationship: prefill.referrerRelationship || prev.referrerRelationship,
                            backgroundSummary: prefill.backgroundSummary || prev.backgroundSummary,
                            diagnosisSummary: prefill.diagnosisSummary || prev.diagnosisSummary,
                        }
                    })
                } else {
                    // No notes to mine, but the stored answers still belong on the earlier steps.
                    setFormData((prev) => {
                        const prefill = storedFieldPrefillFor(prev)
                        if (Object.keys(prefill).length === 0) return prev
                        return { ...prev, ...prefill }
                    })
                }

                // The participant's own intake answers are the only source of Step 7 goals.
                applyIntakeGoals(patientData?.patient)

                // The FCA Analyst records interventions in two categories: `addressedInterventions`
                // (supports already in place) and `recommendedInterventions` (new/increased
                // supports). Clinical notes contribute the same split via their own headings
                // (`extractNotesData().currentInterventions` / `.recommendedInterventions`); the
                // undifferentiated `interventions` keyword pass is only used as a last-resort
                // recommendation source for notes that have neither heading.
                const analysisRecommendedSuggestions = extractInterventionRecommendationsFromAnalysisPayload(analysisPayload)
                const analysisAddressedSuggestions = extractAddressedInterventionsFromAnalysisPayload(analysisPayload)
                setAnalysisInterventionSuggestions(analysisRecommendedSuggestions)
                setAnalysisAddressedInterventionSuggestions(analysisAddressedSuggestions)

                const hasStructuredAnalysisRecommendations = Array.isArray(analysisPayload?.recommendedInterventions)
                    && analysisPayload.recommendedInterventions.length > 0
                const hasStructuredAnalysisAddressed = Array.isArray(analysisPayload?.addressedInterventions)
                    && analysisPayload.addressedInterventions.length > 0

                const notesExtracted = notes ? extractNotesData(notes) : null

                // Step 4 "Current Concerns": the FCA Analyst's evidence is the curated,
                // function-relevant subset of the notes, so its concerns lead and the raw keyword
                // scrape follows as coverage. This mirrors how the intervention steps treat the
                // analyst's `recommendedInterventions`/`addressedInterventions`.
                const analysisConcernSuggestions = extractConcernsFromAnalysisPayload(analysisPayload)
                const mergedConcernSuggestions = mergeConcernSuggestions(
                    notesExtracted?.concerns || [],
                    analysisConcernSuggestions
                )
                if (mergedConcernSuggestions.length > 0) {
                    setSuggestedConcerns(mergedConcernSuggestions)
                    setFormData((prev) => ({
                        ...prev,
                        concerns: buildConcernPrefill(prev.concerns, mergedConcernSuggestions),
                    }))
                }

                const noteAddressedInterventions = notesExtracted?.currentInterventions || []
                const noteRecommendedInterventions = notesExtracted?.recommendedInterventions || []
                const noteUndifferentiatedInterventions = (noteAddressedInterventions.length === 0 && noteRecommendedInterventions.length === 0)
                    ? (notesExtracted?.interventions || [])
                    : []

                const mergedRecommended = mergeInterventionSuggestions(
                    [...noteRecommendedInterventions, ...noteUndifferentiatedInterventions],
                    analysisRecommendedSuggestions
                )
                const mergedAddressed = mergeInterventionSuggestions(noteAddressedInterventions, analysisAddressedSuggestions)

                const preferredRecommended = hasStructuredAnalysisRecommendations && analysisRecommendedSuggestions.length > 0
                    ? analysisRecommendedSuggestions.map((item) => item.intervention)
                    : mergedRecommended
                const preferredAddressed = hasStructuredAnalysisAddressed && analysisAddressedSuggestions.length > 0
                    ? analysisAddressedSuggestions.map((item) => item.intervention)
                    : mergedAddressed

                if (preferredRecommended.length > 0) {
                    setSuggestedInterventions(preferredRecommended)
                    setFormData((prev) => ({
                        ...prev,
                        recommendedInterventions: buildInterventionPrefill(prev.recommendedInterventions, preferredRecommended),
                    }))
                }

                if (preferredAddressed.length > 0) {
                    setSuggestedAddressedInterventions(preferredAddressed)
                    setFormData((prev) => ({
                        ...prev,
                        currentInterventions: buildInterventionPrefill(prev.currentInterventions, preferredAddressed),
                    }))
                }
            } catch (error) {
                console.warn('Error loading patient notes:', error.message)
                setTranscriptSummaryError('Failed to load transcript summary for review.')
            } finally {
                setLoading(false)
            }
        }

        loadPatientNotes()
    }, [getAttachmentRequestHeaders, hasInitialFormData, patientId, queueDomain])

    const handleInputChange = useCallback((field, value) => {
        setFormData((prev) => ({ ...prev, [field]: value }))
    }, [])

    const handleArrayChange = useCallback((field, index, value) => {
        setFormData((prev) => ({
            ...prev,
            [field]: prev[field].map((item, i) => (i === index ? value : item)),
        }))
    }, [])

    const handleAddArrayItem = useCallback((field) => {
        setFormData((prev) => ({
            ...prev,
            [field]: [...prev[field], ''],
        }))
    }, [])

    const handleToggleSuggestion = useCallback((field, suggestion) => {
        setFormData((prev) => {
            const fieldArray = prev[field] || []
            const isSelected = fieldArray.includes(suggestion)

            if (isSelected) {
                // Remove the suggestion
                return {
                    ...prev,
                    [field]: fieldArray.filter((item) => item !== suggestion),
                }
            } else {
                // Add the suggestion (replace first empty slot or append)
                const emptyIndex = fieldArray.findIndex((item) => !item || item.trim() === '')
                if (emptyIndex !== -1) {
                    return {
                        ...prev,
                        [field]: fieldArray.map((item, i) => (i === emptyIndex ? suggestion : item)),
                    }
                } else {
                    return {
                        ...prev,
                        [field]: [...fieldArray, suggestion],
                    }
                }
            }
        })
    }, [])

    const loadPatientFiles = useCallback(async () => {
        if (!patientId) {
            setPatientFiles([])
            setPatientFilesLoadedFor('')
            return
        }

        setPatientFilesLoading(true)
        setAttachmentsError('')
        try {
            const headers = await getAttachmentRequestHeaders()
            const query = new URLSearchParams({ domain: queueDomain, patient_id: String(patientId) })
            const response = await fetch(`/api/database/patient-files?${query.toString()}`, { cache: 'no-store', headers })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data?.error || 'Failed to load reference files')
            setPatientFiles(Array.isArray(data?.data) ? data.data : [])
        } catch (error) {
            setPatientFiles([])
            setAttachmentsError(error?.message || 'Failed to load reference files')
        } finally {
            setPatientFilesLoading(false)
            setPatientFilesLoadedFor(String(patientId))
        }
    }, [getAttachmentRequestHeaders, patientId, queueDomain])

    const fetchAttachmentText = useCallback(async (fileId) => {
        const headers = await getAttachmentRequestHeaders()
        const response = await fetch(
            `/api/database/patient-files/${encodeURIComponent(fileId)}/text?domain=${encodeURIComponent(queueDomain)}`,
            { cache: 'no-store', headers }
        )
        const data = await response.json().catch(() => ({}))

        if (!response.ok) {
            const error = new Error(data?.error || 'Failed to read the file contents')
            // A readable-text failure is not a reason to drop the attachment: the
            // file is still attached by name.
            error.unreadable = data?.unsupported === true
            throw error
        }

        return String(data?.data?.text || '').trim()
    }, [getAttachmentRequestHeaders, queueDomain])

    const storeAttachment = useCallback((entry, text) => {
        setFormData((prev) => {
            const files = [...normalizeAttachmentFiles(prev.attachmentFiles), entry]
            const texts = parseAttachmentContext(prev.attachmentContext)
            if (text) texts.set(entry.id, text)

            return {
                ...prev,
                attachmentFiles: normalizeAttachmentFiles(files),
                attachmentContext: serializeAttachmentContext(files, texts),
            }
        })
    }, [])

    const handleToggleAttachment = useCallback(async (record) => {
        const entry = toAttachmentEntry(record)
        if (!entry) return

        const isAttached = normalizeAttachmentFiles(formData.attachmentFiles).some((file) => file.id === entry.id)

        if (isAttached) {
            setFormData((prev) => {
                const files = normalizeAttachmentFiles(prev.attachmentFiles).filter((file) => file.id !== entry.id)
                const texts = parseAttachmentContext(prev.attachmentContext)
                texts.delete(entry.id)

                return {
                    ...prev,
                    attachmentFiles: files,
                    attachmentContext: serializeAttachmentContext(files, texts),
                }
            })
            setAttachmentPreviewId((current) => (current === entry.id ? '' : current))
            return
        }

        setAttachmentBusyId(entry.id)
        setAttachmentsError('')
        setAttachmentsNotice('')

        let text = ''
        let notice = ''
        try {
            text = await fetchAttachmentText(entry.id)
        } catch (error) {
            if (!error?.unreadable) {
                setAttachmentsError(error?.message || `Failed to read ${entry.fileName}`)
                setAttachmentBusyId('')
                return
            }
            notice = `${entry.fileName} cannot be read as text, so it is attached as a named reference only.`
        }

        storeAttachment(entry, text)
        if (notice) setAttachmentsNotice(notice)
        setAttachmentBusyId('')
    }, [fetchAttachmentText, formData.attachmentFiles, storeAttachment])

    const handleUploadAttachments = useCallback(async (fileList) => {
        const files = Array.from(fileList || []).filter(Boolean)
        if (files.length === 0) return

        if (!patientId) {
            setAttachmentsError('Uploads are stored against the participant, so this report needs a saved participant first.')
            return
        }

        setAttachmentUploading(true)
        setAttachmentsError('')
        setAttachmentsNotice('')

        const uploaded = []
        let failure = ''
        try {
            const headers = await getAttachmentRequestHeaders()
            for (const file of files) {
                const body = new FormData()
                body.set('domain', queueDomain)
                body.set('patient_id', String(patientId))
                body.set('file', file)

                const response = await fetch('/api/database/patient-files', { method: 'POST', headers, body })
                const data = await response.json().catch(() => ({}))
                if (!response.ok) throw new Error(data?.error || `Failed to upload ${file.name}`)

                const entry = toAttachmentEntry(data?.file)
                if (entry) uploaded.push(entry)
            }
        } catch (error) {
            failure = error?.message || 'Failed to upload file'
        } finally {
            setAttachmentUploading(false)
        }

        if (uploaded.length > 0) {
            setPatientFiles((prev) => [
                ...uploaded.map((entry) => ({
                    id: entry.id,
                    file_name: entry.fileName,
                    mime_type: entry.mimeType,
                    file_size: entry.fileSize,
                    created_at: entry.createdAt,
                })),
                ...(Array.isArray(prev) ? prev : []),
            ])
        }

        for (const entry of uploaded) {
            await handleToggleAttachment(entry)
        }

        if (uploaded.length > 0) {
            setAttachmentsNotice(`${uploaded.length} file${uploaded.length === 1 ? '' : 's'} uploaded to the participant's file store and added to the report context.`)
        }
        if (failure) setAttachmentsError(failure)
    }, [getAttachmentRequestHeaders, handleToggleAttachment, patientId, queueDomain])

    const loadTranscriptStep = useCallback(async ({ includeTranscripts = false } = {}) => {
        if (!patientId) return null

        setTranscriptStepError('')
        try {
            const headers = await getAttachmentRequestHeaders()
            const query = new URLSearchParams({ domain: queueDomain, patient_id: String(patientId) })

            const summaryResponse = await fetch(
                `/api/database/patients/scribe-summary?${query.toString()}`,
                { cache: 'no-store', headers }
            )
            const summaryData = await summaryResponse.json().catch(() => ({}))
            if (!summaryResponse.ok) throw new Error(summaryData?.error || 'Failed to load transcript summaries')

            setTranscriptSummaries(Array.isArray(summaryData?.summaries) ? summaryData.summaries : [])
            const readiness = summaryData?.fca && typeof summaryData.fca === 'object' ? summaryData.fca : null
            setFcaReadiness(readiness)

            const nextSummaries = Array.isArray(summaryData?.summaries) ? summaryData.summaries : []
            let nextTranscripts = null
            if (includeTranscripts) {
                const listQuery = new URLSearchParams({
                    domain: queueDomain,
                    patient_id: String(patientId),
                    compact: '1',
                    limit: '50',
                })
                const listResponse = await fetch(
                    `/api/database/patient-transcriptions?${listQuery.toString()}`,
                    { cache: 'no-store', headers }
                )
                const listData = await listResponse.json().catch(() => ({}))
                if (!listResponse.ok) throw new Error(listData?.error || 'Failed to load transcripts')
                nextTranscripts = Array.isArray(listData?.data) ? listData.data : []
                setTranscripts(nextTranscripts)
            }

            // Nothing outstanding means the preparation poll can stop.
            if (Number(readiness?.pendingCount || 0) === 0) {
                setPreparingSummaries(false)
            }

            return { readiness, summaries: nextSummaries, transcripts: nextTranscripts }
        } catch (error) {
            setTranscriptStepError(error?.message || 'Failed to load transcript summaries')
            return null
        } finally {
            setTranscriptStepLoading(false)
            setTranscriptStepLoadedFor(String(patientId))
        }
    }, [getAttachmentRequestHeaders, patientId, queueDomain])

    const requestSummaryPreparation = useCallback(async () => {
        if (!patientId) return null

        try {
            const headers = await getAttachmentRequestHeaders()
            const response = await fetch('/api/database/patients/scribe-summary', {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ domain: queueDomain, patient_id: patientId }),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data?.error || 'Failed to prepare FCA summaries')

            if (data?.fca) setFcaReadiness(data.fca)

            if (data?.scribeEnabled === false) {
                setPreparingSummaries(false)
                setPrepareTone('error')
                setPrepareMessage('The Scribe agent is switched off for this participant, so FCA summaries cannot be generated automatically. Turn it on in the participant\u2019s agent settings, or write the summaries yourself below.')
                return data
            }

            return data
        } catch (error) {
            setPreparingSummaries(false)
            setPrepareTone('error')
            setPrepareMessage(error?.message || 'Failed to prepare FCA summaries')
            return null
        }
    }, [getAttachmentRequestHeaders, patientId, queueDomain])

    const handlePrepareTranscriptSummaries = useCallback(async () => {
        if (!patientId || preparingSummaries) return

        setPreparingSummaries(true)
        setPrepareTone('info')
        setPrepareMessage('Requesting FCA summaries\u2026')

        const data = await requestSummaryPreparation()
        if (!data || data.scribeEnabled === false) return

        const queuedCount = Number(data?.queuedCount || 0)
        setPrepareMessage(queuedCount > 0
            ? `Queued ${queuedCount} transcript summar${queuedCount === 1 ? 'y' : 'ies'}. Most take under ${QUEUE_SUMMARY_WAIT_SECONDS} seconds.`
            : 'All FCA summaries are already up to date.')

        if (queuedCount === 0 && Number(data?.fca?.pendingCount || 0) === 0) {
            setPreparingSummaries(false)
        }
    }, [patientId, preparingSummaries, requestSummaryPreparation])

    const handleToggleTranscriptIncluded = useCallback((id, included) => {
        setFormData((prev) => ({
            ...prev,
            transcriptSelection: setTranscriptIncluded(prev.transcriptSelection, id, included),
        }))
    }, [])

    const handleToggleAllTranscripts = useCallback((included) => {
        setFormData((prev) => ({
            ...prev,
            transcriptSelection: setTranscriptsIncluded(
                prev.transcriptSelection,
                transcripts.map((item) => item?.id),
                included
            ),
        }))
    }, [transcripts])

    const handleTranscriptSummaryChange = useCallback((id, text) => {
        setFormData((prev) => ({
            ...prev,
            transcriptSelection: setTranscriptSummaryOverride(prev.transcriptSelection, id, text),
        }))
    }, [])

    const handleResetTranscriptSummary = useCallback((id) => {
        setFormData((prev) => ({
            ...prev,
            transcriptSelection: setTranscriptSummaryOverride(prev.transcriptSelection, id, ''),
        }))
    }, [])

    // Step 8 ("Report Focus & Attachments") lists the participant's stored
    // files, so the list is fetched the first time that step is opened.
    useEffect(() => {
        if (currentStep !== 7 || patientFilesLoadedFor === String(patientId || '')) return

        const timeoutId = window.setTimeout(() => {
            loadPatientFiles()
        }, 0)

        return () => window.clearTimeout(timeoutId)
    }, [currentStep, loadPatientFiles, patientFilesLoadedFor, patientId])

    // Step 9 ("Transcripts & Summaries") lists the participant's stored transcripts, so both the
    // transcript list and the FCA summary state are fetched the first time that step is opened.
    useEffect(() => {
        if (currentStep !== 8 || transcriptStepLoadedFor === String(patientId || '')) return

        const timeoutId = window.setTimeout(() => {
            setTranscriptStepLoading(true)
            loadTranscriptStep({ includeTranscripts: true })
        }, 0)

        return () => window.clearTimeout(timeoutId)
    }, [currentStep, loadTranscriptStep, transcriptStepLoadedFor, patientId])

    // While summaries are being prepared, keep the status fresh so the clinician watches them land
    // rather than guessing whether the request did anything. This is not scoped to the transcript
    // step because the report can also be queued from Review.
    useEffect(() => {
        if (!preparingSummaries && !summariesInFlight) return
        if (!patientId) return

        const intervalId = window.setInterval(() => {
            loadTranscriptStep()
        }, SUMMARY_POLL_INTERVAL_MS)

        return () => window.clearInterval(intervalId)
    }, [loadTranscriptStep, patientId, preparingSummaries, summariesInFlight])

    const queuePreparationActive = Boolean(queuePreparation)

    // The wait is a courtesy, not a gate: once every included transcript has evidence we queue
    // automatically, and the clinician can also queue early from the dialog.
    useEffect(() => {
        if (!queuePreparationActive) return
        if (missingEvidenceRows.length > 0) return

        const timeoutId = window.setTimeout(() => {
            setQueuePreparation(null)
            setPreparingSummaries(false)
            proceedWithQueueRef.current?.()
        }, 0)

        return () => window.clearTimeout(timeoutId)
    }, [missingEvidenceRows.length, queuePreparationActive])

    useEffect(() => {
        if (!queuePreparationActive) return

        const intervalId = window.setInterval(() => {
            setQueuePreparation((prev) => {
                if (!prev) return prev
                const elapsedSeconds = Math.floor((Date.now() - prev.startedAt) / 1000)
                return { ...prev, elapsedSeconds, timedOut: elapsedSeconds >= QUEUE_SUMMARY_WAIT_SECONDS }
            })
        }, 1000)

        return () => window.clearInterval(intervalId)
    }, [queuePreparationActive])

    const analysisInterventionJustificationMap = useMemo(() => {
        const map = new Map()
        for (const suggestion of analysisInterventionSuggestions) {
            const label = String(suggestion?.intervention || '').trim()
            const justification = String(suggestion?.justification || '').trim()
            if (!label || !justification) continue
            map.set(label.toLowerCase(), justification)
        }
        return map
    }, [analysisInterventionSuggestions])

    const analysisAddressedInterventionJustificationMap = useMemo(() => {
        const map = new Map()
        for (const suggestion of analysisAddressedInterventionSuggestions) {
            const label = String(suggestion?.intervention || '').trim()
            const justification = String(suggestion?.justification || '').trim()
            if (!label || !justification) continue
            map.set(label.toLowerCase(), justification)
        }
        return map
    }, [analysisAddressedInterventionSuggestions])

    const queuePreviewPayload = useMemo(() => {
        const contextSource = queueContext && typeof queueContext === 'object' && !Array.isArray(queueContext)
            ? queueContext
            : {}
        const options = contextSource.options && typeof contextSource.options === 'object' && !Array.isArray(contextSource.options)
            ? contextSource.options
            : {}
        const promptMode = resolveFcaPromptMode(options)
        return {
            domain: String(contextSource.domain || '').trim() || '(resolved at queue time)',
            patientId: String(patientId || '').trim() || null,
            patientName: String(patientName || '').trim() || null,
            reportType: String(contextSource.reportType || 'ndis-functional-capacity-assessment').trim(),
            additionalContext: String(contextSource.additionalContext || '').trim(),
            options,
            builderState: {
                ndisFca: {
                    formData,
                    markdownPreviewLength: generateMarkdownReport(formData).length,
                },
            },
            backendPromptPreview: {
                worker: 'two/src/lib/jobs/fcaReportGeneration.js',
                mode: promptMode.mode,
                modeReason: promptMode.reason,
                systemPromptTemplate: FCA_OPENAI_SYSTEM_PROMPT_TEMPLATE,
                userPromptTemplate: FCA_OPENAI_USER_PROMPT_TEMPLATE,
                referenceGuidance: buildFcaReferenceSourceMetadata(),
                sectionPlan: buildFcaSectionPlan(formData.reportStyle),
                reportStyle: resolveFcaReportStyle(formData.reportStyle),
                note: 'The worker labels the broad evidence input source, keeps identifying details out of model input, and restores known names locally in the finished draft. Attribution to a person or direct observation, support hours, and measure scores still require explicit source evidence.',
                referenceNote: 'Reference guidance is compiled by the worker from the NDIS sources listed above (two/src/lib/jobs/fcaReferenceGuidance.js) and appended to every section prompt as framing only, never as participant evidence.',
            },
        }
    }, [formData, patientId, patientName, queueContext])

    const queueSummary = useMemo(() => buildFcaQueueSummary({
        patientName,
        formData,
        sectionPlan: buildFcaSectionPlan(formData.reportStyle),
        transcriptSummary: {
            totalCount: transcriptRows.length,
            includedCount: includedTranscriptCount,
            editedCount: transcriptRows.filter((row) => row.isEdited).length,
            pendingEvidenceCount: missingEvidenceRows.length,
        },
        fileCount: attachmentFiles.length,
    }), [attachmentFiles.length, formData, includedTranscriptCount, missingEvidenceRows.length, patientName, transcriptRows])

    const handleNextStep = useCallback(async () => {
        if (savingDraft) return
        if (currentStep < STEPS.length - 1) {
            // Auto-save before moving to next step
            if (onSaveDraft) {
                const markdown = generateMarkdownReport(formData)
                try {
                    setSavingDraft(true)
                    await onSaveDraft(markdown, formData)
                } finally {
                    setSavingDraft(false)
                }
            }
            setCurrentStep(currentStep + 1)
        }
    }, [currentStep, formData, onSaveDraft, savingDraft])

    const handlePrevStep = useCallback(async () => {
        if (savingDraft) return
        if (currentStep > 0) {
            // Auto-save before moving to previous step
            if (onSaveDraft) {
                const markdown = generateMarkdownReport(formData)
                try {
                    setSavingDraft(true)
                    await onSaveDraft(markdown, formData)
                } finally {
                    setSavingDraft(false)
                }
            }
            setCurrentStep(currentStep - 1)
        }
    }, [currentStep, formData, onSaveDraft, savingDraft])

    const proceedWithQueue = useCallback(async () => {
        if (savingDraft) return
        const markdown = generateMarkdownReport(formData)
        // The identity block travels with the queued job only (drafts keep the plain form data):
        // the worker strips identifiers before model input, then restores known names locally in
        // the composed report. The model never receives these identifying values.
        const queueFormData = {
            ...formData,
            participantIdentity: buildParticipantIdentityBlock(
                participantSourceRows,
                { patient_name: formData.participantName },
                formData.participantSources
            ),
        }
        try {
            setSavingDraft(true)
            await onSave(markdown, queueFormData)
        } finally {
            setSavingDraft(false)
        }
        onClose()
    }, [formData, onSave, onClose, savingDraft, participantSourceRows])

    useEffect(() => {
        proceedWithQueueRef.current = proceedWithQueue
    }, [proceedWithQueue])

    // The FCA worker will not generate a report while an included transcript has no FCA summary, so
    // the builder waits here and shows progress instead of queueing into an unexplained defer.
    const handleSaveAndClose = useCallback(async () => {
        if (savingDraft || queuePreparation) return

        // Readiness depends on the transcript list, which is normally loaded when the transcript
        // step opens. Queueing straight from Review must not skip the check, so load it first.
        let rows = transcriptRows
        if (patientId && transcriptStepLoadedFor !== String(patientId)) {
            const loaded = await loadTranscriptStep({ includeTranscripts: true })
            if (loaded) {
                rows = buildTranscriptRows({
                    transcripts: loaded.transcripts || [],
                    summaries: loaded.summaries || [],
                    fca: loaded.readiness,
                    selection: transcriptSelection,
                })
            }
        }

        const missing = findTranscriptsMissingEvidence(rows)
        if (missing.length === 0) {
            await proceedWithQueue()
            return
        }

        setQueuePreparation({ startedAt: Date.now(), elapsedSeconds: 0, timedOut: false, initialMissing: missing.length })
        setPreparingSummaries(true)
        setPrepareTone('info')
        setPrepareMessage(`Preparing ${missing.length} FCA transcript summar${missing.length === 1 ? 'y' : 'ies'}\u2026`)
        await requestSummaryPreparation()
        await loadTranscriptStep()
    }, [
        loadTranscriptStep,
        patientId,
        proceedWithQueue,
        queuePreparation,
        requestSummaryPreparation,
        savingDraft,
        transcriptRows,
        transcriptSelection,
        transcriptStepLoadedFor,
    ])

    const handleCloseWithSave = useCallback(async () => {
        if (savingDraft) return

        if (onSaveDraft) {
            const markdown = generateMarkdownReport(formData)
            try {
                setSavingDraft(true)
                await onSaveDraft(markdown, formData)
            } finally {
                setSavingDraft(false)
            }
        }

        onClose()
    }, [formData, onClose, onSaveDraft, savingDraft])

    const isLastStep = currentStep === STEPS.length - 1

    useEffect(() => {
        if (!isLastStep) {
            const timeoutId = window.setTimeout(() => {
                setShowQueueActionsMenu(false)
            }, 0)
            return () => window.clearTimeout(timeoutId)
        }
    }, [isLastStep])

    if (loading) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-blue-50 to-teal-50">
                <div className="text-center">
                    <div className="inline-flex h-12 w-12 animate-spin rounded-full border-4 border-gray-300 border-t-blue-500 mb-4" />
                    <p className="text-gray-600 font-medium">Loading patient data...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="w-full h-full flex flex-col bg-gradient-to-br from-blue-50 to-teal-50">
            {/* Header */}
            <div className="border-b border-gray-200 bg-white/80 backdrop-blur px-6 py-4 shadow-sm">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex-1">
                        <h1 className="text-2xl font-bold text-gray-900">{step.title}</h1>
                        <p className="mt-1 text-sm text-gray-600">Building NDIS-FCA for {patientName || 'the participant'}</p>
                        {patientNotes && (
                            <p className="mt-2 text-xs font-medium text-emerald-700 bg-emerald-50 inline-block px-2 py-1 rounded">
                                ✓ Loaded from clinical notes
                            </p>
                        )}
                    </div>
                    <button
                        onClick={handleCloseWithSave}
                        disabled={savingDraft}
                        className="text-gray-500 hover:text-gray-700 font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        ✕ Close
                    </button>
                </div>

                {/* Progress Bar */}
                <div className="mt-4 flex items-center gap-2">
                    <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-gradient-to-r from-blue-500 to-teal-500 transition-all duration-300"
                            style={{ width: `${((currentStep + 1) / STEPS.length) * 100}%` }}
                        />
                    </div>
                    <span className="text-xs font-medium text-gray-600 whitespace-nowrap">
                        Step {currentStep + 1} of {STEPS.length}
                    </span>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-auto">
                <div className="mx-auto max-w-2xl px-6 py-8">
                    {/* Tips for Kate */}
                    {currentStep === 0 && (
                        <div className="mb-8 rounded-lg border border-purple-200 bg-purple-50 px-4 py-3">
                            <p className="text-xs font-semibold text-purple-900 uppercase tracking-wide mb-2">💜 Tips for You</p>
                            <ul className="space-y-1 text-sm text-purple-800">
                                {ADHD_FRIENDLY_TIPS.map((tip, idx) => (
                                    <li key={idx}>{tip}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Step Content */}
                    {currentStep === 0 && (
                        <div className="space-y-6">
                            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                                <h2 className="text-lg font-semibold text-gray-900 mb-4">Welcome to the FCA Report Builder</h2>
                                <p className="text-gray-700 mb-4">
                                    This guided tool will help you build a comprehensive NDIS Functional Capacity Assessment report. We&apos;ll walk through each section step by step.
                                </p>
                                <div className="mt-6 p-4 bg-blue-50 rounded border border-blue-200">
                                    <p className="text-sm font-medium text-blue-900">What&apos;s included:</p>
                                    <ul className="mt-2 text-sm text-blue-800 space-y-1">
                                        <li>✓ Participant demographics</li>
                                        <li>✓ Background and history</li>
                                        <li>✓ Functional concerns and limitations</li>
                                        <li>✓ Diagnosis and medical context</li>
                                        <li>✓ Functional capacity assessment</li>
                                        <li>✓ Interventions and supports</li>
                                        <li>✓ Goals and objectives</li>
                                    </ul>
                                </div>
                            </div>

                            <FcaReferenceCard />
                        </div>
                    )}

                    {currentStep === 1 && (
                        <div className="space-y-6">
                            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Participant Name *
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.participantName}
                                        onChange={(e) => handleInputChange('participantName', e.target.value)}
                                        className="w-full px-4 py-2 rounded-md border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                        placeholder="First and Last Name"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">NDIS Number</label>
                                    <input
                                        type="text"
                                        value={formData.ndisNumber}
                                        onChange={(e) => handleInputChange('ndisNumber', e.target.value)}
                                        className="w-full px-4 py-2 rounded-md border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                        placeholder="e.g., 123456789"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">Date of Birth</label>
                                    <input
                                        type="date"
                                        value={formData.dateOfBirth}
                                        onChange={(e) => handleInputChange('dateOfBirth', e.target.value)}
                                        className="w-full px-4 py-2 rounded-md border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">Address</label>
                                    <input
                                        type="text"
                                        value={formData.address}
                                        onChange={(e) => handleInputChange('address', e.target.value)}
                                        className="w-full px-4 py-2 rounded-md border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                        placeholder="Street address"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">Plan Nominee</label>
                                    <input
                                        type="text"
                                        value={formData.planNominee}
                                        onChange={(e) => handleInputChange('planNominee', e.target.value)}
                                        className="w-full px-4 py-2 rounded-md border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                        placeholder="Name and contact email"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">Plan Manager</label>
                                    <input
                                        type="text"
                                        value={formData.planManager}
                                        onChange={(e) => handleInputChange('planManager', e.target.value)}
                                        className="w-full px-4 py-2 rounded-md border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                        placeholder="Manager details"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">Funding Source</label>
                                    <input
                                        type="text"
                                        value={formData.fundingSource}
                                        onChange={(e) => handleInputChange('fundingSource', e.target.value)}
                                        className="w-full px-4 py-2 rounded-md border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                        placeholder="e.g., NDIS"
                                    />
                                </div>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Support Coordinator</label>
                                        <input
                                            type="text"
                                            value={formData.supportCoordinator}
                                            onChange={(e) => handleInputChange('supportCoordinator', e.target.value)}
                                            className="w-full px-4 py-2 rounded-md border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                            placeholder="e.g., Yes / No"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Interpreter Required</label>
                                        <input
                                            type="text"
                                            value={formData.interpreterRequired}
                                            onChange={(e) => handleInputChange('interpreterRequired', e.target.value)}
                                            className="w-full px-4 py-2 rounded-md border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                            placeholder="e.g., No"
                                        />
                                    </div>
                                </div>
                                <p className="text-xs text-gray-500">
                                    Name, NDIS number, date of birth, address and contact details are stored on the
                                    report but are never sent to the AI. Everything else on this step is context the
                                    worker may use.
                                </p>
                            </div>

                            <ParticipantSourcesPanel
                                rows={participantSourceRowsForStep(2)}
                                selection={formData.participantSources}
                                onToggle={handleParticipantSourceToggle}
                            />
                        </div>
                    )}

                    {currentStep === 2 && (
                        <div className="space-y-6">
                            <ParticipantSourcesPanel
                                rows={participantSourceRowsForStep(3)}
                                selection={formData.participantSources}
                                onToggle={handleParticipantSourceToggle}
                            />
                            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Background Summary
                                </label>
                                <textarea
                                    value={formData.backgroundSummary}
                                    onChange={(e) => handleInputChange('backgroundSummary', e.target.value)}
                                    className="w-full px-4 py-3 rounded-md border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                                    rows={16}
                                    placeholder="Describe the participant&apos;s background, including relevant history, life context, and key life events that inform their current situation..."
                                />
                                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Accident Date</label>
                                        <input
                                            type="text"
                                            value={formData.accidentDate}
                                            onChange={(e) => handleInputChange('accidentDate', e.target.value)}
                                            className="w-full px-4 py-2 rounded-md border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                            placeholder="Only for TAC participants"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Referrer Relationship</label>
                                        <input
                                            type="text"
                                            value={formData.referrerRelationship}
                                            onChange={(e) => handleInputChange('referrerRelationship', e.target.value)}
                                            className="w-full px-4 py-2 rounded-md border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                            placeholder="e.g., Support Coordinator"
                                        />
                                    </div>
                                </div>
                                <p className="mt-2 text-xs text-gray-500">
                                    Tip: Focus on what&apos;s relevant to their functional capacity and NDIS support needs.
                                </p>
                            </div>
                        </div>
                    )}

                    {currentStep === 3 && (
                        <div className="space-y-6">
                            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                                <p className="text-sm text-gray-600 mb-4">
                                    Select or describe the participant&apos;s current functional concerns. You can add or remove items as needed.
                                </p>
                                {suggestedConcerns.length > 0 && (
                                    <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded">
                                        <p className="text-xs font-medium text-blue-900 mb-2">💡 Suggested concerns from the FCA Analyst and clinical notes (click to add):</p>
                                        <div className="flex flex-wrap gap-2">
                                            {suggestedConcerns.map((concern) => {
                                                const isSelected = formData.concerns.includes(concern)
                                                return (
                                                    <button
                                                        key={concern}
                                                        onClick={() => handleToggleSuggestion('concerns', concern)}
                                                        className={`text-xs px-2 py-1 rounded transition-colors ${isSelected
                                                            ? 'bg-blue-600 text-white font-medium'
                                                            : 'bg-blue-100 text-blue-800 hover:bg-blue-200'
                                                            }`}
                                                    >
                                                        {concern} {isSelected ? '✓' : ''}
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )}
                                <div className="space-y-3">
                                    {formData.concerns.map((concern, idx) => (
                                        <div key={idx} className="flex gap-2">
                                            <input
                                                type="text"
                                                value={concern}
                                                onChange={(e) => handleArrayChange('concerns', idx, e.target.value)}
                                                className="flex-1 px-4 py-2 rounded-md border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                                placeholder={suggestedConcerns[idx] || COMMON_CONCERNS[idx] || 'Enter a concern'}
                                                list={`concerns-list-${idx}`}
                                            />
                                            <datalist id={`concerns-list-${idx}`}>
                                                {[...new Set([...suggestedConcerns, ...COMMON_CONCERNS])].map((item) => (
                                                    <option key={item} value={item} />
                                                ))}
                                            </datalist>
                                        </div>
                                    ))}
                                </div>
                                <button
                                    onClick={() => handleAddArrayItem('concerns')}
                                    className="mt-4 text-sm font-medium text-blue-600 hover:text-blue-700"
                                >
                                    + Add another concern
                                </button>
                            </div>
                        </div>
                    )}

                    {currentStep === 4 && (
                        <div className="space-y-6">
                            <ParticipantSourcesPanel
                                rows={participantSourceRowsForStep(5)}
                                selection={formData.participantSources}
                                onToggle={handleParticipantSourceToggle}
                            />
                            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Diagnosis Summary
                                </label>
                                <textarea
                                    value={formData.diagnosisSummary}
                                    onChange={(e) => handleInputChange('diagnosisSummary', e.target.value)}
                                    className="w-full px-4 py-3 rounded-md border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                                    rows={16}
                                    placeholder="Describe the participant's diagnosis, medical history, and how their condition affects their daily functioning and NDIS support needs..."
                                />
                                <p className="mt-2 text-xs text-gray-500">
                                    Include relevant medical information that informs the FCA.
                                </p>
                            </div>
                        </div>
                    )}

                    {currentStep === 5 && (
                        <div className="space-y-6">
                            <p className="text-sm text-gray-600">
                                The FCA Analyst and clinical notes identify interventions and supports in two
                                categories: supports already <strong>addressed</strong>, and new or increased
                                supports being <strong>recommended</strong>. Both feed into the report as their
                                own section.
                            </p>
                            <InterventionCategoryEditor
                                field="currentInterventions"
                                title="Addressed"
                                description="Supports and interventions already in place for the participant."
                                emptyPlaceholder="Enter a support already in place"
                                values={Array.isArray(formData.currentInterventions) ? formData.currentInterventions : []}
                                suggestions={suggestedAddressedInterventions}
                                justificationMap={analysisAddressedInterventionJustificationMap}
                                accent="sky"
                                onArrayChange={handleArrayChange}
                                onAddItem={handleAddArrayItem}
                                onToggleSuggestion={handleToggleSuggestion}
                                onShowJustification={setInterventionInfoSuggestion}
                            />
                            <InterventionCategoryEditor
                                field="recommendedInterventions"
                                title="Recommended"
                                description="New or increased supports being recommended for the participant."
                                emptyPlaceholder="Enter a recommended support"
                                values={Array.isArray(formData.recommendedInterventions) ? formData.recommendedInterventions : []}
                                suggestions={suggestedInterventions}
                                justificationMap={analysisInterventionJustificationMap}
                                accent="emerald"
                                onArrayChange={handleArrayChange}
                                onAddItem={handleAddArrayItem}
                                onToggleSuggestion={handleToggleSuggestion}
                                onShowJustification={setInterventionInfoSuggestion}
                            />

                            {interventionInfoSuggestion && (
                                <div
                                    className="fixed inset-0 z-[70] flex items-center justify-center bg-gray-900/50 p-4"
                                    role="dialog"
                                    aria-modal="true"
                                    aria-label="Intervention justification"
                                    onClick={() => setInterventionInfoSuggestion(null)}
                                >
                                    <div
                                        className="w-full max-w-lg rounded-lg border border-gray-300 bg-white shadow-2xl"
                                        onClick={(event) => event.stopPropagation()}
                                    >
                                        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                                            <span className="text-sm font-semibold text-gray-900">{interventionInfoSuggestion.intervention}</span>
                                            <button
                                                type="button"
                                                onClick={() => setInterventionInfoSuggestion(null)}
                                                className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                                            >
                                                Close
                                            </button>
                                        </div>
                                        <div className="p-4">
                                            <p className="text-sm text-gray-700">{interventionInfoSuggestion.justification}</p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {currentStep === 6 && (
                        <div className="space-y-6">
                            <ParticipantSourcesPanel
                                title="Stored participant goals"
                                rows={participantSourceRowsForStep(7)}
                                selection={formData.participantSources}
                                onToggle={handleParticipantSourceToggle}
                            />
                            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                                <p className="text-sm text-gray-600 mb-4">
                                    List the participant&apos;s goals and objectives for their NDIS plan.
                                </p>
                                {intakeGoals.length > 0 && formData.goals.some((goal) => intakeGoals.includes(String(goal || '').trim())) && (
                                    <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                                        Pre-filled {intakeGoals.length} goal{intakeGoals.length === 1 ? '' : 's'} from the intake form answer to &ldquo;What are their NDIS Goals?&rdquo; — edit or remove any that are not relevant.
                                    </p>
                                )}
                                <div className="space-y-3">
                                    {formData.goals.map((goal, idx) => (
                                        <AutoResizeTextarea
                                            key={idx}
                                            value={goal}
                                            onChange={(nextValue) => handleArrayChange('goals', idx, nextValue)}
                                            suggestions={COMMON_GOALS}
                                            placeholder={COMMON_GOALS[idx] || 'Enter a goal/objective'}
                                        />
                                    ))}
                                </div>
                                <button
                                    onClick={() => handleAddArrayItem('goals')}
                                    className="mt-4 text-sm font-medium text-blue-600 hover:text-blue-700"
                                >
                                    + Add goal
                                </button>
                            </div>
                        </div>
                    )}

                    {currentStep === 7 && (
                        <div className="space-y-6">
                            <ParticipantSourcesPanel
                                rows={participantSourceRowsForStep(8)}
                                selection={formData.participantSources}
                                onToggle={handleParticipantSourceToggle}
                            />
                            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                                <h2 className="text-lg font-semibold text-gray-900 mb-4">Report Focus</h2>
                                <p className="text-gray-700 mb-4">
                                    The participant&apos;s notes and included transcripts are already read in full for this report, so there is no
                                    need to repeat them here. Use this box only to steer emphasis — for example when new funding becomes
                                    available, or to prioritise particular supports. It directs wording and priority; it is not evidence, and
                                    nothing is added to the report that the record does not already support.
                                </p>
                                <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Steering notes (emphasis only)
                                    </label>
                                    <textarea
                                        value={formData.additionalNotes}
                                        onChange={(e) => handleInputChange('additionalNotes', e.target.value)}
                                        className="w-full px-4 py-3 rounded-md border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                                        rows={6}
                                        placeholder="e.g. New funding is available this plan period — emphasise assistive technology and home modification needs, and quantify the support hours each recommendation implies."
                                    />
                                    <p className="mt-2 text-xs text-gray-500">
                                        Not reproduced in the report. Where the evidence does not support a steer, the report says so rather than
                                        asserting it.
                                    </p>
                                </div>
                            </div>

                            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <h3 className="text-sm font-semibold text-gray-900">Attached files</h3>
                                        <p className="mt-1 max-w-2xl text-xs text-gray-600">
                                            Attach documents from this participant&apos;s file store to the report context. Text, CSV, JSON
                                            and DOCX files have their contents added to the context; other file types are attached by name only.
                                            Consultations reach the report through their transcript summaries, so recordings are not
                                            listed here.
                                        </p>
                                    </div>
                                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                                        {recordingFileCount > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => setShowRecordingFiles((prev) => !prev)}
                                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50"
                                            >
                                                {showRecordingFiles
                                                    ? 'Hide recordings'
                                                    : `Show ${recordingFileCount} recording${recordingFileCount === 1 ? '' : 's'}`}
                                            </button>
                                        )}
                                        <label
                                            className={`inline-flex shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium ${attachmentUploading || !patientId
                                                ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400'
                                                : 'cursor-pointer border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
                                                }`}
                                        >
                                            {attachmentUploading ? 'Uploading…' : '+ Upload file'}
                                            <input
                                                type="file"
                                                multiple
                                                className="hidden"
                                                disabled={attachmentUploading || !patientId}
                                                onChange={(event) => {
                                                    handleUploadAttachments(event.target.files)
                                                    event.target.value = ''
                                                }}
                                            />
                                        </label>
                                    </div>
                                </div>

                                {!patientId && (
                                    <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                        This report is not linked to a stored participant yet, so files cannot be listed or uploaded.
                                    </p>
                                )}

                                {attachmentsError && (
                                    <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{attachmentsError}</p>
                                )}

                                {attachmentsNotice && (
                                    <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{attachmentsNotice}</p>
                                )}

                                {patientFilesLoading && (
                                    <p className="mt-3 text-xs text-gray-500">Loading files…</p>
                                )}

                                {!patientFilesLoading && visibleAttachmentRows.length === 0 && patientId && (
                                    <p className="mt-3 rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                                        {recordingFileCount > 0
                                            ? 'No readable files are stored for this participant. Consultations reach the report through their transcript summaries, so recordings are not used as context.'
                                            : 'No files are stored for this participant yet. Upload one to attach it to the report context.'}
                                    </p>
                                )}

                                {visibleAttachmentRows.length > 0 && (
                                    <ul className="mt-3 space-y-2">
                                        {visibleAttachmentRows.map((file) => {
                                            const isAttached = attachmentFiles
                                                .some((attached) => attached.id === file.id)
                                            const text = attachmentTexts.get(file.id) || ''
                                            const isBusy = attachmentBusyId === file.id
                                            const canReadText = isTextExtractable(file.mimeType, file.fileName)
                                            const inAnalystScope = analystScopedFileIds.has(String(file.id))

                                            return (
                                                <li
                                                    key={file.id}
                                                    className={`rounded-md border px-3 py-2 ${isAttached ? 'border-emerald-200 bg-emerald-50/60' : 'border-gray-200 bg-white'}`}
                                                >
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="min-w-0 flex-1">
                                                            <p className="truncate text-sm font-medium text-gray-900">{file.fileName}</p>
                                                            <p className="text-[11px] text-gray-500">
                                                                {[
                                                                    file.mimeType || 'unknown type',
                                                                    formatFileSize(file.fileSize),
                                                                    formatAttachmentDate(file.createdAt),
                                                                    file.missing ? 'no longer in the file store' : '',
                                                                ].filter(Boolean).join(' · ')}
                                                            </p>
                                                        </div>
                                                        <div className="flex shrink-0 items-center gap-2">
                                                            {isAttached && text && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setAttachmentPreviewId((current) => (current === file.id ? '' : file.id))}
                                                                    className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                                                >
                                                                    {attachmentPreviewId === file.id ? 'Hide text' : `View text (${text.length.toLocaleString()})`}
                                                                </button>
                                                            )}
                                                            <button
                                                                type="button"
                                                                onClick={() => handleToggleAttachment(file)}
                                                                disabled={isBusy}
                                                                className={`rounded-md border px-2 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60 ${isAttached
                                                                    ? 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                                                                    : 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
                                                                    }`}
                                                            >
                                                                {isBusy ? 'Reading…' : isAttached ? 'Remove from context' : 'Add to context'}
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {isAttached && !text && !canReadText && (
                                                        <p className="mt-1 text-[11px] text-amber-700">
                                                            Attached by name only — this file type cannot be read as text.
                                                        </p>
                                                    )}

                                                    {inAnalystScope && (
                                                        <p className="mt-1 text-[11px] text-emerald-700">
                                                            In the FCA Analyst&apos;s evidence scope — its findings reach the report
                                                            without attaching it here. Attaching is optional.
                                                        </p>
                                                    )}

                                                    {attachmentPreviewId === file.id && text && (
                                                        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-gray-200 bg-white p-2 text-[11px] leading-relaxed text-gray-700">
                                                            {text.length > 4000 ? `${text.slice(0, 4000)}\n…` : text}
                                                        </pre>
                                                    )}
                                                </li>
                                            )
                                        })}
                                    </ul>
                                )}

                                {attachmentFiles.length > 0 && (
                                    <p className="mt-3 text-xs text-gray-600">
                                        {attachmentFiles.length} of {attachmentRows.length} file{attachmentRows.length === 1 ? '' : 's'} attached
                                        {' · '}
                                        {attachmentTextLength.toLocaleString()} characters of extracted text will be added to the report context.
                                    </p>
                                )}
                            </div>
                        </div>
                    )}

                    {currentStep === 8 && (
                        <div className="space-y-6">
                            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                                <h2 className="text-lg font-semibold text-gray-900 mb-2">Transcripts &amp; Summaries</h2>
                                <p className="text-sm text-gray-600">
                                    Each consultation below has its own summary written for this report. Choose which transcripts to
                                    include, and edit any summary that needs correcting before it becomes evidence.
                                </p>

                                {transcriptStepError && (
                                    <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{transcriptStepError}</p>
                                )}

                                {!transcriptStepError && transcriptSummaryError && (
                                    <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{transcriptSummaryError}</p>
                                )}

                                {!patientId && (
                                    <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                        This report is not linked to a stored participant yet, so transcripts cannot be listed.
                                    </p>
                                )}

                                {transcriptStepLoading && (
                                    <p className="mt-3 text-xs text-gray-500">Loading transcripts…</p>
                                )}

                                {patientId && !transcriptStepLoading && transcriptRows.length === 0 && (
                                    <p className="mt-3 rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                                        No completed transcripts are stored for this participant yet. The report will use notes and
                                        attached files only.
                                    </p>
                                )}

                                {transcriptRows.length > 0 && (
                                    <>
                                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
                                            <div className="text-xs text-gray-700">
                                                <span className="font-medium text-gray-900">
                                                    {includedTranscriptCount} of {transcriptRows.length}
                                                </span> transcript{transcriptRows.length === 1 ? '' : 's'} included
                                                {' · '}
                                                <span className="font-medium text-gray-900">
                                                    {transcriptRows.filter((row) => row.hasSummary).length}
                                                </span> summar{transcriptRows.filter((row) => row.hasSummary).length === 1 ? 'y' : 'ies'} ready
                                                {missingEvidenceRows.length > 0 && (
                                                    <span className="text-amber-700">
                                                        {' · '}{missingEvidenceRows.length} still needed
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => handleToggleAllTranscripts(true)}
                                                    className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                                                >
                                                    Select all
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleToggleAllTranscripts(false)}
                                                    className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                                                >
                                                    Clear all
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={handlePrepareTranscriptSummaries}
                                                    disabled={preparingSummaries || !patientId}
                                                    className="rounded-md border border-blue-300 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                                                >
                                                    {preparingSummaries ? 'Preparing…' : 'Prepare FCA summaries'}
                                                </button>
                                            </div>
                                        </div>

                                        {(prepareMessage || preparingSummaries || summariesInFlight) && (
                                            <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
                                                {prepareMessage ? (
                                                    <p className={`text-xs ${prepareTone === 'error' ? 'text-red-700' : 'text-blue-800'}`}>
                                                        {prepareMessage}
                                                    </p>
                                                ) : (
                                                    <p className="text-xs text-blue-800">Preparing transcript summaries…</p>
                                                )}
                                                {(preparingSummaries || summariesInFlight) && (
                                                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-blue-100">
                                                        <div className="h-full w-1/2 animate-pulse rounded-full bg-blue-500" />
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        <ul className="mt-4 space-y-3">
                                            {transcriptRows.map((row) => {
                                                const statusStyles = {
                                                    ready: 'border-emerald-200 bg-emerald-50 text-emerald-800',
                                                    processing: 'border-amber-200 bg-amber-50 text-amber-800',
                                                    queued: 'border-amber-200 bg-amber-50 text-amber-800',
                                                    failed: 'border-red-200 bg-red-50 text-red-700',
                                                    missing: 'border-gray-200 bg-gray-50 text-gray-600',
                                                }
                                                const isExpanded = expandedTranscriptId === row.id

                                                return (
                                                    <li
                                                        key={row.id}
                                                        className={`rounded-md border px-3 py-3 ${row.included ? 'border-blue-200 bg-blue-50/40' : 'border-gray-200 bg-white opacity-70'}`}
                                                    >
                                                        <div className="flex flex-wrap items-start justify-between gap-2">
                                                            <label className="flex min-w-0 items-start gap-2">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={row.included}
                                                                    onChange={(event) => handleToggleTranscriptIncluded(row.id, event.target.checked)}
                                                                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                                                />
                                                                <span className="min-w-0">
                                                                    <span className="block truncate text-sm font-medium text-gray-900">{row.title}</span>
                                                                    <span className="mt-0.5 block text-[11px] text-gray-500">
                                                                        {[row.dateLabel, row.timeLabel, row.status].filter(Boolean).join(' · ')}
                                                                    </span>
                                                                </span>
                                                            </label>
                                                            <div className="flex shrink-0 items-center gap-2">
                                                                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusStyles[row.summaryStatus] || statusStyles.missing}`}>
                                                                    {row.summaryStatusLabel}
                                                                </span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setExpandedTranscriptId((current) => (current === row.id ? '' : row.id))}
                                                                    className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                                                >
                                                                    {isExpanded ? 'Hide summary' : 'Review summary'}
                                                                </button>
                                                            </div>
                                                        </div>

                                                        {isExpanded && (
                                                            <div className="mt-3">
                                                                <textarea
                                                                    value={row.summaryText}
                                                                    onChange={(event) => handleTranscriptSummaryChange(row.id, event.target.value)}
                                                                    rows={10}
                                                                    placeholder="Write the evidence this transcript contributes, or prepare the summary above."
                                                                    className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs focus:border-transparent focus:ring-2 focus:ring-blue-500"
                                                                />
                                                                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                                                                    <p className="text-[11px] text-gray-500">
                                                                        {row.isEdited
                                                                            ? 'Edited for this report. The stored summary is unchanged.'
                                                                            : 'Showing the stored summary. Edits apply to this report only.'}
                                                                    </p>
                                                                    {row.isEdited && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => handleResetTranscriptSummary(row.id)}
                                                                            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                                                        >
                                                                            Reset to stored summary
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </li>
                                                )
                                            })}
                                        </ul>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    {currentStep === 9 && (
                        <div className="space-y-6">
                            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                                <h3 className="text-sm font-semibold text-gray-900">Report style</h3>
                                <p className="mt-1 text-xs text-gray-600">
                                    Both styles open with an executive summary written to stand on its own, for the NDIA planner who may have
                                    ten to fifteen minutes and read only that section.
                                </p>
                                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                    {FCA_REPORT_STYLES.map((style) => {
                                        const selected = resolveFcaReportStyle(formData.reportStyle).id === style.id
                                        const estimate = estimateFcaReportLength(style.id)
                                        return (
                                            <button
                                                key={style.id}
                                                type="button"
                                                onClick={() => handleInputChange('reportStyle', style.id)}
                                                aria-pressed={selected}
                                                className={`rounded-lg border p-4 text-left transition-colors ${selected ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-300' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
                                            >
                                                <span className="flex items-center justify-between gap-2">
                                                    <span className="text-sm font-semibold text-gray-900">{style.label}</span>
                                                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${selected ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                                                        about {estimate.pages} A4 pages
                                                    </span>
                                                </span>
                                                <span className="mt-2 block text-xs text-gray-600">{style.description}</span>
                                                <span className="mt-1 block text-[11px] text-gray-500">
                                                    about {estimate.words.toLocaleString()} words across {buildFcaSectionPlan(style.id).length} sections
                                                </span>
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>

                            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                                <h2 className="text-lg font-semibold text-gray-900 mb-4">Review & Queue Your Report</h2>
                                <div className="rounded-lg border border-teal-200 bg-teal-50 p-4">
                                    <p className="text-sm font-semibold text-teal-900">Queued report summary</p>
                                    <div className="mt-3 space-y-2 text-sm text-teal-900">
                                        <div><span className="font-medium">For:</span> {queueSummary.recipient}</div>
                                        <div><span className="font-medium">Purpose:</span> {queueSummary.purpose}</div>
                                        <div><span className="font-medium">Includes:</span> {queueSummary.inclusions.slice(0, 5).join(', ')}{queueSummary.inclusions.length > 5 ? ', …' : ''}</div>
                                        {queueSummary.evidenceItems.length > 0 && (
                                            <div><span className="font-medium">Evidence:</span> {queueSummary.evidenceItems.join(' · ')}</div>
                                        )}
                                        <div><span className="font-medium">Style:</span> {queueSummary.styleLabel}</div>
                                        <div><span className="font-medium">Estimated length:</span> about {queueSummary.estimatedPagesLabel}</div>
                                        {queueSummary.steeringApplied && (
                                            <div><span className="font-medium">Steering:</span> your report focus notes will direct emphasis</div>
                                        )}
                                    </div>
                                </div>
                                <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                                    <p className="font-medium text-gray-900">What will happen next</p>
                                    <p className="mt-2">{queueSummary.queueNote}</p>
                                </div>
                                <p className="mt-4 text-sm text-gray-600">
                                    You can still edit the draft later in the main report viewer after the job is queued.
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Footer Navigation */}
            <div className="border-t border-gray-200 bg-white/80 backdrop-blur px-6 py-4 shadow-sm">
                <div className="flex items-center justify-end gap-2">
                    <button
                        onClick={handlePrevStep}
                        disabled={currentStep === 0 || savingDraft}
                        className="px-4 py-2 rounded-md border border-gray-300 bg-white text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        ← Previous
                    </button>
                    {!isLastStep && (
                        <button
                            onClick={handleNextStep}
                            disabled={savingDraft}
                            className="px-4 py-2 rounded-md border border-blue-300 bg-blue-50 text-blue-700 font-medium hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {savingDraft ? 'Saving…' : 'Next →'}
                        </button>
                    )}

                    {isLastStep && (
                        <div className="relative z-20">
                            <button
                                type="button"
                                onClick={() => setShowQueueActionsMenu((prev) => !prev)}
                                disabled={savingDraft}
                                className="h-9 w-9 rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                aria-label="More queue actions"
                                aria-expanded={showQueueActionsMenu}
                            >
                                <span aria-hidden="true" className="text-lg leading-none">⋮</span>
                            </button>
                            {showQueueActionsMenu && (
                                <div className="absolute bottom-full right-0 z-50 mb-2 w-52 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowQueueActionsMenu(false)
                                            setShowQueueContextMenu(true)
                                        }}
                                        className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                                    >
                                        Review Queue Context
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                    {isLastStep && (
                        <button
                            onClick={handleSaveAndClose}
                            disabled={savingDraft}
                            className="px-4 py-2 rounded-md bg-gradient-to-r from-blue-600 to-teal-600 text-white font-medium hover:from-blue-700 hover:to-teal-700"
                        >
                            Finish & Queue Report
                        </button>
                    )}
                </div>
            </div>

            {showQueueContextMenu && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" role="dialog" aria-modal="true">
                    <div className="w-full max-w-3xl rounded-xl border border-gray-200 bg-white shadow-2xl">
                        <div className="border-b border-gray-200 px-5 py-4">
                            <p className="text-sm font-semibold text-gray-900">Queue Context Review</p>
                            <p className="mt-1 text-xs text-gray-600">Optional advanced check before queueing. You can close this and use one-click queue as normal.</p>
                        </div>
                        <div className="p-5 space-y-3">
                            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">FCA Worker Prompt Preview</p>
                            <div className="max-h-64 overflow-auto rounded-md border border-gray-200 bg-gray-50 p-3">
                                <pre className="text-xs text-gray-800 whitespace-pre-wrap break-words font-mono">
                                    {JSON.stringify(queuePreviewPayload.backendPromptPreview, null, 2)}
                                </pre>
                            </div>
                            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Payload Preview</p>
                            <div className="max-h-80 overflow-auto rounded-md border border-gray-200 bg-gray-50 p-3">
                                <pre className="text-xs text-gray-800 whitespace-pre-wrap break-words font-mono">
                                    {JSON.stringify(queuePreviewPayload, null, 2)}
                                </pre>
                            </div>
                        </div>
                        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-4">
                            <button
                                type="button"
                                onClick={() => setShowQueueContextMenu(false)}
                                disabled={savingDraft}
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                            >
                                Close
                            </button>
                            <button
                                type="button"
                                onClick={async () => {
                                    setShowQueueContextMenu(false)
                                    await handleSaveAndClose()
                                }}
                                disabled={savingDraft}
                                className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                            >
                                Queue Report
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {queuePreparation && (
                <div
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Preparing FCA transcript summaries"
                >
                    <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white shadow-2xl">
                        <div className="border-b border-gray-200 px-5 py-4">
                            <p className="text-sm font-semibold text-gray-900">Preparing transcript summaries</p>
                            <p className="mt-1 text-xs text-gray-600">
                                The report uses one FCA summary per included transcript. This normally finishes in under{' '}
                                {QUEUE_SUMMARY_WAIT_SECONDS} seconds.
                            </p>
                        </div>
                        <div className="space-y-4 p-5">
                            <div>
                                <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                                    {missingEvidenceRows.length === 0 ? (
                                        <div className="h-full w-full rounded-full bg-gradient-to-r from-blue-500 to-teal-500 transition-all duration-500" />
                                    ) : (
                                        <div className="h-full w-1/2 animate-pulse rounded-full bg-gradient-to-r from-blue-500 to-teal-500" />
                                    )}
                                </div>
                                <p className="mt-2 text-xs text-gray-600">
                                    {missingEvidenceRows.length === 0
                                        ? 'Summaries ready — queueing the report…'
                                        : `${missingEvidenceRows.length} transcript${missingEvidenceRows.length === 1 ? '' : 's'} waiting · ${queuePreparation.elapsedSeconds}s elapsed`}
                                </p>
                            </div>

                            <ul className="space-y-1">
                                {transcriptRows.filter((row) => row.included).map((row) => (
                                    <li key={row.id} className="flex items-center justify-between gap-3 text-xs">
                                        <span className="truncate text-gray-700">{row.title}</span>
                                        <span className={`shrink-0 ${row.summaryStatus === 'ready' ? 'text-emerald-700' : 'text-amber-700'}`}>
                                            {row.summaryStatusLabel}
                                        </span>
                                    </li>
                                ))}
                            </ul>

                            {prepareTone === 'error' && prepareMessage && (
                                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{prepareMessage}</p>
                            )}

                            {queuePreparation.timedOut && missingEvidenceRows.length > 0 && (
                                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                    This is taking longer than usual. Queueing now is safe — the report job waits for the
                                    summaries and starts on its own once they are ready.
                                </p>
                            )}
                        </div>
                        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-4">
                            <button
                                type="button"
                                onClick={() => {
                                    setQueuePreparation(null)
                                    setPreparingSummaries(false)
                                }}
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                            >
                                Keep editing
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setQueuePreparation(null)
                                    setPreparingSummaries(false)
                                    proceedWithQueueRef.current?.()
                                }}
                                disabled={savingDraft}
                                className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                            >
                                {savingDraft ? 'Queueing…' : 'Queue now'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
