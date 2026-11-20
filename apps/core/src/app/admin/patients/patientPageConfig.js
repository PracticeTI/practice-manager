import { normalizeQuoteWriterConfig } from '@/lib/patientQuoteDrafting'
import { normalizeOptionalStringId, normalizeStringArray } from './patientUtils'

export const  CSV_PREVIEW_ROW_LIMIT = 500

export const  DEFAULT_SPLPOSE_FIELDS = [
    { id: 'patient_full_name', label: 'Patient full name', type: 'Text', required: true, section: 'Patient' },
    { id: 'funding_source_or_referral_type', label: 'Funding Source or Referral Type', type: 'Dropdown', required: false, section: 'Patient', options: ['NDIS', 'HCP/ My Aged Care', 'TAC', 'DVA', 'WorkCover', 'Other'] },
    { id: 'client_phone', label: 'Client Phone', type: 'PhoneNumber', required: false, section: 'Patient' },
    { id: 'address', label: 'Address', type: 'Address', required: false, section: 'Patient' },
    { id: 'date_of_birth', label: 'Date of birth', type: 'Date', required: false, section: 'Patient' },
    { id: 'accident_date_if_tac', label: 'Accident date (if TAC)', type: 'Date', required: false, section: 'Patient' },
    { id: 'claim_or_reference_number', label: 'NDIS number/ TAC Claim Number/Work Cover Reference Number', type: 'Text', required: false, section: 'Patient' },
    { id: 'reasons_for_referral_to_ot', label: 'Reasons for Referral to OT', type: 'LongText', required: false, section: 'Referral' },
    { id: 'referrer_full_name', label: 'Full name', type: 'Text', required: false, section: 'Referral' },
    { id: 'referrer_relationship', label: 'Relationship', type: 'Text', required: false, section: 'Referral' },
    { id: 'referrer_phone', label: 'Phone Number', type: 'PhoneNumber', required: false, section: 'Referral' },
]

export const  DEFAULT_PATIENT_BILLING_FORM = {
    eventType: 'invoice',
    invoiceId: '',
    paymentId: '',
    status: '',
    amount: '',
    occurredAt: '',
    note: '',
}

export const  DEFAULT_PATIENT_AGENTS = {
    reporting: false,
    equipmentSourcer: false,
    hsrCreator: false,
    billing: false,
    analyst: false,
    scribe: false,
}

export const  PATIENT_AGENT_SORT_DELAY_MS = 5000

