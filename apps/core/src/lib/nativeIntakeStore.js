// Persistence for the native intake option: settings, the published form
// definition, and submissions.
//
// A submission is written to the `forms` table with `external_source = 'native'`
// so the admin Forms list, the patient Forms tab and Intake Data treat it exactly
// like an imported Splose form — the difference is only provenance.

import { deleteDomainSetting, getDomainSetting, setDomainSetting } from '@/lib/appSettings'
import { readDomainPracticeName } from '@/lib/domainPracticeName'
import { ensureFormsTable } from '@/lib/formsTable'
import { ensurePatientsImportSchema } from '@/lib/patientsTable'
import { recordActivity } from '@/lib/activities'
import { queueEmail } from '@/lib/emailQueueClient'
import { phoneMatchKey } from '@/lib/appointmentMessaging'
import { VALID_DOMAIN_MODES, resolveDomainModeFromHeaders } from '@/lib/domainMode'
import {
    applyFormAnswersToPatientMetadata,
    buildFormIntakeAnswers,
    cleanString,
} from '@/lib/forms'
import {
    DEFAULT_NATIVE_INTAKE_FORM,
    NATIVE_EXTERNAL_SOURCE,
    buildIntakeNotificationEmail,
    buildIntakeReference,
    buildNativeIntakeContent,
    defaultIntakeSettingsForDomain,
    mergeIntakeSettings,
    normalizeIntakeSettings,
    normalizeNativeIntakeForm,
} from '@/lib/nativeIntake'

function normalizeDomainKey(value) {
    const normalized = String(value || '').trim().toLowerCase()
    return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized) ? normalized : ''
}

/** Public domain for an intake request: the hostname decides, `?domain=` is a preview aid. */
export function resolvePublicIntakeDomain(request, requestedDomain) {
    const explicit = normalizeDomainKey(requestedDomain)
    if (explicit && VALID_DOMAIN_MODES.includes(explicit)) return explicit
    return resolveDomainModeFromHeaders(request.headers)
}

export async function readIntakeSettings(domain) {
    const key = normalizeDomainKey(domain)
    if (!key) return normalizeIntakeSettings({})
    const entry = await getDomainSetting(key, 'intake_settings')
    return normalizeIntakeSettings({ ...defaultIntakeSettingsForDomain(key), ...(entry || {}) })
}

export async function saveIntakeSettings(domain, patch) {
    const key = normalizeDomainKey(domain)
    if (!key) throw new Error('A domain is required')

    // Seed from the domain default so a partial patch cannot silently switch a
    // domain back to the Splose embed.
    const stored = await getDomainSetting(key, 'intake_settings')
    const current = mergeIntakeSettings(defaultIntakeSettingsForDomain(key), stored)
    const next = mergeIntakeSettings(current, patch)
    await setDomainSetting(key, 'intake_settings', next)
    return next
}

export async function readNativeIntakeForm(domain) {
    const key = normalizeDomainKey(domain)
    const entry = key ? await getDomainSetting(key, 'native_intake_form') : null
    return normalizeNativeIntakeForm(entry || DEFAULT_NATIVE_INTAKE_FORM)
}

export async function saveNativeIntakeForm(domain, definition) {
    const key = normalizeDomainKey(domain)
    if (!key) throw new Error('A domain is required')

    const next = normalizeNativeIntakeForm(definition)
    await setDomainSetting(key, 'native_intake_form', next)
    return next
}

/** Remove a domain's edited definition so the shipped default applies again. */
export async function resetNativeIntakeForm(domain) {
    const key = normalizeDomainKey(domain)
    if (!key) throw new Error('A domain is required')

    await deleteDomainSetting(key, 'native_intake_form')
    return normalizeNativeIntakeForm(DEFAULT_NATIVE_INTAKE_FORM)
}

/**
 * Match an existing patient by email first, then by the last nine phone digits.
 * Only blanks are filled, so a later submission never overwrites reviewed data.
 */
