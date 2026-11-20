// The practice-wide task queue: every patient's "Waiting on review" queue,
// aggregated into one list.
//
// A patient's Overview already answers "what needs me?" for that person (see
// `workerReviewQueue.js`). Tasks asks the same question across the whole
// practice, which is what makes it useful first thing in the morning: the work
// is listed by who it belongs to rather than by which page it lives on.
//
// This module deliberately does not re-derive what "waiting on review" means. It
// groups the *same* derivation by patient, so an entry is raised on Tasks exactly
// when a patient's Overview would show it — the only thing added here is the patient
// dimension and the deep link back into their record. (The Overview previews at most
// ten quotes per patient because it is a section on a page; Tasks reads the whole
// queue, so it may count more of the same drafts.)
//
// Reaching this queue is not the same as leaving it: Tasks records what it raised
// (`taskEntries.js`), so a task stays on the list until somebody marks it done even
// though actioning the record stops this derivation from raising it. The Overview
// keeps answering the record-state question on its own.
//
// Pure and browser-safe: the Tasks page, the dashboard card and the tests share
// one derivation.
//
// A website enquiry is the one entry that belongs to the practice rather than to a
// patient: `buildContactEnquiryGroup` lists them under their own group, and opening
// one in Messages stops it being raised here (`contactEnquiryReview.js`).

import { buildWorkerReviewItems } from './workerReviewQueue.js'

/** The group key the website-enquiry entries are listed under. */
export const CONTACT_ENQUIRY_GROUP_KEY = 'website-enquiries'
export const CONTACT_ENQUIRY_GROUP_LABEL = 'Website enquiries'

/** Deep link into a patient record, on the tab that holds the work. */
export function buildPatientTaskHref(patientId, tab) {
    const id = String(patientId ?? '').trim()
    if (!id) return '/admin/patients'

    const query = new URLSearchParams({ patientId: id })
    if (tab) query.set('tab', String(tab))
    return `/admin/patients?${query.toString()}`
}

/** Deep link into the Messages record an enquiry arrived as. */
export function buildContactEnquiryHref(messageId) {
    const id = String(messageId ?? '').trim()
    const query = new URLSearchParams({ direction: 'outbound' })
    return id
        ? `/admin/messages/${encodeURIComponent(id)}?${query.toString()}`
        : `/admin/messages?${query.toString()}`
}

function previewText(value, max = 140) {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim()
    if (!normalized) return ''
    return normalized.length <= max ? normalized : `${normalized.slice(0, max)}...`
}

/**
 * The practice's website enquiries, as one group that belongs to the practice rather
 * than to a patient. Each enquiry is its own row because each one is a person
 * waiting for a reply. Opening it in Messages stops it being raised here (see
 * `contactEnquiryReview.js`), though Tasks keeps the entry until it is marked done
 * (`taskEntries.js`).
 */
export function buildContactEnquiryGroup(enquiries) {
    const rows = (Array.isArray(enquiries) ? enquiries : [])
        .filter((row) => row && typeof row === 'object')

    const items = []

    for (const row of rows) {
        const id = normalizeId(row.id)
        if (!id) continue

        const name = String(row.name || '').trim()
        const email = String(row.email || '').trim()
        const subject = String(row.subject || '').trim()
        const message = String(row.message || '').trim()
        const from = name && email ? `${name} <${email}>` : (name || email)
        const createdAt = new Date(row.createdAt || '').getTime()

        items.push({
            key: `${CONTACT_ENQUIRY_GROUP_KEY}:${id}`,
            kind: 'enquiries',
            tab: null,
            workerKey: 'contactForm',
            workerLabel: 'Website contact form',
            count: 1,
            title: subject || (name ? `Enquiry from ${name}` : 'Website enquiry'),
            detail: [
                from ? `From ${from}.` : '',
                previewText(message) || 'Submitted through the website contact form.',
            ].filter(Boolean).join(' '),
            actionLabel: 'Open enquiry',
            oldestCreatedAt: Number.isFinite(createdAt) ? new Date(createdAt).toISOString() : null,
            recordIds: [id],
            // Enquiries belong to the practice, so the row carries the enquirer where
            // a patient entry carries the patient.
            patientId: null,
            patientName: name || 'Website visitor',
            href: buildContactEnquiryHref(id),
        })
    }

    if (items.length === 0) return null

    return {
        groupKey: CONTACT_ENQUIRY_GROUP_KEY,
        patientId: null,
        patientName: CONTACT_ENQUIRY_GROUP_LABEL,
        items,
        total: items.length,
        oldestCreatedAt: oldestOf(items.map((item) => item.oldestCreatedAt)),
    }
}