export const  AGENT_CARD_STYLES = {
    general: {
        badge: 'General',
        card: 'border-[var(--domain-color-2)] text-[var(--domain-color-3)] shadow-[inset_0_4px_0_var(--domain-color-1)]',
        background: 'bg-[color:rgb(var(--domain-color-1-rgb)/0.12)]',
        title: 'text-[var(--domain-color-3)]',
        details: 'text-[var(--domain-color-3)]',
        description: 'text-[var(--domain-color-3)]',
        actionLink: 'text-[var(--domain-color-2)] underline decoration-[var(--domain-color-1)] decoration-2 underline-offset-2 hover:opacity-70',
        settingsButton: 'border-[var(--domain-color-2)] bg-white text-[var(--domain-color-3)] hover:bg-[color:rgb(var(--domain-color-1-rgb)/0.08)]',
        badgeClass: 'border-[var(--domain-color-1)] bg-[var(--domain-color-1)] text-[var(--domain-color-1-contrast)]',
        status: {
            accent: 'bg-[var(--domain-color-1)] text-[var(--domain-color-1-contrast)]',
            active: 'bg-white text-[var(--domain-color-3)]',
            failed: 'bg-red-100 text-red-700',
        },
    },
    platformGeneral: {
        badge: 'General',
        card: 'border-blue-300 text-slate-800 shadow-[inset_0_4px_0_#2563eb]',
        background: 'bg-blue-50',
        title: 'text-slate-950',
        details: 'text-slate-700',
        description: 'text-slate-800',
        actionLink: 'text-blue-800 underline decoration-blue-500 decoration-2 underline-offset-2 hover:text-blue-950',
        settingsButton: 'border-blue-300 bg-white text-slate-800 hover:bg-blue-100',
        badgeClass: 'border-blue-700 bg-blue-700 text-white',
        status: {
            accent: 'bg-blue-700 text-white',
            active: 'bg-white text-slate-800',
            failed: 'bg-red-100 text-red-700',
        },
    },
    ndis: {
        badge: 'NDIS',
        card: 'border-[#6a2875] text-[#45204c] shadow-[inset_0_4px_0_#8dc63f]',
        background: 'bg-[#e9d8ec]',
        title: 'text-[#6a2875]',
        details: 'text-[#45204c]',
        description: 'text-[#45204c]',
        actionLink: 'text-[#6a2875] underline decoration-[#8dc63f] decoration-2 underline-offset-2 hover:text-[#45204c]',
        settingsButton: 'border-[#6a2875] bg-white text-[#6a2875] hover:bg-[#f4eaf6]',
        badgeClass: 'border-[#6a2875] bg-[#6a2875] text-white',
        status: {
            accent: 'bg-[#8dc63f] text-[#173f43]',
            active: 'bg-[#d7f1ee] text-[#006b68]',
            failed: 'bg-[#f7d9d4] text-[#a5283d]',
        },
    },
    // Image-backed NDIS variant of the helper card, mirroring `tacHelper`: the NDIS-helper
    // artwork is the card background and the shared `helper` rendering drops the badge,
    // description and settings summary while shrinking the settings control to an icon.
    // Currently only the FCA Analyst card uses it (see patientAgentCards).
    ndisHelper: {
        badge: 'NDIS',
        // The NDIS badge is no longer shown on helper cards, but `badge` is retained
        // because agent card sorting still groups by it (see patientAgentCards).
        hideBadge: true,
        card: 'border-[#6a2875] text-[#45204c] shadow-[inset_0_4px_0_#8dc63f] bg-[url(/funders/helpers/NDIS.png)] bg-cover bg-center',
        background: 'bg-[#e9d8ec]',
        title: 'text-[#6a2875]',
        details: 'text-[#45204c]',
        description: 'text-[#45204c]',
        actionLink: 'text-[#6a2875] underline decoration-[#8dc63f] decoration-2 underline-offset-2 hover:text-[#45204c]',
        settingsButton: 'border-[#6a2875] bg-white text-[#6a2875] hover:bg-[#f4eaf6]',
        badgeClass: 'border-[#6a2875] bg-[#6a2875] text-white',
        status: {
            accent: 'bg-[#8dc63f] text-[#173f43]',
            active: 'bg-[#d7f1ee] text-[#006b68]',
            failed: 'bg-[#f7d9d4] text-[#a5283d]',
        },
        helper: true,
    },
    tac: {
        badge: 'TAC',
        card: 'border-gray-400 text-gray-900 shadow-[inset_0_4px_0_#111827]',
        background: 'bg-gray-200',
        title: 'text-gray-950',
        details: 'text-gray-700',
        description: 'text-gray-800',
        actionLink: 'text-gray-950 underline decoration-gray-500 decoration-2 underline-offset-2 hover:text-gray-600',
        settingsButton: 'border-gray-500 bg-white text-gray-900 hover:bg-gray-100',
        badgeClass: 'border-black bg-black text-white',
        status: {
            accent: 'bg-gray-900 text-white',
            active: 'bg-white text-gray-800',
            failed: 'bg-red-100 text-red-700',
        },
    },
    tacHelper: {
        badge: 'TAC',
        // The TAC badge is no longer shown on helper cards, but `badge` is retained
        // because agent card sorting still groups by it (see patientAgentCards).
        hideBadge: true,
        card: 'border-gray-400 text-gray-900 shadow-[inset_0_4px_0_#111827] bg-[url(/funders/helpers/TAC.png)] bg-cover bg-center',
        background: 'bg-gray-200',
        title: 'text-gray-950',
        details: 'text-gray-700',
        description: 'text-gray-800',
        actionLink: 'text-gray-950 underline decoration-gray-500 decoration-2 underline-offset-2 hover:text-gray-600',
        settingsButton: 'border-gray-500 bg-white text-gray-900 hover:bg-gray-100',
        badgeClass: 'border-black bg-black text-white',
        status: {
            accent: 'bg-gray-900 text-white',
            active: 'bg-white text-gray-800',
            failed: 'bg-red-100 text-red-700',
        },
        helper: true,
    },
    seGeneral: {
        badge: '',
        card: 'border-[var(--domain-color-2)] text-[var(--domain-color-3)] shadow-[inset_0_4px_0_var(--domain-color-1)] bg-cover bg-center',
        // The artwork itself comes from the domain descriptor
        // (`agentCardArtwork`, read through `getPrivateDomainAgentCardArtwork`) and is
        // applied inline, because a public path that only the private overlay knows
        // cannot be a build-time Tailwind class. `bg-cover bg-center` above positions it.
        domainArtwork: true,
        background: 'bg-[color:rgb(var(--domain-color-1-rgb)/0.12)]',
        title: 'text-[var(--domain-color-3)]',
        details: 'text-[var(--domain-color-3)]',
        description: 'text-[var(--domain-color-3)]',
        actionLink: 'text-[var(--domain-color-2)] underline decoration-[var(--domain-color-1)] decoration-2 underline-offset-2 hover:opacity-70',
        settingsButton: 'border-[var(--domain-color-2)] bg-white text-[var(--domain-color-3)] hover:bg-[color:rgb(var(--domain-color-1-rgb)/0.08)]',
        badgeClass: 'border-[var(--domain-color-1)] bg-[var(--domain-color-1)] text-[var(--domain-color-1-contrast)]',
        status: {
            accent: 'bg-[var(--domain-color-1)] text-[var(--domain-color-1-contrast)]',
            active: 'bg-white text-[var(--domain-color-3)]',
            failed: 'bg-red-100 text-red-700',
        },
        helper: true,
    },
}

