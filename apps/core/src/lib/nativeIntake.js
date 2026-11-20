// Native intake: the practice's own intake form, as an option next to the
// Splose embed.
//
// Pure module. The admin editor, the public renderer, the submission endpoint
// and the tests all read the same definition, and a submission is projected into
// the same `forms` row shape the Splose importer writes — so `/admin/forms`, the
// patient Forms tab and Intake Data work without knowing which one was used.

import { normalizePhone } from './appointmentMessaging.js'
import { getPrivateDomainFieldMap } from './domainExtension.js'

export const NATIVE_EXTERNAL_SOURCE = 'native'

/** `splose` keeps the existing embed; `native` replaces it; `both` offers a choice. */
export const INTAKE_MODES = ['splose', 'native', 'both']
export const DEFAULT_INTAKE_MODE = 'splose'

/**
 * Per-domain defaults, applied before any stored setting.
 *
 * The overlay may select a domain's initial intake mode; otherwise the existing
 * Splose embed remains the default.
 */
export const INTAKE_DEFAULTS_BY_DOMAIN = {
    ...getPrivateDomainFieldMap('nativeIntakeDefaults'),
}

export const DEFAULT_INTAKE_SETTINGS = {
    mode: DEFAULT_INTAKE_MODE,
    notificationEmail: '',
    introText: '',
    consentText: 'I agree to be contacted about this intake and understand my answers are stored in my clinical record.',
    thankYouText: 'Thanks — your intake form has been received. The practice will be in touch shortly.',
}

export const QUESTION_TYPES = [
    'text',
    'textarea',
    'email',
    'phone',
    'date',
    'number',
    'select',
    'radio',
    'checkboxes',
    'yesno',
]

/**
 * Default OT intake.
 *
 * Question titles deliberately match the aliases in `forms.js` ("Patient full
 * name", "Client Phone", "Reason for Referral", …) so answers land in the
 * patient's Intake Data with no extra mapping table.
 */
export const DEFAULT_NATIVE_INTAKE_FORM = {
    title: 'New client intake',
    introText: 'A few questions so we can prepare for your first appointment.',
    sections: [
        {
            id: 'about-you',
            title: 'About you',
            description: '',
            questions: [
                { id: 'patient-full-name', label: 'Patient full name', type: 'text', required: true, options: [] },
                { id: 'email', label: 'Email Address', type: 'email', required: true, options: [] },
                { id: 'client-phone', label: 'Client Phone', type: 'phone', required: true, options: [] },
                { id: 'date-of-birth', label: 'Date of Birth', type: 'date', required: false, options: [] },
                { id: 'address', label: 'Address', type: 'textarea', required: false, options: [] },
                { id: 'preferred-contact', label: 'Preferred contact method', type: 'radio', required: false, options: ['Phone', 'Email', 'SMS'] },
            ],
        },
        {
            id: 'funding',
            title: 'Funding',
            description: '',
            questions: [
                {
                    id: 'funding-source',
                    label: 'Funding Source or Referral Type',
                    type: 'select',
                    required: true,
                    options: ['NDIS', 'TAC', 'WorkCover', 'Medicare', 'Private', 'Other'],
                },
                { id: 'claim-number', label: 'NDIS number', type: 'text', required: false, options: [] },
                { id: 'ndis-support-coordinator-name', label: 'NDIS Support Coordinator Name', type: 'text', required: false, options: [] },
                { id: 'plan-manager-email', label: 'Plan manager email address', type: 'email', required: false, options: [] },
            ],
        },
        {
            id: 'referrer',
            title: 'Referrer',
            description: 'Leave blank if you are referring yourself.',
            questions: [
                { id: 'referrer-name', label: 'Full name', type: 'text', required: false, options: [] },
                { id: 'referrer-relationship', label: 'Relationship', type: 'text', required: false, options: [] },
                { id: 'referrer-phone', label: 'Phone Number', type: 'phone', required: false, options: [] },
            ],
        },
        {
            id: 'needs',
            title: 'Your needs',
            description: '',
            questions: [
                { id: 'reason-for-referral', label: 'Reason for Referral', type: 'textarea', required: true, options: [] },
                { id: 'ndis-goals', label: 'What are their NDIS goals', type: 'textarea', required: false, options: [] },
                { id: 'interpreter', label: 'Is an interpreter required', type: 'yesno', required: false, options: [] },
                { id: 'other-information', label: 'Any other important information', type: 'textarea', required: false, options: [] },
            ],
        },
        {
            id: 'consent',
            title: 'Consent',
            description: '',
            questions: [
                { id: 'consent', label: 'I agree to be contacted about this intake', type: 'yesno', required: true, options: [] },
            ],
        },
    ],
}

