// Projects the people captured on a patient's intake form into the Contacts
// directory.
//
// The intake form asks for the people around a patient — a referrer, an NDIS
// support coordinator, and (as an email) a plan manager — and those answers live
// on the patient record under `metadata.sploseAnswers`. The Contacts directory is
// where the practice keeps the people it deals with, so a saved patient
// contributes them as ordinary contact rows linked through `contact_patients`;
// they then show up both on the patient's Contacts panel and in the directory.
//
// A row this module owns is tagged in `metadata.patientFormSources`, and that tag
// is what stops a repeat save from adding a duplicate: the next save matches the
// same person and refreshes it in place. Only the fields the form actually
// supplies are managed — an association, a note, or an email the form does not
// ask for is left alone — and a row that has been edited by hand is released from
// the form's ownership rather than deleted. Because one contact can now serve
// several patients, dropping somebody from a form only unlinks them from that
// patient; the row is deleted only when the form still owns it and no other
// patient is linked to it.
//
// Kept DB-agnostic apart from the shared connection it is handed, so the
// derivation can also be exercised on its own.

import { ensureContactsTable, countContactPatientLinks, linkContactToPatient, unlinkContactFromPatient } from './contactsTable.js'
import {
    CONTACT_FIELD_LIMITS,
    cleanBoundedString,
    cleanString,
    isEmptyContact,
    normalizeContactEmail,
    parseMetadataValue,
} from './contacts.js'

// The four columns a form contact can own. Anything else on the row (association,
// notes) belongs to whoever typed it in the directory.
const MANAGED_FIELDS = ['name', 'email', 'phone', 'role']

// One entry per question group on the form that names a person. The keys are the
// canonical intake field ids the admin patient form stores answers under.
const FORM_CONTACT_SOURCES = [
    {
        source: 'referrer',
        nameKey: 'referrer_full_name',
        roleKey: 'referrer_relationship',
        fallbackRole: 'Referrer',
        phoneKey: 'referrer_phone',
    },
    {
        source: 'support_coordinator',
        nameKey: 'ndis_support_coordinator_name',
        emailKey: 'ndis_support_coordinator_email',
        phoneKey: 'ndis_support_coordinator_phone',
        fallbackRole: 'Support Coordinator',
    },
    {
        source: 'plan_manager',
        emailKey: 'plan_manager_email',
        fallbackRole: 'Plan Manager',
    },
]

const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/

// Returns null when the record carries no intake answers at all, which a caller
// treats differently from an empty set: a save that did not include the form has
// nothing to say about form contacts, so nothing may be removed.
function readAnswers(metadata) {
    const root = parseMetadataValue(metadata)
    if (!root) return null

    const answers = root.sploseAnswers
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return null
    return answers
}

/** Whether a save carried intake answers (as opposed to a partial metadata update). */
export function hasPatientFormAnswers(metadata) {
    return readAnswers(metadata) !== null
}

// Answers are usually strings, but a phone or number field can arrive as a
// number, and structured answers (an address) are objects we must not stringify.
function readText(answers, key) {
    if (!key) return ''
    const value = answers[key]
    if (typeof value === 'number') return String(value)
    if (typeof value !== 'string') return ''
    return cleanString(value)
}

// A form field occasionally carries a website or an email address instead of a
// person ("ot.com.au"). Those never make a useful contact name, so they are
// dropped rather than imported as somebody.
function isPersonName(value) {
    const name = cleanString(value)
    if (!name) return false
    if (name.includes('@')) return false
    if (!/\s/.test(name) && /^[\w-]+(\.[\w-]+)+$/.test(name)) return false
    return true
}

// The plan manager question is a free-text email field and is often answered with
// a "cc:" note, so only the first address is taken.
function firstEmail(value) {
    const match = EMAIL_IN_TEXT.exec(cleanString(value))
    return match ? match[0] : ''
}

function normalizeName(value) {
    return cleanString(value).toLowerCase().replace(/\s+/g, ' ')
}

function normalizeEmail(value) {
    return cleanString(value).toLowerCase()
}

// The same person is often named twice — the referrer is frequently also the
// support coordinator — so candidates that identify the same person are merged
// into one contact.
function contactKey(candidate) {
    const name = normalizeName(candidate.name)
    if (name) return `name:${name}`
    const email = normalizeEmail(candidate.email)
    return email ? `email:${email}` : ''
}