/** True for the practice-level website-enquiry group, false for a patient's. */
export function isContactEnquiryGroup(group) {
    return Boolean(group) && (
        group.groupKey === CONTACT_ENQUIRY_GROUP_KEY || group.kind === 'enquiries'
    )
}

function normalizeId(value) {
    return String(value ?? '').trim()
}

function groupByPatientId(rows, readPatientId) {
    const grouped = new Map()

    for (const row of rows) {
        const patientId = normalizeId(readPatientId(row))
        if (!patientId) continue

        const existing = grouped.get(patientId)
        if (existing) existing.push(row)
        else grouped.set(patientId, [row])
    }

    return grouped
}

/** The oldest of a set of ISO timestamps, or null. */
export function oldestOf(values) {
    let oldest = null

    for (const value of values) {
        if (!value) continue
        const time = new Date(value).getTime()
        if (!Number.isFinite(time)) continue
        if (oldest === null || time < oldest) oldest = time
    }

    return oldest === null ? null : new Date(oldest).toISOString()
}

/**
 * The suggestions table stores one row per patient with no per-item timestamp, so
 * the row's `updated_at` is the only age available. Carrying it onto each
 * suggestion lets the review-queue builder age the group the same way it ages a
 * quote, instead of reporting "unknown" for equipment that has waited months.
 */
function suggestionsWithRowAge(suggestions, updatedAt) {
    if (!updatedAt) return suggestions
    return suggestions.map((suggestion) => (
        suggestion && suggestion.createdAt === undefined
            ? { ...suggestion, createdAt: updatedAt }
            : suggestion
    ))
}

/**
 * Build one group per patient that has something waiting on review.
 *
 * `patients` carries the per-patient context the worker records cannot supply
 * themselves: the display name, and whether the Equipment Sourcer is switched on
 * (the patient's Equipment tab only exists while it is, so an entry must not link
 * somewhere unreachable — the same rule the patient Overview applies).
 *
 * Groups are ordered by how long their oldest entry has waited, longest first,
 * because that is the order the work should be picked up in.
 */
