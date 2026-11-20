// Stored participant data -> NDIS FCA builder steps.
//
// The intake form answers live on the participant record at `metadata.sploseAnswers` (with question
// titles mirrored in `metadata.sploseLabelledAnswers`), and the Splose patient export adds a few
// more at `metadata.splosePatient`. Before this module only six of the twenty stored answers ever
// reached the builder: the participant name, NDIS number, date of birth, address, plan manager email
// (via a stale `answers.plan_manager` lookup, so in practice it never matched) and, since the goals
// work, the NDIS goals.
//
// This is the single catalogue for the rest. It exists so the builder can prefill the earlier steps,
// show where each value came from, and let the clinician include/exclude or rewrite a source before
// it becomes LLM context.
//
// Every source is one of two sensitivity classes:
//   identity - never sent to the model. Shown to the clinician for reference, and used to
//              de-identify other text (names, dates, numbers) before it reaches the model.
//   clinical - eligible for the model, subject to the clinician's include/exclude choice.
//
// Browser-safe by design (no `@/` aliases) so `node --test` can import it directly, matching the
// `fcaIntakeGoals.js` / `fcaAttachments.js` precedent.

import { extractIntakeGoals } from './fcaIntakeGoals.js'

export const PARTICIPANT_SOURCE_SENSITIVITY = {
    IDENTITY: 'identity',
    CLINICAL: 'clinical',
}

export const PARTICIPANT_SOURCE_PROVENANCE = {
    INTAKE: 'Intake form',
    PATIENT: 'Patient record',
}

/**
 * Catalogue of stored participant answers the builder can use.
 *
 * - `step` is the 1-based builder step (see `STEPS` in NDISFCAReportBuilder.jsx).
 * - `field` is the builder form field the value prefills; sources without one are reference-only
 *   (the clinician sees them, the field they belong to is free text).
 * - `keys` are `metadata.sploseAnswers` keys, `labels` are `metadata.sploseLabelledAnswers` keys.
 * - `combine` lists answer keys that are joined into one value.
 */
