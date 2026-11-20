// Presentation helpers for the Contacts entity.
//
// Pure/client-safe: the admin Contacts page and the dashboard Contacts card
// both use these, so wording and date formatting stay identical in both places.

import { cleanString, contactMatchesQuery, normalizeContactPatients } from './contacts.js'

const CONTACT_TIME_ZONE = 'Australia/Melbourne'

function formatDateTime(value, options) {
    const text = cleanString(value)
    if (!text) return ''

    const date = new Date(text)
    if (Number.isNaN(date.getTime())) return text

    return date.toLocaleString('en-AU', { timeZone: CONTACT_TIME_ZONE, ...options })
}

export function formatContactDateTime(value) {
    return formatDateTime(value, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    })
}

/**
 * The best name to show for a contact. An email-only contact falls back to the
 * address so a row never renders blank.
 */
export function contactDisplayName(contact) {
    return cleanString(contact?.name) || cleanString(contact?.email) || 'Unnamed contact'
}

/**
 * One-line summary used on the Contacts list: what the contact is associated
 * with first, then how to reach them.
 */
export function describeContactSummary(contact) {
    const parts = []

    const association = cleanString(contact?.association)
    const role = cleanString(contact?.role)
    if (association && role) parts.push(`${role} · ${association}`)
    else if (association || role) parts.push(association || role)

    const patientNames = normalizeContactPatients(contact?.patients).map((patient) => patient.name)
    if (patientNames.length === 1) parts.push(`Patient: ${patientNames[0]}`)
    else if (patientNames.length > 1) parts.push(`Patients: ${patientNames.join(', ')}`)

    const email = cleanString(contact?.email)
    if (email) parts.push(email)

    const phone = cleanString(contact?.phone)
    if (phone) parts.push(phone)

    return parts.join(' • ') || 'No details yet'
}

export function buildContactMetrics(contacts) {
    const rows = Array.isArray(contacts) ? contacts : []

    return rows.reduce((acc, row) => {
        acc.total += 1
        if (cleanString(row?.email)) acc.withEmail += 1
        if (cleanString(row?.phone)) acc.withPhone += 1
        if (normalizeContactPatients(row?.patients).length > 0) acc.withPatient += 1

        const association = cleanString(row?.association).toLowerCase()
        if (association) acc.associations.add(association)
        return acc
    }, { total: 0, withEmail: 0, withPhone: 0, withPatient: 0, associations: new Set() })
}

export function filterContacts(contacts, query) {
    const rows = Array.isArray(contacts) ? contacts : []
    return rows.filter((row) => contactMatchesQuery(row, query))
}