function mergeCandidates(candidates) {
    const merged = new Map()

    for (const candidate of candidates) {
        const key = contactKey(candidate)
        if (!key) continue

        const existing = merged.get(key)
        if (!existing) {
            merged.set(key, {
                ...candidate,
                sources: [...candidate.sources],
                supplied: { ...candidate.supplied },
            })
            continue
        }

        for (const field of MANAGED_FIELDS) {
            if (!existing[field] && candidate[field]) existing[field] = candidate[field]
            existing.supplied[field] = existing.supplied[field] || candidate.supplied[field]
        }
        for (const source of candidate.sources) {
            if (!existing.sources.includes(source)) existing.sources.push(source)
        }
    }

    return Array.from(merged.values())
}

/**
 * Work out which contacts a patient's saved form describes.
 *
 * Pure: takes the patient metadata and returns one entry per person, each
 * carrying the source questions it came from (`sources`) and which of the four
 * managed fields the form actually filled (`supplied`).
 */
export function derivePatientFormContacts(metadata) {
    const answers = readAnswers(metadata)
    if (!answers) return []

    const candidates = []

    for (const spec of FORM_CONTACT_SOURCES) {
        const rawName = readText(answers, spec.nameKey)
        const name = isPersonName(rawName) ? rawName : ''
        const email = firstEmail(readText(answers, spec.emailKey))
        const phone = readText(answers, spec.phoneKey)
        const role = (spec.roleKey ? readText(answers, spec.roleKey) : '') || spec.fallbackRole

        const candidate = {
            name,
            email,
            phone,
            role,
            sources: [spec.source],
            supplied: {
                name: Boolean(name),
                email: Boolean(email),
                phone: Boolean(phone),
                role: Boolean(role),
            },
        }

        if (isEmptyContact(candidate)) continue
        candidates.push(candidate)
    }

    return mergeCandidates(candidates)
}

function rowFormSources(row) {
    const sources = row?.metadata?.patientFormSources
    if (!Array.isArray(sources)) return []
    return sources.map((source) => cleanString(source)).filter(Boolean)
}

function buildManagedValues(candidate) {
    return {
        name: cleanBoundedString(candidate.name, CONTACT_FIELD_LIMITS.name),
        email: normalizeContactEmail(candidate.email),
        phone: cleanBoundedString(candidate.phone, CONTACT_FIELD_LIMITS.phone),
        role: cleanBoundedString(candidate.role, CONTACT_FIELD_LIMITS.role),
    }
}

// What the form has taken ownership of on this row: the fields it supplied this
// time, plus any it supplied before. A field it has never supplied (an email it
// does not ask for, for example) stays out so a clinician's value survives.
function writtenFromSupplied(candidate, managed, previous) {
    const written = {}
    for (const key of MANAGED_FIELDS) {
        if (candidate.supplied[key] || previous?.[key] !== undefined) written[key] = managed[key]
    }
    return written
}

// Whether a form-owned row still looks exactly as the form left it. A hand-typed
// association or note means somebody has adopted it, so it must not be deleted.
function isUnchangedSinceWrite(row, written) {
    if (!written || typeof written !== 'object') return false
    if (cleanString(row.notes) || cleanString(row.association)) return false

    return MANAGED_FIELDS.every((key) => (
        written[key] === undefined || cleanString(row[key]) === cleanString(written[key])
    ))
}

// Prefer the row that already carries the person's name, then their email, then
// any row the form already owns — the last case lets a renamed referrer be
// updated in place instead of looking like a new person.
function pickRow(rows, claimed, candidate) {
    const name = normalizeName(candidate.name)
    const email = normalizeEmail(candidate.email)

    if (name) {
        for (let index = 0; index < rows.length; index += 1) {
            if (!claimed.has(index) && normalizeName(rows[index].name) === name) return index
        }
    }
    if (email) {
        for (let index = 0; index < rows.length; index += 1) {
            if (!claimed.has(index) && normalizeEmail(rows[index].email) === email) return index
        }
    }
    for (let index = 0; index < rows.length; index += 1) {
        if (claimed.has(index)) continue
        if (rowFormSources(rows[index]).some((source) => candidate.sources.includes(source))) return index
    }

    return -1
}

/**
 * Bring the contacts linked to one patient in line with the contacts on their
 * form. Safe to call on every save: an unchanged form writes nothing, and a
 * contact the practice has edited is never overwritten in a way that loses work.
 *
 * Returns a small tally so a caller can log what a save changed.
 */
