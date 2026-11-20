// Shared helpers for the Forms entity.
//
// A "form" is one submitted intake questionnaire handed to the practice by an
// external practice-management system (a Splose "form" CSV export is the
// reference format). Each submission carries the whole answered form in its
// `content` column, and the importer projects the answers the app's own intake
// schema understands into `answers` / `labelled_answers` so an imported
// submission can populate a patient's Intake Data.
//
// Kept DB-agnostic and free of Node-only APIs so the CSV parser and the
// content projection can also run in the browser for import previews.

import { normalizeCsvHeader, parseCsv } from './csv.js'

export const DEFAULT_EXTERNAL_SOURCE = 'splose'

// Rows typed in through the API are not owned by an external system, so they
// get their own source and never collide with an imported id.
export const MANUAL_EXTERNAL_SOURCE = 'manual'

export const MAX_IMPORT_ROWS = 5000

// Free-text values land in JSON columns, so they only need a sanity cap.
const MAX_FACT_LENGTH = 4000

// ---------------------------------------------------------------------------
// Small shared coercions
// ---------------------------------------------------------------------------
export function cleanString(value) {
    return String(value === undefined || value === null ? '' : value).trim()
}

export function cleanNullableString(value, maxLength = 255) {
    const text = cleanString(value)
    return text ? text.slice(0, maxLength) : null
}

export function cleanOptionalText(value) {
    const text = String(value === undefined || value === null ? '' : value).replace(/\r\n/g, '\n').trim()
    if (!text) return null
    return text.slice(0, MAX_FACT_LENGTH)
}

export function toBool(value) {
    if (typeof value === 'boolean') return value
    const text = cleanString(value).toLowerCase()
    return ['1', 'true', 'yes', 'y', 'on'].includes(text)
}

export function parseMetadataValue(value) {
    if (value === null || value === undefined || value === '') return null
    if (typeof value === 'object') return value
    if (typeof value !== 'string') return null

    try {
        const parsed = JSON.parse(value)
        return parsed && typeof parsed === 'object' ? parsed : null
    } catch {
        return null
    }
}