const MAX_TEXT = 4000
const MAX_LABEL = 200
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/

function cleanText(value) {
    return String(value === undefined || value === null ? '' : value).trim()
}

function slugify(value, fallback) {
    const slug = cleanText(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80)
    return SLUG_PATTERN.test(slug) ? slug : fallback
}

function uniqueId(candidate, used, fallback) {
    let id = candidate || fallback
    let suffix = 2
    while (used.has(id)) {
        id = `${candidate || fallback}-${suffix}`
        suffix += 1
    }
    used.add(id)
    return id
}

function normalizeOptions(raw) {
    const list = Array.isArray(raw)
        ? raw
        : String(raw || '').split(/[\n,]/)
    return list
        .map((option) => cleanText(option).slice(0, MAX_LABEL))
        .filter(Boolean)
        .filter((option, index, all) => all.indexOf(option) === index)
        .slice(0, 40)
}

export function normalizeIntakeMode(value) {
    const normalized = cleanText(value).toLowerCase()
    return INTAKE_MODES.includes(normalized) ? normalized : DEFAULT_INTAKE_MODE
}

function normalizeNotificationEmail(value) {
    const text = cleanText(value).toLowerCase().slice(0, 180)
    return text && EMAIL_PATTERN.test(text) ? text : ''
}

export function normalizeIntakeSettings(raw) {
    const data = raw && typeof raw === 'object' ? raw : {}
    return {
        mode: normalizeIntakeMode(data.mode),
        notificationEmail: normalizeNotificationEmail(data.notificationEmail),
        introText: cleanText(data.introText).slice(0, 600),
        consentText: cleanText(data.consentText).slice(0, 600) || DEFAULT_INTAKE_SETTINGS.consentText,
        thankYouText: cleanText(data.thankYouText).slice(0, 600) || DEFAULT_INTAKE_SETTINGS.thankYouText,
    }
}

export function mergeIntakeSettings(current, patch) {
    const base = normalizeIntakeSettings(current)
    const next = patch && typeof patch === 'object' ? patch : {}
    return normalizeIntakeSettings({ ...base, ...next })
}

export function defaultIntakeSettingsForDomain(domain) {
    const key = cleanText(domain).toLowerCase()
    return normalizeIntakeSettings(INTAKE_DEFAULTS_BY_DOMAIN[key] || {})
}

/**
 * Normalise an edited definition: stable ids, trimmed labels, valid types and
 * deduplicated options. Anything unusable is dropped rather than rejected, so a
 * half-finished edit still saves and still renders.
 */
export function normalizeNativeIntakeForm(raw) {
    const source = raw && typeof raw === 'object' ? raw : DEFAULT_NATIVE_INTAKE_FORM
    const sectionIds = new Set()
    const questionIds = new Set()

    const sections = (Array.isArray(source.sections) ? source.sections : [])
        .filter((section) => section && typeof section === 'object')
        .map((section, sectionIndex) => {
            const sectionId = uniqueId(
                slugify(section.id || section.title, `section-${sectionIndex + 1}`),
                sectionIds,
                `section-${sectionIndex + 1}`
            )

            const questions = (Array.isArray(section.questions) ? section.questions : [])
                .filter((question) => question && typeof question === 'object')
                .map((question, questionIndex) => {
                    const label = cleanText(question.label ?? question.title).slice(0, MAX_LABEL)
                    if (!label) return null

                    const type = QUESTION_TYPES.includes(cleanText(question.type).toLowerCase())
                        ? cleanText(question.type).toLowerCase()
                        : 'text'
                    const options = normalizeOptions(question.options)
                    const needsOptions = type === 'select' || type === 'radio' || type === 'checkboxes'

                    return {
                        id: uniqueId(
                            slugify(question.id || label, `${sectionId}-q${questionIndex + 1}`),
                            questionIds,
                            `${sectionId}-q${questionIndex + 1}`
                        ),
                        label,
                        type,
                        required: question.required === true,
                        help: cleanText(question.help).slice(0, 300),
                        placeholder: cleanText(question.placeholder).slice(0, 120),
                        options: needsOptions ? options : [],
                    }
                })
                .filter(Boolean)

            return {
                id: sectionId,
                title: cleanText(section.title).slice(0, MAX_LABEL) || `Section ${sectionIndex + 1}`,
                description: cleanText(section.description).slice(0, 400),
                questions,
            }
        })

    return {
        title: cleanText(source.title).slice(0, MAX_LABEL) || DEFAULT_NATIVE_INTAKE_FORM.title,
        introText: cleanText(source.introText).slice(0, 600),
        sections,
    }
}