const SOURCE_DEFS = [
    {
        id: 'participant_name',
        step: 2,
        field: 'participantName',
        label: 'Participant name',
        sensitivity: PARTICIPANT_SOURCE_SENSITIVITY.IDENTITY,
        keys: ['patient_full_name'],
        labels: ['Full name', 'Patient full name'],
    },
    {
        id: 'ndis_number',
        step: 2,
        field: 'ndisNumber',
        label: 'NDIS number',
        sensitivity: PARTICIPANT_SOURCE_SENSITIVITY.IDENTITY,
        keys: ['claim_or_reference_number'],
        labels: ['NDIS number', 'NDIS number/ TAC Claim Number/Work Cover Reference Number'],
    },
    {
        id: 'date_of_birth',
        step: 2,
        field: 'dateOfBirth',
        label: 'Date of birth',
        sensitivity: PARTICIPANT_SOURCE_SENSITIVITY.IDENTITY,
        keys: ['date_of_birth'],
        labels: ['Date of birth'],
    },
    {
        id: 'address',
        step: 2,
        field: 'address',
        label: 'Address',
        sensitivity: PARTICIPANT_SOURCE_SENSITIVITY.IDENTITY,
        keys: ['address'],
        labels: ['Address'],
    },
    {
        id: 'participant_phone',
        step: 2,
        label: 'Participant phone',
        sensitivity: PARTICIPANT_SOURCE_SENSITIVITY.IDENTITY,
        keys: ['client_phone'],
        labels: ['Client Phone'],
    },
    {
        id: 'funding_type',
        step: 2,
        field: 'fundingSource',
        label: 'Funding source',
        sensitivity: PARTICIPANT_SOURCE_SENSITIVITY.CLINICAL,
        keys: ['funding_source_or_referral_type'],
        labels: ['Funding Source or Referral Type'],
    },
    {
        id: 'plan_manager_email',
        step: 2,
        field: 'planManager',
        label: 'Plan manager',
        sensitivity: PARTICIPANT_SOURCE_SENSITIVITY.IDENTITY,
        keys: ['plan_manager_email'],
        labels: ['Plan Manager Email Address'],
    },
    {
        id: 'support_coordinator_assigned',
        step: 2,
        field: 'supportCoordinator',
        label: 'Support coordinator',
        sensitivity: PARTICIPANT_SOURCE_SENSITIVITY.CLINICAL,
        keys: ['ndis_support_coordinator_assigned'],
        labels: ['Has an NDIS support coordinator been assigned'],
    },
    {
        id: 'support_coordinator_contact',
        step: 2,
        label: 'Support coordinator contact',
        sensitivity: PARTICIPANT_SOURCE_SENSITIVITY.IDENTITY,
        keys: [
            'ndis_support_coordinator_name',
            'ndis_support_coordinator_phone',
            'ndis_support_coordinator_email',
        ],
        labels: [
            'NDIS support coordinator name',
            'NDIS support coordinator phone number',
            'NDIS support coordinator email',
        ],
        combine: true,
    },
    {
        id: 'interpreter_required',
        step: 2,
        field: 'interpreterRequired',
        label: 'Interpreter required',
        sensitivity: PARTICIPANT_SOURCE_SENSITIVITY.CLINICAL,
        keys: ['interpreter_required'],
        labels: ['Is an interpreter required'],
    },
    {
        id: 'referral_reasons',
        step: 3,
        field: 'backgroundSummary',
        label: 'Reasons for referral to OT',
        sensitivity: PARTICIPANT_SOURCE_SENSITIVITY.CLINICAL,
        keys: ['reasons_for_referral_to_ot'],
        labels: ['Reasons for Referral to OT'],
    },
    {
        id: 'accident_date',
        step: 3,
        field: 'accidentDate',
        label: 'Accident date',
        sensitivity: PARTICIPANT_SOURCE_SENSITIVITY.CLINICAL,
        keys: ['accident_date_if_tac'],
        labels: ['Accident date (if TAC)'],
    },
    {
        id: 'referrer_role',
        step: 3,
        field: 'referrerRelationship',
        label: 'Referrer relationship',
        sensitivity: PARTICIPANT_SOURCE_SENSITIVITY.CLINICAL,
        keys: ['referrer_relationship'],
        labels: ['Referrer relationship'],
    },
    {
        id: 'referrer_contact',
        step: 3,
        label: 'Referrer contact',
        sensitivity: PARTICIPANT_SOURCE_SENSITIVITY.IDENTITY,
        keys: ['referrer_full_name', 'referrer_phone'],
        labels: ['Referrer full name', 'Referrer phone number'],
        combine: true,
    },
    {
        id: 'diagnosis_note',
        step: 5,
        field: 'diagnosisSummary',
        label: 'Other important information (diagnosis)',
        sensitivity: PARTICIPANT_SOURCE_SENSITIVITY.CLINICAL,
        keys: ['other_important_information'],
        labels: ['Any other important information'],
    },
    {
        id: 'ndis_goals',
        step: 7,
        field: 'goals',
        label: 'NDIS goals',
        sensitivity: PARTICIPANT_SOURCE_SENSITIVITY.CLINICAL,
        special: 'goals',
    },
    {
        id: 'booking_contact',
        step: 8,
        label: 'Booking contact',
        sensitivity: PARTICIPANT_SOURCE_SENSITIVITY.IDENTITY,
        keys: ['booking_contact'],
        labels: ['Who should be contacted to make the appointment'],
    },
]

function safeObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function cleanText(value) {
    return String(value ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim()
}

// Answers are usually strings, but structured questions (address) arrive as objects, and Splose
// exports some answers as arrays. Anything stringified blindly becomes "[object Object]".
function formatAnswerValue(value) {
    if (value === null || value === undefined) return ''
    if (typeof value === 'string' || typeof value === 'number') return cleanText(value)
    if (Array.isArray(value)) {
        return value.map((entry) => formatAnswerValue(entry)).filter(Boolean).join(', ')
    }
    if (typeof value !== 'object') return ''

    const parts = [
        // Both spellings appear in the wild: the intake export uses `addressL1`, the app's own
        // normaliser uses `addressLine1`.
        value.addressL1 || value.addressLine1 || value.line1 || value.street,
        value.city || value.suburb || value.town,
        value.state || value.region,
        value.postalCode || value.postcode || value.zip,
        value.country,
    ]
        .map((part) => cleanText(part))
        .filter(Boolean)
    if (parts.length > 0) return parts.join(', ')

    // Unknown shape: join the primitive leaves rather than losing the answer.
    return Object.values(value)
        .filter((entry) => typeof entry === 'string' || typeof entry === 'number')
        .map((entry) => cleanText(entry))
        .filter(Boolean)
        .join(', ')
}

function readAnswer({ answers, labels, splosePatient, metadata }, keys = [], labelKeys = []) {
    for (const key of keys) {
        const direct = formatAnswerValue(answers[key] ?? splosePatient[key] ?? metadata[key])
        if (direct) return direct
    }
    // The intake question title is the stable key when the answer id is missing (or was renamed).
    for (const label of labelKeys) {
        const direct = formatAnswerValue(labels[label])
        if (direct) return direct
    }

    const wanted = new Set([...keys, ...labelKeys].map((entry) => normalizeAnswerKey(entry)))
    for (const [key, value] of Object.entries({ ...answers, ...labels })) {
        if (!wanted.has(normalizeAnswerKey(key))) continue
        const direct = formatAnswerValue(value)
        if (direct) return direct
    }
    return ''
}

function normalizeAnswerKey(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

/**
 * Resolve every stored participant source that actually has a value.
 *
 * @returns {Array<{ id: string, step: number, field: string|null, label: string, sensitivity: string,
 *   provenance: string, text: string, values: string[] }>}
 */
export function buildParticipantSources(patient) {
    const source = safeObject(patient)
    const metadata = safeObject(source.metadata)
    const context = {
        answers: safeObject(metadata.sploseAnswers),
        labels: safeObject(metadata.sploseLabelledAnswers),
        splosePatient: safeObject(metadata.splosePatient),
        metadata,
    }

    const rows = []
    for (const def of SOURCE_DEFS) {
        let values = []

        if (def.special === 'goals') {
            values = extractIntakeGoals(source)
        } else if (def.combine) {
            values = def.keys
                .map((key, index) => readAnswer(context, [key], [def.labels?.[index]].filter(Boolean)))
                .filter(Boolean)
        } else {
            const value = readAnswer(context, def.keys, def.labels)
            values = value ? [value] : []
        }

        if (values.length === 0) continue

        const text = def.special === 'goals' ? values.map((goal) => `- ${goal}`).join('\n') : values.join(' · ')
        rows.push({
            id: def.id,
            step: def.step,
            field: def.field || null,
            label: def.label,
            sensitivity: def.sensitivity,
            provenance: PARTICIPANT_SOURCE_PROVENANCE.INTAKE,
            text,
            values,
        })
    }

    // The participant name falls back to the patient row itself, which is where an imported record
    // keeps it when the intake answer is missing.
    const hasName = rows.some((row) => row.id === 'participant_name')
    const patientName = cleanText(source.patient_name || metadata.patientName)
    if (!hasName && patientName) {
        rows.unshift({
            id: 'participant_name',
            step: 2,
            field: 'participantName',
            label: 'Participant name',
            sensitivity: PARTICIPANT_SOURCE_SENSITIVITY.IDENTITY,
            provenance: PARTICIPANT_SOURCE_PROVENANCE.PATIENT,
            text: patientName,
            values: [patientName],
        })
    }

    return rows.sort((a, b) => a.step - b.step || a.label.localeCompare(b.label))
}

export function participantSourcesForStep(rows, step) {
    const target = Number(step)
    return (Array.isArray(rows) ? rows : []).filter((row) => Number(row.step) === target)
}

/**
 * Selection shape stored on the builder form:
 *   participantSources = { excludedIds: string[], overrides: { [id]: string } }
 *
 * Mirrors `transcriptSelection` (see fcaTranscriptSelection.js) so both steps behave the same way.
 */
export function normalizeParticipantSourceSelection(raw) {
    const source = safeObject(raw)
    const excludedIds = (Array.isArray(source.excludedIds) ? source.excludedIds : [])
        .map((id) => String(id ?? '').trim())
        .filter(Boolean)

    const overrides = {}
    const rawOverrides = safeObject(source.overrides)
    for (const [key, value] of Object.entries(rawOverrides)) {
        const id = String(key || '').trim()
        const text = cleanText(value)
        if (id && text) overrides[id] = text
    }

    return { excludedIds: [...new Set(excludedIds)], overrides }
}

export function isParticipantSourceIncluded(selection, id) {
    const { excludedIds } = normalizeParticipantSourceSelection(selection)
    return !excludedIds.includes(String(id || '').trim())
}

export function setParticipantSourceIncluded(selection, id, included) {
    const normalized = normalizeParticipantSourceSelection(selection)
    const key = String(id || '').trim()
    if (!key) return normalized

    const excluded = new Set(normalized.excludedIds)
    if (included) excluded.delete(key)
    else excluded.add(key)

    return { ...normalized, excludedIds: [...excluded] }
}

export function setParticipantSourceOverride(selection, id, text) {
    const normalized = normalizeParticipantSourceSelection(selection)
    const key = String(id || '').trim()
    if (!key) return normalized

    const overrides = { ...normalized.overrides }
    const value = cleanText(text)
    if (value) overrides[key] = value
    else delete overrides[key]

    return { ...normalized, overrides }
}

/** The text actually used for a row, after any clinician rewrite. */
export function resolveParticipantSourceText(row, selection) {
    if (!row) return ''
    const { overrides } = normalizeParticipantSourceSelection(selection)
    const override = overrides[String(row.id || '').trim()]
    return override !== undefined ? override : cleanText(row.text)
}

/**
 * Group the included clinical sources for the model, in builder step order, with the clinician's
 * rewrites applied. Identity sources are never returned here - they are not model input.
 *
 * @returns {Array<{ id: string, step: number, label: string, text: string }>}
 */
export function buildParticipantContextSources(rows, selection) {
    return (Array.isArray(rows) ? rows : [])
        .filter((row) => row.sensitivity === PARTICIPANT_SOURCE_SENSITIVITY.CLINICAL)
        .filter((row) => isParticipantSourceIncluded(selection, row.id))
        .map((row) => ({
            id: row.id,
            step: row.step,
            label: row.label,
            text: resolveParticipantSourceText(row, selection),
        }))
        .filter((row) => Boolean(row.text))
}

export function buildParticipantContextText(rows, selection) {
    return buildParticipantContextSources(rows, selection)
        .map((row) => `${row.label}: ${row.text}`)
        .join('\n')
}

export function buildParticipantSourceSelectionSummary(rows, selection) {
    const clinical = (Array.isArray(rows) ? rows : [])
        .filter((row) => row.sensitivity === PARTICIPANT_SOURCE_SENSITIVITY.CLINICAL)
    const included = clinical.filter((row) => isParticipantSourceIncluded(selection, row.id))
    const identity = (Array.isArray(rows) ? rows : [])
        .filter((row) => row.sensitivity === PARTICIPANT_SOURCE_SENSITIVITY.IDENTITY)

    return {
        clinicalTotal: clinical.length,
        includedTotal: included.length,
        excludedTotal: clinical.length - included.length,
        identityTotal: identity.length,
    }
}

/**
 * Identity values that must not reach the model, in the shape the de-identifier expects.
 * The builder passes these to the worker as the participant identity block; the worker uses them to
 * strip the same values out of notes and transcripts (where a bare first name is common) instead of
 * relying on pattern matching alone.
 */
export function buildParticipantIdentityBlock(rows, patient, selection) {
    const byId = new Map((Array.isArray(rows) ? rows : []).map((row) => [row.id, row]))
    const text = (id) => {
        const row = byId.get(id)
        return row ? resolveParticipantSourceText(row, selection) : ''
    }

    const source = safeObject(patient)
    const metadata = safeObject(source.metadata)
    const answers = safeObject(metadata.sploseAnswers)
    const labels = safeObject(metadata.sploseLabelledAnswers)

    const participantName = text('participant_name') || cleanText(source.patient_name || metadata.patientName)
    const people = []

    const pushPerson = (name, role) => {
        const cleanName = cleanText(name)
        // Roles are compared case-insensitively: the referrer relationship answer is capitalised
        // ("Support Coordinator") while the derived role is not, and the same person can arrive
        // through both the support-coordinator and the referrer answers.
        const cleanRole = cleanText(role).toLowerCase()
        if (!cleanName || !cleanRole) return
        if (people.some((person) => person.name.toLowerCase() === cleanName.toLowerCase() && person.role === cleanRole)) return
        people.push({ name: cleanName, role: cleanRole })
    }

    // "Mary, Justin's wife." -> Mary is the participant's wife.
    const bookingContact = text('booking_contact') || readAnswer({
        answers,
        labels,
        splosePatient: safeObject(metadata.splosePatient),
        metadata,
    }, ['booking_contact'], ['Who should be contacted to make the appointment'])
    const bookingMatch = bookingContact.match(/^([^,]+),\s*[^,]*?'s?\s+([a-z][a-z\s]{2,20})\.?$/i)
    if (bookingMatch) pushPerson(bookingMatch[1], `participant's ${cleanText(bookingMatch[2]).toLowerCase()}`)

    const coordinatorContact = text('support_coordinator_contact')
    if (coordinatorContact) {
        const name = coordinatorContact.split('·')[0]
        pushPerson(name, 'support coordinator')
    }
    const referrerContact = text('referrer_contact')
    if (referrerContact) {
        const name = referrerContact.split('·')[0]
        pushPerson(name, text('referrer_role') || 'referrer')
    }

    const emails = []
    const pushEmail = (email, role) => {
        const value = cleanText(email).match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0] || ''
        if (!value) return
        if (emails.some((entry) => entry.value.toLowerCase() === value.toLowerCase())) return
        emails.push({ value, role: cleanText(role).toLowerCase() })
    }
    pushEmail(text('plan_manager_email'), 'plan manager')
    pushEmail(coordinatorContact, 'support coordinator')
    pushEmail(referrerContact, text('referrer_role') || 'referrer')

    return {
        participantName,
        dateOfBirth: text('date_of_birth'),
        ndisNumber: text('ndis_number'),
        address: text('address'),
        phone: text('participant_phone'),
        emails,
        people,
    }
}