export function validateId(rawId) {
    const parsed = Number.parseInt(String(rawId ?? ''), 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

// ---------------------------------------------------------------------------
// Timestamps
// ---------------------------------------------------------------------------

export function parseTimestamp(value) {
    const text = cleanString(value)
    if (!text) return null

    // The export uses ISO strings; a bare `YYYY-MM-DD HH:MM:SS` value is
    // treated as UTC for the same reason the other importers do.
    const hasTimezone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(text)
    const normalized = text.includes('T') || hasTimezone ? text : text.replace(' ', 'T') + 'Z'
    const date = new Date(normalized)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function timestampExpr(column) {
    return `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
}

export function toDbTimestamp(isoValue) {
    const iso = parseTimestamp(isoValue)
    if (!iso) return null
    const date = new Date(iso)
    const pad = (number) => String(number).padStart(2, '0')
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} `
        + `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
}

function formatTimestampValue(value) {
    if (value === null || value === undefined || value === '') return null
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
    return parseTimestamp(value) || cleanNullableString(value, 64)
}

// ---------------------------------------------------------------------------
// Content projection
// ---------------------------------------------------------------------------

// Field ids + labels from the app's canonical intake field set
// (see `DEFAULT_SPLPOSE_FIELDS` in the admin patients page), so a submission
// fills the same keys a manually entered patient record uses.
const INTAKE_FIELD_LABELS = {
    patient_full_name: 'Patient full name',
    funding_source_or_referral_type: 'Funding Source or Referral Type',
    client_phone: 'Client Phone',
    address: 'Address',
    date_of_birth: 'Date of birth',
    accident_date_if_tac: 'Accident date (if TAC)',
    claim_or_reference_number: 'NDIS number/ TAC Claim Number/Work Cover Reference Number',
    reasons_for_referral_to_ot: 'Reasons for Referral to OT',
    referrer_full_name: 'Full name',
    referrer_relationship: 'Relationship',
    referrer_phone: 'Phone Number',
}

// Questions the intake form asks that the app's schema has no field for. They
// are still projected (under their own id) so the data survives the import.
const EXTRA_QUESTION_FIELDS = {
    'has an ndis support coordinator been assigned': 'ndis_support_coordinator_assigned',
    'ndis support coordinator name': 'ndis_support_coordinator_name',
    'ndis support coordinator phone number': 'ndis_support_coordinator_phone',
    'ndis support coordinator email': 'ndis_support_coordinator_email',
    'plan manager email address': 'plan_manager_email',
    'what are their ndis goals': 'ndis_goals',
    'who should be contacted to make the appointment': 'booking_contact',
    'is an interpreter required': 'interpreter_required',
    'any other important information': 'other_important_information',
}

const PATIENT_QUESTION_ALIASES = new Map([
    ['patient full name', 'patient_full_name'],
    ['patient name', 'patient_full_name'],
    ['full name', 'patient_full_name'],
    ['funding source or referral type', 'funding_source_or_referral_type'],
    ['funding source', 'funding_source_or_referral_type'],
    ['referral type', 'funding_source_or_referral_type'],
    ['client phone', 'client_phone'],
    ['phone', 'client_phone'],
    ['address', 'address'],
    ['date of birth', 'date_of_birth'],
    ['accident date if tac', 'accident_date_if_tac'],
    ['accident date', 'accident_date_if_tac'],
    ['ndis number tac claim number work cover reference number', 'claim_or_reference_number'],
    ['ndis number', 'claim_or_reference_number'],
    ['claim number', 'claim_or_reference_number'],
    ['reasons for referral to ot', 'reasons_for_referral_to_ot'],
    ['reason for referral', 'reasons_for_referral_to_ot'],
])

// "Full name" / "Relationship" / "Phone Number" are answered twice: once for
// the referrer and once inside the patient section, so the section decides.
const REFERRER_QUESTION_ALIASES = new Map([
    ['full name', 'referrer_full_name'],
    ['name', 'referrer_full_name'],
    ['relationship', 'referrer_relationship'],
    ['phone number', 'referrer_phone'],
    ['phone', 'referrer_phone'],
])

// Punctuation (notably the "/" in "NDIS number/ TAC Claim Number/...") is
// reduced to a separator so one alias covers both spellings.
function normalizeQuestionKey(value) {
    return cleanString(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function toAnswerString(value) {
    return typeof value === 'number' ? String(value) : value
}

function pad2(value) {
    const number = Number.parseInt(String(value ?? ''), 10)
    if (!Number.isFinite(number)) return ''
    return String(number).padStart(2, '0')
}

function formatDateParts(question) {
    const year = Number.parseInt(String(question?.birthYear ?? question?.year ?? ''), 10)
    const month = Number.parseInt(String(question?.birthMonth ?? question?.month ?? ''), 10)
    const day = Number.parseInt(String(question?.birthDay ?? question?.day ?? ''), 10)
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return ''

    return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`
}

function formatPhoneAnswer(question) {
    const phones = Array.isArray(question?.phone) ? question.phone : []
    const parts = phones
        .map((entry) => {
            const number = cleanString(entry?.phoneNumber || entry?.number || entry)
            if (!number) return ''
            const code = cleanString(entry?.code)
            return code ? `${code} ${number}` : number
        })
        .filter(Boolean)
    return parts.join(', ')
}

function formatAddressAnswer(question) {
    const address = {
        addressLine1: cleanString(question?.addressL1 || question?.addressLine1 || question?.street),
        city: cleanString(question?.suburb || question?.city),
        state: cleanString(question?.state),
        postalCode: cleanString(question?.postalCode || question?.postcode),
        country: cleanString(question?.country),
    }

    return Object.values(address).some(Boolean) ? address : ''
}

function formatChoiceAnswer(question) {
    const checked = (Array.isArray(question?.checkboxes) ? question.checkboxes : [])
        .filter((choice) => choice?.checked === true)
        .map((choice) => cleanString(choice?.label || choice?.value || choice?.body))
        .filter(Boolean)
    if (checked.length > 0) return checked.join(', ')

    const choices = Array.isArray(question?.choices) ? question.choices : []
    const selected = choices.find((choice) => choice?.selected === true || choice?.checked === true)
    return selected ? cleanString(selected?.body || selected?.label || selected?.value) : ''
}

// Markers for a question as the external system exports it. A question that
// carries none of them but already has `answer` has been through
// `normalizeFormContent` once, so re-normalising must not drop its answer.
const RAW_ANSWER_KEYS = [
    'answerText',
    'phone',
    'addressL1',
    'addressLine1',
    'birthYear',
    'firstName',
    'lastName',
    'ndisNumber',
    'choices',
    'checkboxes',
    'value',
    'text',
]

/**
 * Reduce one exported question to its answer as plain data.
 * Returns '' when the question was left unanswered (or only carried help text).
 */
export function extractQuestionAnswer(question) {
    if (!question || typeof question !== 'object') return ''

    const type = cleanString(question.type).toLowerCase()

    if (type === 'statement' || type === 'image' || type === 'heading') return ''

    const hasRawShape = RAW_ANSWER_KEYS.some((key) => Object.prototype.hasOwnProperty.call(question, key))
    if (!hasRawShape && Object.prototype.hasOwnProperty.call(question, 'answer')) {
        return toAnswerString(question.answer)
    }

    const hasExplicitAnswer = question.answerText !== undefined && question.answerText !== null
        && cleanString(question.answerText) !== ''

    if (type === 'patient name') {
        const name = [cleanString(question.firstName), cleanString(question.middleName), cleanString(question.lastName)]
            .filter(Boolean)
            .join(' ')
        return name || cleanString(question.answerText)
    }
    if (type === 'phone') {
        const phone = formatPhoneAnswer(question)
        return phone || cleanString(question.answerText)
    }
    if (type === 'address') {
        const address = formatAddressAnswer(question)
        return address || cleanString(question.answerText)
    }
    if (type === 'date of birth') {
        return formatDateParts(question) || cleanString(question.answerText)
    }
    if (hasExplicitAnswer) {
        return toAnswerString(question.answerText)
    }
    if (type === 'date') {
        return formatDateParts({ year: question.dateYear, month: question.dateMonth, day: question.dateDay })
            || cleanString(question.value)
    }
    if (type === 'ndis number') {
        return cleanString(question.ndisNumber)
    }
    if (type === 'dropdown' || type === 'multiple choice' || type === 'checkboxes') {
        return formatChoiceAnswer(question)
    }
    // Conditional follow-ups the form chose not to show must not import.
    if (question.shown === false) return ''

    return cleanString(question.value ?? question.text)
}

// The `content` column can be a JSON string (CSV import) or an already parsed
// array (manual API writes), so both shapes are accepted.
function coerceContentSections(content) {
    if (Array.isArray(content)) return content
    const parsed = parseMetadataValue(content)
    if (Array.isArray(parsed)) return parsed
    if (parsed && Array.isArray(parsed.sections)) return parsed.sections
    return []
}

/**
 * Normalise an exported submission into `[{ id, title, questions: [...] }]`
 * with every question reduced to `{ id, type, title, answer }`.
 */
export function normalizeFormContent(content, { title = '' } = {}) {
    const sections = coerceContentSections(content)
        .filter((section) => section && typeof section === 'object' && !Array.isArray(section))
        .map((section, sectionIndex) => {
            const questions = (Array.isArray(section?.questions) ? section.questions : [])
                .filter((question) => question && typeof question === 'object' && !Array.isArray(question))
                .map((question, questionIndex) => ({
                    id: cleanString(question.id) || `q${sectionIndex + 1}-${questionIndex + 1}`,
                    type: cleanString(question.type),
                    title: cleanString(question.title),
                    answer: extractQuestionAnswer(question),
                }))

            return {
                id: cleanString(section?.id) || `s${sectionIndex + 1}`,
                title: cleanString(section?.title) || (sectionIndex === 0 ? cleanString(title) : ''),
                questions,
            }
        })

    return sections
}

/**
 * Flatten a normalised submission into the answered questions, in form order.
 * Returns [{ section, question, type, answer, fieldId, fieldLabel }].
 */
export function buildFormFieldList(content, { title = '' } = {}) {
    const sections = normalizeFormContent(content, { title })

    return sections.flatMap((section) => section.questions
        .filter((question) => !isEmptyAnswer(question.answer))
        .map((question) => {
            const fieldId = resolveQuestionFieldId(question.title, section.title)
            return {
                section: section.title,
                question: question.title,
                type: question.type,
                answer: question.answer,
                fieldId,
                fieldLabel: fieldId ? resolveFieldLabel(fieldId, question.title) : question.title,
            }
        }))
}

function resolveFieldLabel(fieldId, fallbackTitle) {
    return INTAKE_FIELD_LABELS[fieldId] || cleanString(fallbackTitle)
}

/**
 * Resolve the canonical intake field a question belongs to, or null when the
 * question is not part of the app's intake schema.
 */
export function resolveQuestionFieldId(questionTitle, sectionTitle = '') {
    const key = normalizeQuestionKey(questionTitle)
    if (!key) return null

    if (normalizeQuestionKey(sectionTitle).includes('referrer')) {
        const referrerField = REFERRER_QUESTION_ALIASES.get(key)
        if (referrerField) return referrerField
    }

    const patientField = PATIENT_QUESTION_ALIASES.get(key)
    if (patientField) return patientField

    return EXTRA_QUESTION_FIELDS[key] || null
}

/**
 * Project a submission's answers onto the app's intake field ids.
 * Returns { answers, labelledAnswers, matchedFields }.
 */
export function buildFormIntakeAnswers(content, { title = '' } = {}) {
    const answers = {}
    const labelledAnswers = {}
    const matchedFields = []

    buildFormFieldList(content, { title }).forEach((entry) => {
        if (!entry.fieldId) return
        if (Object.prototype.hasOwnProperty.call(answers, entry.fieldId)) return

        answers[entry.fieldId] = entry.answer
        labelledAnswers[entry.fieldLabel] = entry.answer
        matchedFields.push(entry.fieldId)
    })

    return { answers, labelledAnswers, matchedFields }
}
// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

export const FORM_COLUMN_KEYS = [
    'external_id',
    'external_source',
    'title',
    'submitted_message',
    'submitted_at',
    'patient_id',
    'patient_name',
    'external_patient_id',
    'archived',
    'content',
    'answers',
    'labelled_answers',
    'metadata',
]

export function isEmptyAnswer(value) {
    if (value === null || value === undefined) return true
    if (typeof value === 'string') return value.trim() === ''
    if (Array.isArray(value)) return value.length === 0
    if (typeof value === 'object') return Object.values(value).every((entry) => isEmptyAnswer(entry))
    return false
}

// Maps both the raw export headers and friendlier header names onto the
// canonical form field names. Keys are the output of `normalizeCsvHeader`.
const CSV_HEADER_ALIASES = new Map([
    ['id', 'external_id'],
    ['form id', 'external_id'],
    ['external id', 'external_id'],
    ['submission id', 'external_id'],
    ['title', 'title'],
    ['form title', 'title'],
    ['form', 'title'],
    ['content', 'content'],
    ['form content', 'content'],
    ['submitted message', 'submitted_message'],
    ['submission message', 'submitted_message'],
    ['submitted at', 'submitted_at'],
    // The reference export spells this header with a triple "t".
    ['submittted at', 'submitted_at'],
    ['submitted', 'submitted_at'],
    ['patient name', 'patient_name'],
    ['client name', 'patient_name'],
    ['patient', 'patient_name'],
    ['patient id', 'external_patient_id'],
    ['client id', 'external_patient_id'],
    ['archived', 'archived'],
])

function lookupHeaderAlias(rawHeader) {
    return CSV_HEADER_ALIASES.get(normalizeCsvHeader(rawHeader)) || null
}

/**
 * Parse a CSV document into form-shaped records.
 * Returns { records, unknownHeaders, rowCount }.
 */
export function parseFormCsv(text) {
    const rows = parseCsv(text)
    if (rows.length === 0) {
        return { records: [], unknownHeaders: [], rowCount: 0 }
    }

    const [headerRow, ...dataRows] = rows
    const columnMap = []
    const unknownHeaders = []
    const seenHeaders = new Set()

    headerRow.forEach((rawHeader) => {
        const canonicalMatch = lookupHeaderAlias(rawHeader)
        columnMap.push(canonicalMatch || null)
        const label = cleanString(rawHeader)
        if (!canonicalMatch && label && !seenHeaders.has(label)) {
            seenHeaders.add(label)
            unknownHeaders.push(label)
        }
    })

    const records = dataRows.map((cells, index) => {
        const raw = {}
        columnMap.forEach((canonicalHeader, columnIndex) => {
            if (!canonicalHeader) return
            raw[canonicalHeader] = cells[columnIndex]
        })
        return { rowNumber: index + 2, raw }
    })

    return { records, unknownHeaders, rowCount: dataRows.length }
}

/**
 * Normalise the raw CSV cells into the canonical form record shape.
 */
export function normalizeFormRecord(raw) {
    const title = cleanNullableString(raw?.title, 255)
    const content = normalizeFormContent(raw?.content, { title: title || '' })
    const { answers, labelledAnswers } = buildFormIntakeAnswers(content, { title: title || '' })

    return {
        external_id: cleanNullableString(raw?.external_id, 120),
        external_source: cleanNullableString(raw?.external_source, 64),
        title,
        submitted_message: cleanOptionalText(raw?.submitted_message),
        submitted_at: parseTimestamp(raw?.submitted_at),
        patient_name: cleanNullableString(raw?.patient_name, 255),
        external_patient_id: cleanNullableString(raw?.external_patient_id, 120),
        archived: toBool(raw?.archived),
        content,
        answers,
        labelled_answers: labelledAnswers,
    }
}

function countAnsweredQuestions(content) {
    return (Array.isArray(content) ? content : [])
        .reduce((total, section) => total + (Array.isArray(section?.questions)
            ? section.questions.filter((question) => !isEmptyAnswer(question?.answer)).length
            : 0), 0)
}

/**
 * Provenance for the external submission, kept in the `metadata` column.
 */
export function buildFormProvenance(record, { source = DEFAULT_EXTERNAL_SOURCE } = {}) {
    const normalizedSource = cleanString(source).toLowerCase() || DEFAULT_EXTERNAL_SOURCE

    return {
        sploseForm: {
            externalId: record.external_id,
            externalSource: normalizedSource,
            title: record.title || null,
            submittedAt: record.submitted_at || null,
            submittedMessage: record.submitted_message || null,
            archived: record.archived === true,
            questionCount: (Array.isArray(record.content) ? record.content : [])
                .reduce((total, section) => total + (Array.isArray(section?.questions) ? section.questions.length : 0), 0),
            answeredCount: countAnsweredQuestions(record.content),
            matchedFields: Object.keys(record.answers || {}),
        },
    }
}

/**
 * Turn one parsed CSV row into the form shape used by the create/update paths
 * of the import pipeline.
 */
export function mapCsvRowToForm(raw, { source = DEFAULT_EXTERNAL_SOURCE } = {}) {
    const normalizedSource = cleanString(source).toLowerCase().slice(0, 64) || DEFAULT_EXTERNAL_SOURCE
    const record = normalizeFormRecord({ ...raw, external_source: normalizedSource })

    return {
        ...record,
        external_source: normalizedSource,
        patient_id: null,
        metadata: buildFormProvenance(record, { source: normalizedSource }),
    }
}

/**
 * Merge an imported metadata projection over the metadata already stored on a
 * form row. Untouched keys are preserved.
 */
export function mergeFormMetadata(existing, incoming) {
    const base = parseMetadataValue(existing) || {}
    if (!incoming || typeof incoming !== 'object') return base

    return {
        ...base,
        sploseForm: {
            ...(parseMetadataValue(base.sploseForm) || {}),
            ...(parseMetadataValue(incoming.sploseForm) || {}),
        },
    }
}

// ---------------------------------------------------------------------------
// Patient intake enrichment
// ---------------------------------------------------------------------------

/**
 * Copy the submission's answers onto a patient's intake metadata.
 *
 * Only blanks are filled, so importing historical submissions never overwrites
 * answers a clinician has already reviewed or edited. Returns
 * { metadata, filledAnswers, filledLabels, changed }.
 */
export function applyFormAnswersToPatientMetadata(existingMetadata, {
    answers,
    labelledAnswers,
    form = {},
    source = DEFAULT_EXTERNAL_SOURCE,
} = {}) {
    const base = parseMetadataValue(existingMetadata) || {}
    const storedAnswers = parseMetadataValue(base.sploseAnswers) || {}
    const storedLabels = parseMetadataValue(base.sploseLabelledAnswers) || {}

    const nextAnswers = { ...storedAnswers }
    const nextLabels = { ...storedLabels }
    const filledAnswers = []
    const filledLabels = []

    Object.entries(answers && typeof answers === 'object' ? answers : {}).forEach(([fieldId, value]) => {
        if (isEmptyAnswer(value) || !isEmptyAnswer(storedAnswers[fieldId])) return
        nextAnswers[fieldId] = value
        filledAnswers.push(fieldId)
    })

    Object.entries(labelledAnswers && typeof labelledAnswers === 'object' ? labelledAnswers : {}).forEach(([label, value]) => {
        if (isEmptyAnswer(value) || !isEmptyAnswer(storedLabels[label])) return
        nextLabels[label] = value
        filledLabels.push(label)
    })

    if (filledAnswers.length === 0 && filledLabels.length === 0) {
        return { metadata: base, filledAnswers, filledLabels, changed: false }
    }

    return {
        metadata: {
            ...base,
            sploseAnswers: nextAnswers,
            sploseLabelledAnswers: nextLabels,
            sploseFormIntake: {
                source: cleanString(source).toLowerCase() || DEFAULT_EXTERNAL_SOURCE,
                externalId: cleanString(form.externalId) || null,
                title: cleanString(form.title) || null,
                submittedAt: formatTimestampValue(form.submittedAt),
                filledFields: [...filledAnswers, ...filledLabels],
            },
        },
        filledAnswers,
        filledLabels,
        changed: true,
    }
}

// ---------------------------------------------------------------------------
// Payload validation
// ---------------------------------------------------------------------------

const MUTABLE_FIELD_VALIDATORS = {
    external_id: (value) => cleanNullableString(value, 120),
    external_source: (value) => cleanString(value).toLowerCase().slice(0, 64) || DEFAULT_EXTERNAL_SOURCE,
    title: (value) => cleanNullableString(value, 255),
    submitted_message: (value) => cleanOptionalText(value),
    submitted_at: (value) => parseTimestamp(value),
    patient_id: (value) => validateId(value),
    patient_name: (value) => cleanNullableString(value, 255),
    external_patient_id: (value) => cleanNullableString(value, 120),
    archived: (value) => toBool(value),
}

/**
 * Validate + normalise the mutable form fields present in a payload.
 * Returns { updates, errors } where each update is { key, value }.
 */
export function resolveFormUpdates(payload) {
    const updates = []
    const errors = []

    Object.keys(MUTABLE_FIELD_VALIDATORS).forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(payload || {}, key)) return
        updates.push({ key, value: MUTABLE_FIELD_VALIDATORS[key](payload[key]) })
    })

    if (Object.prototype.hasOwnProperty.call(payload || {}, 'content')) {
        const content = normalizeFormContent(payload.content, { title: cleanString(payload?.title) })
        const { answers, labelledAnswers } = buildFormIntakeAnswers(content, { title: cleanString(payload?.title) })
        updates.push({ key: 'content', value: content })
        updates.push({ key: 'answers', value: answers })
        updates.push({ key: 'labelled_answers', value: labelledAnswers })
    }

    if (Object.prototype.hasOwnProperty.call(payload || {}, 'metadata')) {
        const metadata = payload.metadata
        if (metadata !== null && (typeof metadata !== 'object' || Array.isArray(metadata))) {
            errors.push('metadata must be an object or null')
        } else {
            updates.push({ key: 'metadata', value: metadata })
        }
    }

    return { updates, errors }
}