/** Reasons a normalised definition cannot be published. */
export function validateNativeIntakeForm(definition) {
    const form = normalizeNativeIntakeForm(definition)
    const errors = []

    if (form.sections.length === 0) errors.push('Add at least one section')
    const questions = form.sections.flatMap((section) => section.questions)
    if (questions.length === 0) errors.push('Add at least one question')
    if (questions.length > 200) errors.push('That is too many questions for one form')

    questions.forEach((question) => {
        const needsOptions = question.type === 'select' || question.type === 'radio' || question.type === 'checkboxes'
        if (needsOptions && question.options.length === 0) {
            errors.push(`"${question.label}" needs at least one option`)
        }
    })

    return { errors, form }
}

/** Which forms a mode makes available. */
export function intakeFormsForMode(mode) {
    const normalized = normalizeIntakeMode(mode)
    if (normalized === 'native') return ['native']
    if (normalized === 'both') return ['native', 'splose']
    return ['splose']
}

/**
 * Resolve which form to render for a request.
 *
 * `?form=` may pick between the forms the mode already offers, so a link can
 * deep-link to one of them, but it can never enable a form the practice turned
 * off.
 */
export function resolveIntakeChoice(mode, requested) {
    const available = intakeFormsForMode(mode)
    const wanted = cleanText(requested).toLowerCase()
    if (available.includes(wanted)) return { form: wanted, available }
    return { form: available.includes('native') && available.length === 1 ? 'native' : 'splose', available }
}

function checkAnswer(question, rawValue) {
    const type = question.type
    const required = question.required === true

    if (type === 'checkboxes') {
        const values = Array.isArray(rawValue)
            ? rawValue
            : String(rawValue || '').split(',').map((item) => cleanText(item))
        const selected = values.filter((value) => question.options.includes(value))
        if (required && selected.length === 0) return { error: `${question.label} is required`, value: '' }
        return { value: selected.join(', ') }
    }

    const text = cleanText(rawValue).slice(0, MAX_TEXT)

    if (type === 'yesno') {
        if (!text) {
            if (required) return { error: `${question.label} is required`, value: '' }
            return { value: '' }
        }
        const normalized = text.toLowerCase()
        if (!['yes', 'no', 'true', 'false'].includes(normalized)) {
            return { error: `${question.label} must be yes or no`, value: '' }
        }
        const yes = normalized === 'yes' || normalized === 'true'
        if (required && !yes) return { error: `${question.label} must be answered yes to continue`, value: '' }
        return { value: yes ? 'Yes' : 'No' }
    }

    if (!text) {
        if (required) return { error: `${question.label} is required`, value: '' }
        return { value: '' }
    }

    if (type === 'email') {
        if (!EMAIL_PATTERN.test(text)) return { error: `${question.label} must be a valid email address`, value: '' }
        return { value: text.toLowerCase() }
    }

    if (type === 'phone') {
        const phone = normalizePhone(text)
        if (!phone || phone.replace(/\D/g, '').length < 8) {
            return { error: `${question.label} must be a valid phone number`, value: '' }
        }
        return { value: phone }
    }

    if (type === 'date') {
        if (!DATE_PATTERN.test(text) || Number.isNaN(new Date(`${text}T00:00:00Z`).getTime())) {
            return { error: `${question.label} must be a date (YYYY-MM-DD)`, value: '' }
        }
        return { value: text }
    }

    if (type === 'number') {
        const parsed = Number(text)
        if (!Number.isFinite(parsed)) return { error: `${question.label} must be a number`, value: '' }
        return { value: String(parsed) }
    }

    if (type === 'select' || type === 'radio') {
        if (question.options.length > 0 && !question.options.includes(text)) {
            return { error: `${question.label} must be one of: ${question.options.join(', ')}`, value: '' }
        }
        return { value: text }
    }

    if (type === 'textarea') return { value: text.slice(0, MAX_TEXT) }
    return { value: text }
}