export async function syncPatientFormContacts(connection, { domain, patientId, metadata }) {
    const result = { created: 0, updated: 0, removed: 0, released: 0 }
    if (!connection?.query) return result

    const scopedDomain = cleanString(domain)
    const id = Number.parseInt(String(patientId ?? ''), 10)
    if (!scopedDomain || !Number.isFinite(id) || id <= 0) return result

    // A save that did not carry the form (a partial metadata update, say) must not
    // be read as "the form names nobody now" and strip the patient's contacts.
    if (!hasPatientFormAnswers(metadata)) return result

    const candidates = derivePatientFormContacts(metadata)

    await ensureContactsTable()

    const existing = await connection.query(
        `SELECT c.id, c.name, c.email, c.phone, c.role, c.notes, c.association, c.metadata
           FROM contacts c
           JOIN contact_patients cp ON cp.contact_id = c.id
          WHERE cp.domain = $1 AND cp.patient_id = $2`,
        [scopedDomain, id]
    )
    const rows = (existing.rows || []).map((row) => ({ ...row, metadata: parseMetadataValue(row.metadata) }))
    const claimed = new Set()

    for (const candidate of candidates) {
        const managed = buildManagedValues(candidate)
        const index = pickRow(rows, claimed, candidate)

        if (index === -1) {
            const nextMetadata = {
                patientFormSources: candidate.sources,
                patientFormWritten: writtenFromSupplied(candidate, managed, {}),
            }
            const inserted = await connection.query(
                `INSERT INTO contacts (domain, name, email, phone, role, metadata)
                 VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id`,
                [
                    scopedDomain,
                    managed.name,
                    managed.email,
                    managed.phone,
                    managed.role,
                    JSON.stringify(nextMetadata),
                ]
            )
            const contactId = inserted.rows?.[0]?.id
            if (contactId) {
                await linkContactToPatient(connection, { domain: scopedDomain, contactId, patientId: id })
            }
            result.created += 1
            continue
        }

        claimed.add(index)
        const row = rows[index]
        const written = row.metadata?.patientFormWritten
        const nextWritten = writtenFromSupplied(candidate, managed, written)

        const next = {}
        for (const key of MANAGED_FIELDS) {
            next[key] = Object.prototype.hasOwnProperty.call(nextWritten, key) ? managed[key] : row[key]
        }

        const sourcesChanged = JSON.stringify(rowFormSources(row)) !== JSON.stringify(candidate.sources)
        const valuesChanged = MANAGED_FIELDS.some((key) => cleanString(row[key]) !== cleanString(next[key]))
        const writtenChanged = MANAGED_FIELDS.some((key) => (
            (nextWritten[key] ?? null) !== (written?.[key] ?? null)
        ))

        if (!sourcesChanged && !valuesChanged && !writtenChanged) continue

        await connection.query(
            `UPDATE contacts
                SET name = $1, email = $2, phone = $3, role = $4, metadata = $5::jsonb, updated_at = NOW()
              WHERE id = $6 AND domain = $7`,
            [
                next.name,
                next.email,
                next.phone,
                next.role,
                JSON.stringify({ ...(row.metadata || {}), patientFormSources: candidate.sources, patientFormWritten: nextWritten }),
                row.id,
                scopedDomain,
            ]
        )
        result.updated += 1
    }

    // Anything the form owns that the form no longer describes is stale. Detach it
    // from this patient, then remove it when it is still ours and nobody else is
    // using it; hand it back to the directory when it has been edited or another
    // patient still depends on it.
    for (let index = 0; index < rows.length; index += 1) {
        if (claimed.has(index)) continue

        const row = rows[index]
        if (rowFormSources(row).length === 0) continue

        await unlinkContactFromPatient(connection, {
            domain: scopedDomain,
            contactId: row.id,
            patientId: id,
        })

        // A contact may now serve several patients, so it only disappears when it
        // was never touched by hand and this was its last link.
        if (isUnchangedSinceWrite(row, row.metadata?.patientFormWritten)) {
            const remainingLinks = await countContactPatientLinks(connection, row.id)
            if (remainingLinks === 0) {
                await connection.query('DELETE FROM contacts WHERE id = $1 AND domain = $2', [row.id, scopedDomain])
                result.removed += 1
                continue
            }
        }

        const released = { ...(row.metadata || {}) }
        delete released.patientFormSources
        delete released.patientFormWritten
        await connection.query(
            'UPDATE contacts SET metadata = $1::jsonb, updated_at = NOW() WHERE id = $2 AND domain = $3',
            [JSON.stringify(released), row.id, scopedDomain]
        )
        result.released += 1
    }

    return result
}
