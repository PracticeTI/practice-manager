import { normalizePatientAgents } from './patientPageConfig'
import { normalizeLookupText, normalizeObjectKeys, safeMetadata } from './patientUtils'

export function  resolvePatientNameField(fields) {
    const list = Array.isArray(fields) ? fields : []
    return list.find((field) => {
        const combined = normalizeLookupText(`${field?.label || ''} ${field?.id || ''}`)
        return combined.includes('patient') && combined.includes('name')
    }) || list.find((field) => normalizeLookupText(field?.label).includes('name')) || null
}

export function  resolveDobField(fields) {
    const list = Array.isArray(fields) ? fields : []
    return list.find((field) => {
        const combined = normalizeLookupText(`${field?.label || ''} ${field?.id || ''}`)
        return combined.includes('date of birth')
            || (combined.includes('dob') && !combined.includes('accident'))
    }) || null
}

export function  resolveSuburbField(fields) {
    const list = Array.isArray(fields) ? fields : []

    const directSuburbField = list.find((field) => {
        if (String(field?.type || '').toLowerCase() === 'address') return false
        const combined = normalizeLookupText(`${field?.label || ''} ${field?.id || ''}`)
        return combined.includes('suburb')
            || combined.includes('city town')
            || combined.includes('city')
    })
    if (directSuburbField) {
        return { fieldId: directSuburbField.id, addressKey: null }
    }

    const addressField = list.find((field) => String(field?.type || '').toLowerCase() === 'address')
    if (addressField) {
        return { fieldId: addressField.id, addressKey: 'city' }
    }

    return { fieldId: null, addressKey: null }
}

export function  getOverviewNameValue(fields, draft) {
    const nameField = resolvePatientNameField(fields)
    const value = nameField ? String(draft?.answers?.[nameField.id] || '').trim() : ''
    return value || String(draft?.patient_name || '').trim()
}

export function  getOverviewDobValue(fields, draft) {
    const dobField = resolveDobField(fields)
    if (!dobField) return ''
    return String(draft?.answers?.[dobField.id] || '').trim()
}

export function  getOverviewSuburbValue(fields, draft) {
    const suburbField = resolveSuburbField(fields)
    if (!suburbField?.fieldId) return ''

    if (suburbField.addressKey) {
        const address = normalizeAddressValue(draft?.answers?.[suburbField.fieldId])
        return String(address[suburbField.addressKey] || '').trim()
    }

    return String(draft?.answers?.[suburbField.fieldId] || '').trim()
}

export function  buildPatientMetadata({ draft, schemaFormUuid, schemaFields }) {
    // Note bodies live in the Notes entity now, so the legacy denormalised copy
    // is dropped here - a patient record must never carry a second, stale
    // version of a note.
    const {
        patientNotes: _legacyPatientNotes,
        patientDriveLinks: _legacyPatientDriveLinks,
        patientDriveCandidates: _legacyPatientDriveCandidates,
        patientDriveUnlinkedIds: _legacyPatientDriveUnlinkedIds,
        patientDriveLinkingStrategy: _legacyPatientDriveLinkingStrategy,
        ...rawMetadata
    } = safeMetadata(draft?.rawMetadata)

    return {
        // Keys this form does not own (for example the `splosePatient` payload
        // written by the CSV import) are carried through untouched.
        ...rawMetadata,
        sploseFormUuid: schemaFormUuid || null,
        sploseFields: schemaFields,
        sploseAnswers: draft.answers,
        sploseLabelledAnswers: buildLabelledAnswers(schemaFields, draft.answers),
        patientAgents: normalizePatientAgents(draft.agents),
    }
}

export function  createDraftSnapshot(draft) {
    if (!draft || typeof draft !== 'object') return ''

    const snapshot = {
        patient_name: String(draft.patient_name || '').trim(),
        answers: normalizeObjectKeys(draft.answers || {}),
        agents: normalizePatientAgents(draft.agents),
    }

    return JSON.stringify(snapshot)
}