async function findOrCreateIntakePatient(connection, { domain, name, email, phone }) {
    const normalizedEmail = cleanString(email).toLowerCase()
    const normalizedPhone = cleanString(phone)
    let patient = null

    if (normalizedEmail) {
        const result = await connection.query(
            `SELECT id, patient_name, metadata
             FROM patients
             WHERE domain = $1
               AND LOWER(COALESCE(metadata->>'email', metadata->'splosePatient'->>'email')) = $2
             ORDER BY id
             LIMIT 1`,
            [domain, normalizedEmail]
        )
        patient = result.rows?.[0] || null
    }

    if (!patient && normalizedPhone) {
        const key = phoneMatchKey(normalizedPhone)
        if (key) {
            const result = await connection.query(
                `SELECT id, patient_name, metadata
                 FROM patients
                 WHERE domain = $1
                   AND RIGHT(REGEXP_REPLACE(COALESCE(
                        metadata->>'phone',
                        metadata->'splosePatient'->>'mobile_phone',
                        metadata->'splosePatient'->>'phone',
                        ''
                   ), '\\D', '', 'g'), 9) = $2
                 ORDER BY id
                 LIMIT 1`,
                [domain, key]
            )
            patient = result.rows?.[0] || null
        }
    }

    const contact = {}
    if (normalizedEmail) contact.email = normalizedEmail
    if (normalizedPhone) contact.phone = normalizedPhone

    if (patient) return { id: Number(patient.id), patientName: patient.patient_name, metadata: patient.metadata, created: false }

    const inserted = await connection.query(
        `INSERT INTO patients (patient_name, domain, metadata, external_source)
         VALUES ($1, $2, $3::jsonb, 'native_intake')
         RETURNING id, patient_name, metadata`,
        [name || 'Unnamed client', domain, JSON.stringify({ ...contact, source: 'native_intake' })]
    )
    const row = inserted.rows?.[0]
    return {
        id: Number(row?.id),
        patientName: row?.patient_name || name,
        metadata: row?.metadata,
        created: true,
    }
}

/**
 * Store one native submission.
 *
 * Returns { id, reference, patientId, patientCreated, answers, filledFields }.
 */
export async function saveNativeIntakeSubmission(connection, {
    domain,
    definition,
    answers,
    contact = {},
    meta = {},
    actor = null,
}) {
    await ensureFormsTable()
    await ensurePatientsImportSchema()

    const content = buildNativeIntakeContent(definition, answers)
    const projection = buildFormIntakeAnswers(content, { title: definition?.title || '' })
    const patient = await findOrCreateIntakePatient(connection, {
        domain,
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
    })

    const submittedAt = new Date().toISOString()

    const inserted = await connection.query(
        `INSERT INTO forms (
            domain, external_source, title, submitted_at,
            patient_id, patient_name, content, answers, labelled_answers, metadata
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb)
         RETURNING id`,
        [
            domain,
            NATIVE_EXTERNAL_SOURCE,
            cleanString(definition?.title) || DEFAULT_NATIVE_INTAKE_FORM.title,
            submittedAt,
            patient.id,
            patient.patientName || contact.name || null,
            JSON.stringify(content),
            JSON.stringify(projection.answers),
            JSON.stringify(projection.labelledAnswers),
            JSON.stringify({ ...meta, submittedVia: 'native_intake' }),
        ]
    )
    const formId = Number(inserted.rows?.[0]?.id)
    const reference = buildIntakeReference(formId)

    // Fill any Intake Data blanks on the patient record.
    const applied = applyFormAnswersToPatientMetadata(patient.metadata, {
        answers: projection.answers,
        labelledAnswers: projection.labelledAnswers,
        form: {
            externalId: reference,
            title: cleanString(definition?.title) || null,
            submittedAt,
        },
        source: NATIVE_EXTERNAL_SOURCE,
    })
    if (applied.changed) {
        await connection.query(
            'UPDATE patients SET metadata = $2::jsonb, updated_at = NOW() WHERE id = $1 AND domain = $3',
            [patient.id, JSON.stringify(applied.metadata), domain]
        )
    }

    await recordActivity({
        domain,
        action: 'create',
        entityType: 'form',
        entityId: formId,
        entityLabel: `${cleanString(definition?.title) || 'Intake form'} ${reference}`.trim(),
        patientId: patient.id,
        patientName: patient.patientName || contact.name || null,
        summary: 'Native intake form submitted',
        metadata: { source: 'native_intake', reference, filledFields: projection.matchedFields },
        actor,
    }, { connection })

    return {
        id: formId,
        reference,
        patientId: patient.id,
        patientCreated: patient.created,
        submittedAt,
        answers: projection.answers,
        labelledAnswers: projection.labelledAnswers,
        filledFields: projection.matchedFields,
    }
}

/** Tell the practice about a new submission. Skipped until an address is configured. */
export async function sendIntakeNotification(connection, { domain, settings, submission, patientName }) {
    const toEmail = cleanString(settings?.notificationEmail)
    if (!toEmail) return { sent: false, reason: 'not_configured' }

    const practiceName = await readDomainPracticeName(domain).catch(() => domain)
    const message = buildIntakeNotificationEmail({
        reference: submission.reference,
        patientName,
        answers: submission.labelledAnswers,
        submittedAt: submission.submittedAt,
        practiceName,
    })

    try {
        const queued = await queueEmail(connection, {
            toEmail,
            category: 'intake-submission',
            subject: message.subject,
            text: message.text,
            html: message.text.split('\n').map((line) => (line ? `<p>${line}</p>` : '<br/>')).join(''),
            payload: {
                domain,
                formId: submission.id,
                patientId: submission.patientId,
                reference: submission.reference,
            },
        })
        return { sent: true, ...queued }
    } catch (error) {
        return { sent: false, reason: error?.message || 'queue_failed' }
    }
}