export function buildPatientTaskGroups({ patients = [], quotes = [], equipment = [], reportJobs = [], enquiries = [] } = {}) {
    const patientRows = (Array.isArray(patients) ? patients : [])
        .filter((row) => row && typeof row === 'object')
    const quoteRows = (Array.isArray(quotes) ? quotes : [])
        .filter((row) => row && typeof row === 'object')
    const equipmentRows = (Array.isArray(equipment) ? equipment : [])
        .filter((row) => row && typeof row === 'object')
    const reportJobRows = (Array.isArray(reportJobs) ? reportJobs : [])
        .filter((row) => row && typeof row === 'object')

    const patientsById = new Map()
    for (const row of patientRows) {
        const patientId = normalizeId(row.id)
        if (patientId) patientsById.set(patientId, row)
    }

    const quotesByPatientId = groupByPatientId(quoteRows, (row) => row.patient_id ?? row.patientId)
    const equipmentByPatientId = groupByPatientId(equipmentRows, (row) => row.patientId ?? row.patient_id)
    const reportJobsByPatientId = groupByPatientId(reportJobRows, (row) => row.patientId ?? row.patient_id)

    // Worker records can name a patient the patient list did not carry (a rename
    // mid-load, or a row whose patient was deleted), and that work is still real,
    // so the union of every side is what gets grouped.
    const patientIds = new Set([
        ...patientsById.keys(),
        ...quotesByPatientId.keys(),
        ...equipmentByPatientId.keys(),
        ...reportJobsByPatientId.keys(),
    ])

    const groups = []

    for (const patientId of patientIds) {
        const patient = patientsById.get(patientId) || {}
        const patientQuotes = quotesByPatientId.get(patientId) || []
        const equipmentRow = (equipmentByPatientId.get(patientId) || [])[0] || null
        const patientReportJobs = reportJobsByPatientId.get(patientId) || []

        const equipmentSuggestions = suggestionsWithRowAge(
            Array.isArray(equipmentRow?.suggestions) ? equipmentRow.suggestions : [],
            equipmentRow?.updatedAt,
        )

        const patientName = String(
            patient.patientName
            ?? patient.patient_name
            ?? equipmentRow?.patientName
            ?? patientReportJobs[0]?.patientName
            ?? '',
        ).trim()

        const items = buildWorkerReviewItems({
            quotes: patientQuotes,
            equipmentSuggestions,
            reportJobs: patientReportJobs,
            // The Equipment Sourcer being off means the tab is not on screen, so
            // the entry is dropped rather than rendered as a dead link. Reports has
            // no per-patient switch — its tab is on every patient record.
            tabAvailability: { equipment: patient.equipmentSourcerEnabled === true },
        })

        if (items.length === 0) continue

        groups.push({
            patientId,
            patientName,
            items: items.map((item) => ({
                ...item,
                // The queue's own key is only unique within one patient (it is the
                // item's kind), so it is qualified here for lists that flatten
                // every patient together.
                key: `${patientId}:${item.key}`,
                patientId,
                patientName,
                href: buildPatientTaskHref(patientId, item.tab),
            })),
            total: items.reduce((sum, item) => sum + item.count, 0),
            oldestCreatedAt: oldestOf(items.map((item) => item.oldestCreatedAt)),
        })
    }

    // Website enquiries are the practice's own work rather than a patient's, so they
    // ride along as one more group and sort by how long they have waited like any
    // other.
    const enquiryGroup = buildContactEnquiryGroup(enquiries)
    if (enquiryGroup) groups.push(enquiryGroup)

    return groups.sort((left, right) => {
        const leftTime = left.oldestCreatedAt ? new Date(left.oldestCreatedAt).getTime() : Number.POSITIVE_INFINITY
        const rightTime = right.oldestCreatedAt ? new Date(right.oldestCreatedAt).getTime() : Number.POSITIVE_INFINITY
        if (leftTime !== rightTime) return leftTime - rightTime
        return left.patientName.localeCompare(right.patientName)
    })
}

/**
 * Every entry in one list, in the group order, for surfaces that are not grouped
 * by patient (the dashboard card's preview rows).
 */
export function flattenPatientTaskItems(groups, limit = Number.POSITIVE_INFINITY) {
    const rows = (Array.isArray(groups) ? groups : []).flatMap((group) => (
        Array.isArray(group?.items) ? group.items : []
    ))

    return Number.isFinite(limit) ? rows.slice(0, Math.max(0, limit)) : rows
}

/** The one-line answer to "how much is waiting?", for page and card headers. */
export function summarizePatientTasks(groups) {
    const rows = Array.isArray(groups) ? groups : []
    const patientGroups = rows.filter((group) => !isContactEnquiryGroup(group))
    const enquiryTotal = rows
        .filter(isContactEnquiryGroup)
        .reduce((sum, group) => sum + (Number(group?.total) || 0), 0)
    const patientTotal = patientGroups.reduce((sum, group) => sum + (Number(group?.total) || 0), 0)
    const total = patientTotal + enquiryTotal
    const patientCount = patientGroups.length
    const plural = (count, singular, pluralForm = `${singular}s`) => (count === 1 ? singular : pluralForm)

    // Enquiries are the practice's own work, not a patient's, so the sentence names
    // them separately instead of folding them into a patient count.
    const patientSentence = `${patientTotal} ${plural(patientTotal, 'item')} across ${patientCount} ${plural(patientCount, 'patient')} ${patientTotal === 1 ? 'is' : 'are'} on your list.`
    const enquirySentence = `${enquiryTotal} website ${plural(enquiryTotal, 'enquiry', 'enquiries')} ${enquiryTotal === 1 ? 'is' : 'are'} on your list.`

    let summaryText = 'Nothing from your agents is on your list.'
    if (patientTotal > 0 && enquiryTotal > 0) summaryText = `${patientSentence} ${enquirySentence}`
    else if (patientTotal > 0) summaryText = patientSentence
    else if (enquiryTotal > 0) summaryText = enquirySentence

    return {
        patientCount,
        enquiryCount: enquiryTotal,
        itemCount: rows.reduce((sum, group) => sum + (Array.isArray(group?.items) ? group.items.length : 0), 0),
        total,
        summaryText,
    }
}