export const  USE_COLORED_AGENT_CARD_BACKGROUNDS = false

export const  REPORT_TYPE_LABELS = {
    'functional-capacity-assessment': 'Functional Capacity Assessment (FCA)',
    'assistive-technology-assessment': 'Assistive Technology Assessment (AT)',
    'home-modification-assessment': 'Home Modification Assessment',
}

export const  LEGACY_REPORT_TYPE_MAP = {
    clinical: 'functional-capacity-assessment',
    soap: 'assistive-technology-assessment',
    'bullet-summary': 'home-modification-assessment',
}

export const  REPORT_TYPE_VALUES = new Set(Object.keys(REPORT_TYPE_LABELS))

export function  normalizeReportingOutputStyle(value) {
    const normalized = String(value || '').trim().toLowerCase()
    const mapped = LEGACY_REPORT_TYPE_MAP[normalized] || normalized
    return REPORT_TYPE_VALUES.has(mapped) ? mapped : 'functional-capacity-assessment'
}

export function  getReportTypeLabel(value) {
    return REPORT_TYPE_LABELS[normalizeReportingOutputStyle(value)] || REPORT_TYPE_LABELS['functional-capacity-assessment']
}

export const  DEFAULT_REPORTING_AGENT_CONFIG = {
    outputStyle: 'functional-capacity-assessment',
    detailLevel: 'standard',
    includeRecommendations: true,
    includeTranscriptSnippets: true,
    focusAreas: ['functional-capacity'],
    additionalInstructions: '',
    comparativeReportFormatPatientId: '',
    comparativeReportFormatDraftId: '',
    comparativeRecommendationsPatientId: '',
    comparativeRecommendationsDraftId: '',
}

export const  REPORTING_COMPARATIVE_OPTIONS = [
    {
        key: 'report-format',
        label: 'Report Format',
        description: 'Use another patient draft as a style and structure reference for report formatting.',
        patientConfigKey: 'comparativeReportFormatPatientId',
        draftConfigKey: 'comparativeReportFormatDraftId',
    },
    {
        key: 'recommendations',
        label: 'Recommendations',
        description: 'Use another patient draft to guide recommendation structure and phrasing.',
        patientConfigKey: 'comparativeRecommendationsPatientId',
        draftConfigKey: 'comparativeRecommendationsDraftId',
    },
]

export const  DEFAULT_BILLING_AGENT_CONFIG = {
    invoiceScope: 'recent-consultations',
    lookbackDays: 30,
    includeTravel: true,
    includeConsumables: false,
    taxMode: 'standard',
    rounding: 'nearest-cent',
    extraContext: '',
}