/**
 * Validate a public submission.
 *
 * `company_website` is a honeypot. `consent` is checked separately by the caller
 * because the wording lives in the settings, not the form definition.
 */
export function validateIntakeSubmission(definition, payload) {
    const form = normalizeNativeIntakeForm(definition)
    const data = payload && typeof payload === 'object' ? payload : {}
    const submitted = data.answers && typeof data.answers === 'object' ? data.answers : data

    if (cleanText(data.company_website)) {
        return { errors: ['spam'], answers: null }
    }

    const errors = []
    const answers = {}
    const labelled = {}

    form.sections.forEach((section) => {
        section.questions.forEach((question) => {
            const result = checkAnswer(question, submitted?.[question.id])
            if (result.error) errors.push(result.error)
            if (result.value !== '') {
                answers[question.id] = result.value
                labelled[question.label] = result.value
            }
        })
    })

    return { errors, answers, labelled, form }
}

/**
 * Project answers into the `forms.content` shape the Splose importer writes, so
 * `buildFormIntakeAnswers` maps them onto the patient's Intake Data.
 */
export function buildNativeIntakeContent(definition, answers) {
    const form = normalizeNativeIntakeForm(definition)
    const source = answers && typeof answers === 'object' ? answers : {}

    return form.sections.map((section) => ({
        id: section.id,
        title: section.title,
        questions: section.questions.map((question) => ({
            id: question.id,
            type: question.type,
            title: question.label,
            answer: cleanText(source[question.id]),
        })),
    }))
}

/** Readable submission reference, derived from the row id. */
export function buildIntakeReference(formId) {
    const id = Number(formId)
    if (!Number.isFinite(id) || id <= 0) return ''
    return `IN-${String(Math.floor(id)).padStart(4, '0')}`
}

/**
 * Pull the participant's name, email and phone out of a submission by matching
 * question titles, so a new patient record can be created without hard-coding
 * question ids the practice may have renamed.
 */
export function extractIntakeContact(definition, answers) {
    const form = normalizeNativeIntakeForm(definition)
    const source = answers && typeof answers === 'object' ? answers : {}
    const contact = { name: '', email: '', phone: '' }

    form.sections.forEach((section) => {
        section.questions.forEach((question) => {
            const value = cleanText(source[question.id])
            if (!value) return
            const key = question.label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

            if (!contact.name && (key === 'patient full name' || key === 'patient name' || key === 'full name' || key === 'name')) {
                // A referrer section asking for "Full name" must not become the patient.
                const sectionKey = section.title.toLowerCase()
                if (!sectionKey.includes('referrer') && !sectionKey.includes('referral source')) {
                    contact.name = value
                }
            }
            if (!contact.email && question.type === 'email' && (key === 'email' || key === 'email address')) {
                contact.email = value.toLowerCase()
            }
            if (!contact.phone && question.type === 'phone') {
                contact.phone = normalizePhone(value) || value
            }
        })
    })

    return contact
}

export function buildIntakeNotificationEmail({ reference, patientName, answers, submittedAt, practiceName }) {
    const rows = Object.entries(answers || {}).map(([label, value]) => `${label}: ${value}`)
    const lines = [
        `New intake form ${reference} from ${patientName || 'a client'}.`,
        '',
        ...rows,
        '',
        `Submitted: ${submittedAt}`,
        `Practice: ${practiceName || ''}`,
    ].filter((line, index) => line !== '' || index === 1)

    return {
        subject: `New intake form — ${reference}`,
        text: lines.join('\n'),
    }
}