export const  EMPTY_ADDRESS = {
    addressLine1: '',
    city: '',
    state: '',
    postalCode: '',
    country: '',
}

export function  normalizeAddressValue(value) {
    if (!value) {
        return { ...EMPTY_ADDRESS }
    }

    if (typeof value === 'string') {
        const text = String(value || '').trim()
        return {
            ...EMPTY_ADDRESS,
            addressLine1: text,
        }
    }

    if (typeof value !== 'object' || Array.isArray(value)) {
        return { ...EMPTY_ADDRESS }
    }

    return {
        addressLine1: String(value.addressLine1 || value.line1 || value.street || '').trim(),
        city: String(value.city || value.suburb || value.town || '').trim(),
        state: String(value.state || value.region || '').trim(),
        postalCode: String(value.postalCode || value.postcode || value.zip || '').trim(),
        country: String(value.country || '').trim(),
    }
}

export function  isAddressComplete(value) {
    const address = normalizeAddressValue(value)
    return Boolean(
        address.addressLine1 &&
        address.city &&
        address.state &&
        address.postalCode &&
        address.country
    )
}

export function  createBlankAnswers(fields) {
    return (Array.isArray(fields) ? fields : []).reduce((acc, field) => {
        const fieldId = String(field?.id || '').trim()
        if (!fieldId) return acc

        if (String(field?.type || '').toLowerCase() === 'address') {
            acc[fieldId] = { ...EMPTY_ADDRESS }
            return acc
        }

        acc[fieldId] = ''
        return acc
    }, {})
}

export function  tokenizeFilename(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .split(' ')
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
}

export function  scorePatientNameMatch(patientName, fileName) {
    const patientTokens = Array.from(new Set(tokenizeFilename(patientName)))
    if (patientTokens.length === 0) return 0

    const fileTokens = new Set(tokenizeFilename(fileName))
    if (fileTokens.size === 0) return 0

    let matched = 0
    for (const token of patientTokens) {
        if (fileTokens.has(token)) {
            matched += 1
        }
    }

    return matched / patientTokens.length
}

export function  buildLabelledAnswers(fields, answers) {
    return fields.reduce((acc, field) => {
        const value = answers[field.id]
        if (String(field.type || '').toLowerCase() === 'address') {
            const address = normalizeAddressValue(value)
            if (isAddressComplete(address)) {
                acc[field.label] = address
            }
            return acc
        }

        const text = String(value || '').trim()
        if (text) {
            acc[field.label] = text
        }
        return acc
    }, {})
}

export function  derivePatientName(fields, answers, fallback = '') {
    const preferredField = fields.find((field) => {
        const label = String(field.label || '').toLowerCase()
        return label.includes('patient') && label.includes('name')
    })

    if (preferredField) {
        const value = String(answers[preferredField.id] || '').trim()
        if (value) return value
    }

    const anyNameField = fields.find((field) => String(field.label || '').toLowerCase().includes('name'))
    if (anyNameField) {
        const value = String(answers[anyNameField.id] || '').trim()
        if (value) return value
    }

    return String(fallback || '').trim()
}

export function  toPatientDraft(patient, fields) {
    const metadata = safeMetadata(patient?.metadata)
    const answersFromMetadata = safeMetadata(metadata.sploseAnswers)
    const blankAnswers = createBlankAnswers(fields)
    const mergedAnswers = { ...blankAnswers, ...answersFromMetadata }

    for (const field of fields) {
        if (String(field.type || '').toLowerCase() !== 'address') continue
        mergedAnswers[field.id] = normalizeAddressValue(mergedAnswers[field.id])
    }

    const agents = normalizePatientAgents(metadata.patientAgents)

    return {
        id: patient?.id || null,
        patient_name: String(patient?.patient_name || '').trim(),
        domain: String(patient?.domain || '').trim(),
        answers: mergedAnswers,
        agents,
        // Kept so a save can round-trip metadata keys this form does not own.
        rawMetadata: metadata,
    }
}