export const  DEFAULT_ANALYST_WORKER_PROMPT = 'Review the patient notes and transcripts for FCA-relevant evidence. Focus on functional capacity, safety and risk, supports and recommendations, and goals and outcomes. Highlight evidence that would help build a strong, clinically grounded FCA report. When identifying supports or interventions, prefer specific, actionable suggestions such as occupational therapy, assistive technology, home modifications, personal care support, or community access supports. Classify each identified support as either already addressed (currently in place) or recommended (a new or increased support). Return addressed supports only through an addressedInterventions array and new/increased supports only through a recommendedInterventions array, where each item includes intervention and justification. Do not emit any other recommendation list content outside those arrays. Do not copy approved stems verbatim, do not reuse generic template phrases such as "The purpose of this assessment", and prefer fresh section-specific wording grounded in the supplied evidence.'

export const  LEGACY_ANALYST_WORKER_PROMPTS = new Set([
    'Review the patient notes and transcripts for FCA-relevant evidence. Focus on functional capacity, safety and risk, supports and recommendations, and goals and outcomes. Highlight evidence that would help build a strong, clinically grounded FCA report. When identifying supports or interventions, prefer specific, actionable suggestions such as occupational therapy, assistive technology, home modifications, personal care support, or community access supports, and note any important gaps or follow-up questions. Do not copy approved stems verbatim, do not reuse generic template phrases such as "The purpose of this assessment", and prefer fresh section-specific wording grounded in the supplied evidence.',
    'Review the patient notes and transcripts for FCA-relevant evidence. Focus on functional capacity, safety and risk, supports and recommendations, and goals and outcomes. Highlight evidence that would help build a strong, clinically grounded FCA report. When identifying supports or interventions, prefer specific, actionable suggestions such as occupational therapy, assistive technology, home modifications, personal care support, or community access supports, and note any important gaps or follow-up questions.',
    // Pre-2026-09-16: recommendations only, no addressed/recommended split.
    'Review the patient notes and transcripts for FCA-relevant evidence. Focus on functional capacity, safety and risk, supports and recommendations, and goals and outcomes. Highlight evidence that would help build a strong, clinically grounded FCA report. When identifying supports or interventions, prefer specific, actionable suggestions such as occupational therapy, assistive technology, home modifications, personal care support, or community access supports. Return recommendations only through a recommendedInterventions array where each item includes intervention and justification. Do not emit any other recommendation list content outside that array. Do not copy approved stems verbatim, do not reuse generic template phrases such as "The purpose of this assessment", and prefer fresh section-specific wording grounded in the supplied evidence.',
])

export const  DEFAULT_ANALYST_AGENT_CONFIG = {
    focus: 'fca-report-builder',
    includeTranscripts: true,
    minRecommendedInterventions: 0,
    // Effectively unlimited: the analyst's heuristic catalog only has ~9 possible interventions,
    // so this ceiling exists to keep the config numeric, not to cap what clinicians see.
    maxRecommendedInterventions: 50,
    additionalInstructions: '',
    workerPrompt: DEFAULT_ANALYST_WORKER_PROMPT,
}

export const  DEFAULT_SCRIBE_AGENT_CONFIG = {
    summaryStyle: 'topic-bullets-third-person',
    includeActionItems: true,
    additionalInstructions: '',
}

export const  DEFAULT_HSR_SUMMARISER_WORKER_PROMPT = 'Summarize the completed transcript for a TAC OTF10 Home Services Review. Prioritize evidence about personal care, domestic tasks, mobility, equipment, supervision, safety, and the level of home support required. Use only evidence from the transcript and do not invent findings or support needs.'

export const  DEFAULT_HSR_SUMMARISER_AGENT_CONFIG = {
    summaryStyle: 'otf10-home-services',
    includeActionItems: true,
    additionalInstructions: '',
    workerPrompt: DEFAULT_HSR_SUMMARISER_WORKER_PROMPT,
}

export const  DEFAULT_HSR_CREATOR_WORKER_PROMPT = 'You are an occupational therapist completing a TAC OTF10 Home Services Review draft. Use only the supplied Patient Notes and transcript Summary. Do not invent facts, dates, services, equipment, hours, contacts, or clinical findings.'

export const  DEFAULT_HSR_CREATOR_AGENT_CONFIG = {
    includeTranscripts: true,
    additionalInstructions: '',
    workerPrompt: DEFAULT_HSR_CREATOR_WORKER_PROMPT,
}

// confirmation all name the same style.
export const  DEFAULT_SUMMARY_STYLE = 'topic-bullets-third-person'

// style), and it is the evidence block the FCA report is generated from.
export const  FCA_SUMMARY_STYLE = 'fca-functional-capacity'