/**
 * Build the list/detail SELECT.
 *
 * `compact` drops the (potentially large) `content` column for callers that
 * only need a summary - the dashboard card, for example.
 */
export function buildFormSelect({ compact = false } = {}) {
    return `
        SELECT
            f.id, f.domain, f.external_id, f.external_source, f.title,
            f.submitted_message,
            ${timestampExpr('f.submitted_at')} AS submitted_at,
            f.patient_id, f.patient_name, f.external_patient_id,
            f.archived, ${compact ? 'NULL AS content' : 'f.content'}, f.answers,
            f.labelled_answers, f.metadata,
            f.created_at, f.updated_at,
            pt.patient_name AS linked_patient_name
        FROM forms f
        LEFT JOIN patients pt ON pt.id = f.patient_id AND pt.domain = f.domain
    `
}

export function normalizeFormRow(row) {
    if (!row || typeof row !== 'object') return row
    return {
        ...row,
        submitted_at: formatTimestampValue(row.submitted_at),
        archived: row.archived === true || toBool(row.archived),
        content: parseMetadataValue(row.content) || [],
        answers: parseMetadataValue(row.answers) || {},
        labelled_answers: parseMetadataValue(row.labelled_answers) || {},
        metadata: parseMetadataValue(row.metadata),
    }
}