export const  SUMMARY_STYLE_LABELS = {
    [DEFAULT_SUMMARY_STYLE]: 'General Summary',
    'otf10-home-services': 'OTF10 Home Services',
    [FCA_SUMMARY_STYLE]: 'FCA Functional Capacity',
}

// summariser style still gets a view instead of disappearing from the reader.
export const  SUMMARY_STYLE_ORDER = [DEFAULT_SUMMARY_STYLE, 'otf10-home-services', FCA_SUMMARY_STYLE]

// generic style, so `FCA Functional Capacity` sits before `General Summary`.
export const  PRIMARY_SUMMARY_STYLE_ORDER = [FCA_SUMMARY_STYLE, ...SUMMARY_STYLE_ORDER.filter((style) => style !== FCA_SUMMARY_STYLE)]

export function  normalizeSummaryStyleKey(value) {
    return String(value || '').trim().toLowerCase()
}

export function  describeSummaryStyleLabel(summaryStyle) {
    const style = normalizeSummaryStyleKey(summaryStyle)
    if (!style) return SUMMARY_STYLE_LABELS[DEFAULT_SUMMARY_STYLE]
    return SUMMARY_STYLE_LABELS[style]
        || style.replace(/[-_]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

export function  resolveSummaryStyleRank(summaryStyle, styleOrder = SUMMARY_STYLE_ORDER) {
    const style = normalizeSummaryStyleKey(summaryStyle) || DEFAULT_SUMMARY_STYLE
    const rank = styleOrder.indexOf(style)
    return rank === -1 ? styleOrder.length : rank
}

// row without a style is labelled "summary-unspecified", not the generic style).
export function  findBySummaryStyle(groups, summaryStyle) {
    const style = normalizeSummaryStyleKey(summaryStyle)
    if (!style) return null
    return groups.find((group) => normalizeSummaryStyleKey(group.style) === style) || null
}

// validate; the modal resolves 'forms' to 'intake' and 'summary' to 'transcripts'.
export const  PATIENT_MODAL_TABS = new Set(['overview', 'intake', 'notes', 'report', 'files', 'billing', 'cases', 'quotes', 'agreements', 'appointments', 'forms', 'transcripts', 'analysis', 'equipment', 'summary'])

// flag, which reads Inactive for NDIS-funded patients.
export const  NDIS_ONLY_AGENT_KEYS = new Set(['reporting'])

export function  isAgentActiveForPatient(agent, { isNdisFundedPatient, agents }) {
    const key = String(agent?.key || '').trim()
    const autoActiveForNdis = agent?.autoActiveForNdis === true || NDIS_ONLY_AGENT_KEYS.has(key)
    return autoActiveForNdis ? isNdisFundedPatient : agents?.[key] === true
}

export const  HIGH_CONFIDENCE_MATCH_THRESHOLD = 0.8

export function  normalizeAnalystWorkerPrompt(value) {
    const prompt = String(value || '').trim()
    if (!prompt) return DEFAULT_ANALYST_WORKER_PROMPT
    return LEGACY_ANALYST_WORKER_PROMPTS.has(prompt)
        ? DEFAULT_ANALYST_WORKER_PROMPT
        : prompt
}

export function  normalizeHsrCreatorWorkerPrompt(value) {
    return String(value || '').trim() || DEFAULT_HSR_CREATOR_WORKER_PROMPT
}

export function  normalizeAnalystRecommendationBounds(config = {}) {
    const rawMin = Number.parseInt(config.minRecommendedInterventions, 10)
    const rawMax = Number.parseInt(config.maxRecommendedInterventions, 10)
    const min = Number.isFinite(rawMin)
        ? Math.max(0, Math.min(50, rawMin))
        : DEFAULT_ANALYST_AGENT_CONFIG.minRecommendedInterventions
    const maxCandidate = Number.isFinite(rawMax)
        ? Math.max(min, Math.min(50, rawMax))
        : DEFAULT_ANALYST_AGENT_CONFIG.maxRecommendedInterventions

    return {
        minRecommendedInterventions: Math.min(min, maxCandidate),
        maxRecommendedInterventions: Math.max(min, maxCandidate),
    }
}

export function  normalizePatientAgents(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}

    const reportingConfigSource = source.reportingConfig && typeof source.reportingConfig === 'object' && !Array.isArray(source.reportingConfig)
        ? source.reportingConfig
        : {}
    const billingConfigSource = source.billingConfig && typeof source.billingConfig === 'object' && !Array.isArray(source.billingConfig)
        ? source.billingConfig
        : source.invoicingConfig && typeof source.invoicingConfig === 'object' && !Array.isArray(source.invoicingConfig)
            ? source.invoicingConfig
            : {}
    const analysisConfigSource = source.analysisConfig && typeof source.analysisConfig === 'object' && !Array.isArray(source.analysisConfig)
        ? source.analysisConfig
        : source.analystConfig && typeof source.analystConfig === 'object' && !Array.isArray(source.analystConfig)
            ? source.analystConfig
            : {}
    const scribeConfigSource = source.scribeConfig && typeof source.scribeConfig === 'object' && !Array.isArray(source.scribeConfig)
        ? source.scribeConfig
        : {}
    const hsrSummariserConfigSource = source.hsrSummariserConfig && typeof source.hsrSummariserConfig === 'object' && !Array.isArray(source.hsrSummariserConfig)
        ? source.hsrSummariserConfig
        : {}
    const hsrCreatorConfigSource = source.hsrCreatorConfig && typeof source.hsrCreatorConfig === 'object' && !Array.isArray(source.hsrCreatorConfig)
        ? source.hsrCreatorConfig
        : {}
    const analysisRecommendationBounds = normalizeAnalystRecommendationBounds(analysisConfigSource)

    const normalizedLookbackDays = Number.parseInt(billingConfigSource.lookbackDays, 10)

    return {
        reporting: source.reporting === true,
        equipmentSourcer: source.equipmentSourcer === true || source.equipment_sourcer === true,
        hsrCreator: source.hsrCreator === true || source.hsr_creator === true,
        hsrSummariser: source.hsrSummariser === true || source.hsr_summariser === true || source.hsrCreator === true || source.hsr_creator === true,
        quoteWriter: source.quoteWriter === true || source.quote_writer === true,
        billing: source.billing === true || source.invoicing === true,
        analyst: source.analyst === true || source.analysis === true,
        scribe: source.scribe === true,
        reportingConfig: {
            ...DEFAULT_REPORTING_AGENT_CONFIG,
            outputStyle: normalizeReportingOutputStyle(reportingConfigSource.outputStyle || DEFAULT_REPORTING_AGENT_CONFIG.outputStyle),
            detailLevel: String(reportingConfigSource.detailLevel || DEFAULT_REPORTING_AGENT_CONFIG.detailLevel).trim() || DEFAULT_REPORTING_AGENT_CONFIG.detailLevel,
            includeRecommendations: reportingConfigSource.includeRecommendations !== false,
            includeTranscriptSnippets: reportingConfigSource.includeTranscriptSnippets !== false,
            focusAreas: normalizeStringArray(reportingConfigSource.focusAreas),
            additionalInstructions: String(reportingConfigSource.additionalInstructions || '').trim(),
            comparativeReportFormatPatientId: normalizeOptionalStringId(reportingConfigSource.comparativeReportFormatPatientId),
            comparativeReportFormatDraftId: normalizeOptionalStringId(reportingConfigSource.comparativeReportFormatDraftId),
            comparativeRecommendationsPatientId: normalizeOptionalStringId(reportingConfigSource.comparativeRecommendationsPatientId),
            comparativeRecommendationsDraftId: normalizeOptionalStringId(reportingConfigSource.comparativeRecommendationsDraftId),
        },
        billingConfig: {
            ...DEFAULT_BILLING_AGENT_CONFIG,
            invoiceScope: String(billingConfigSource.invoiceScope || DEFAULT_BILLING_AGENT_CONFIG.invoiceScope).trim() || DEFAULT_BILLING_AGENT_CONFIG.invoiceScope,
            lookbackDays: Number.isFinite(normalizedLookbackDays)
                ? Math.max(7, Math.min(180, normalizedLookbackDays))
                : DEFAULT_BILLING_AGENT_CONFIG.lookbackDays,
            includeTravel: billingConfigSource.includeTravel !== false,
            includeConsumables: billingConfigSource.includeConsumables === true,
            taxMode: String(billingConfigSource.taxMode || DEFAULT_BILLING_AGENT_CONFIG.taxMode).trim() || DEFAULT_BILLING_AGENT_CONFIG.taxMode,
            rounding: String(billingConfigSource.rounding || DEFAULT_BILLING_AGENT_CONFIG.rounding).trim() || DEFAULT_BILLING_AGENT_CONFIG.rounding,
            extraContext: String(billingConfigSource.extraContext || '').trim(),
        },
        analysisConfig: {
            ...DEFAULT_ANALYST_AGENT_CONFIG,
            focus: String(analysisConfigSource.focus || DEFAULT_ANALYST_AGENT_CONFIG.focus).trim() || DEFAULT_ANALYST_AGENT_CONFIG.focus,
            includeTranscripts: analysisConfigSource.includeTranscripts !== false,
            minRecommendedInterventions: analysisRecommendationBounds.minRecommendedInterventions,
            maxRecommendedInterventions: analysisRecommendationBounds.maxRecommendedInterventions,
            additionalInstructions: String(analysisConfigSource.additionalInstructions || '').trim(),
            workerPrompt: normalizeAnalystWorkerPrompt(analysisConfigSource.workerPrompt),
        },
        scribeConfig: {
            ...DEFAULT_SCRIBE_AGENT_CONFIG,
            summaryStyle: String(scribeConfigSource.summaryStyle || DEFAULT_SCRIBE_AGENT_CONFIG.summaryStyle).trim() || DEFAULT_SCRIBE_AGENT_CONFIG.summaryStyle,
            includeActionItems: scribeConfigSource.includeActionItems !== false,
            additionalInstructions: String(scribeConfigSource.additionalInstructions || '').trim(),
        },
        hsrSummariserConfig: {
            ...DEFAULT_HSR_SUMMARISER_AGENT_CONFIG,
            includeActionItems: hsrSummariserConfigSource.includeActionItems !== false,
            additionalInstructions: String(hsrSummariserConfigSource.additionalInstructions || '').trim(),
            workerPrompt: String(hsrSummariserConfigSource.workerPrompt || '').trim() || DEFAULT_HSR_SUMMARISER_WORKER_PROMPT,
        },
        hsrCreatorConfig: {
            ...DEFAULT_HSR_CREATOR_AGENT_CONFIG,
            includeTranscripts: hsrCreatorConfigSource.includeTranscripts !== false,
            additionalInstructions: String(hsrCreatorConfigSource.additionalInstructions || '').trim(),
            workerPrompt: normalizeHsrCreatorWorkerPrompt(hsrCreatorConfigSource.workerPrompt),
        },
        // The worker's own normaliser owns the defaults and the region fallback, so
        // the card and the API always agree on what "unset" means.
        quoteWriterConfig: normalizeQuoteWriterConfig(source.quoteWriterConfig),
    }
}

export function  buildDerivedScribeWorkerPrompt(summaryPayload) {
    const payload = summaryPayload && typeof summaryPayload === 'object' && !Array.isArray(summaryPayload)
        ? summaryPayload
        : {}
    const config = payload.scribeConfig && typeof payload.scribeConfig === 'object' && !Array.isArray(payload.scribeConfig)
        ? payload.scribeConfig
        : {}

    const style = String(config.summaryStyle || payload.style || DEFAULT_SCRIBE_AGENT_CONFIG.summaryStyle).trim().toLowerCase()
        || DEFAULT_SCRIBE_AGENT_CONFIG.summaryStyle
    const includeActionItems = config.includeActionItems !== false
    const additionalInstructions = String(payload.additionalInstructions || config.additionalInstructions || '').trim()

    const styleDirective = style === 'clinical-brief'
        ? 'Return a concise clinical brief in prose and avoid bullet formatting.'
        : style === 'detailed'
            ? 'Return a detailed bullet-point list of conversation topics written in third person.'
            : 'Return a concise bullet-point list of conversation topics written in third person.'

    const actionDirective = includeActionItems
        ? 'Include action-oriented follow-up topics when present in the transcript.'
        : 'Do not include separate action-item bullets.'

    return [
        'Summarize the completed transcript into a concise bullet-point list of conversation topics written in third person. Focus on functional impacts, symptoms, safety, supports, and agreed follow-up priorities.',
        styleDirective,
        actionDirective,
        additionalInstructions || null,
    ].filter(Boolean).join(' ')
}

export function  shortenScribeSummaryWording(value) {
    return String(value || '')
        .replace(/\bthe occupational therapist and the patient\b/gi, 'OT and the patient')
}

export function  shortenScribeActionItemWording(value) {
    return shortenScribeSummaryWording(value)
}