// ---------------------------------------------------------------------------
// Diffing
// ---------------------------------------------------------------------------

function sortKeys(value) {
    if (Array.isArray(value)) return value.map(sortKeys)
    if (value && typeof value === 'object') {
        return Object.keys(value).sort().reduce((acc, key) => {
            acc[key] = sortKeys(value[key])
            return acc
        }, {})
    }
    return value
}

function serializeJsonValue(value) {
    const parsed = typeof value === 'object' && value !== null ? value : parseMetadataValue(value)
    if (!parsed) return ''
    return JSON.stringify(sortKeys(parsed))
}

function normalizeComparableValue(key, value) {
    if (key === 'metadata' || key === 'content' || key === 'answers' || key === 'labelled_answers') {
        return serializeJsonValue(value)
    }
    if (key === 'submitted_at') {
        return parseTimestamp(value) || ''
    }
    if (key === 'patient_id') {
        const id = validateId(value)
        return id === null ? '' : String(id)
    }
    if (key === 'archived') {
        return toBool(value) ? 'true' : 'false'
    }
    return cleanString(value)
}

/**
 * Compare an incoming form field set with a stored row. Only changed fields are
 * returned, so a repeat import does not touch unchanged rows (and therefore
 * does not bump updated_at).
 */
export function diffFormFields(existing, incoming) {
    const changed = []

    FORM_COLUMN_KEYS.forEach((key) => {
        const stored = normalizeComparableValue(key, existing?.[key])
        const next = normalizeComparableValue(key, incoming?.[key])
        if (stored !== next) {
            changed.push({ key, value: incoming?.[key] === undefined ? null : incoming[key] })
        }
    })

    return changed
}
