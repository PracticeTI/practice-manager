// Presentation helpers for the Notes entity.
//
// Pure/client-safe: the admin Notes page and the patient record panel both use
// these, so wording, previews and date formatting stay identical in both
// places.

import { buildNoteBlocks, cleanString, countNoteWords, extractNoteText } from './notes.js'

const NOTE_TIME_ZONE = 'Australia/Melbourne'

function formatDateTime(value, options) {
    const text = String(value === null || value === undefined ? '' : value).trim()
    if (!text) return ''

    const date = new Date(text)
    if (Number.isNaN(date.getTime())) return text

    return date.toLocaleString('en-AU', { timeZone: NOTE_TIME_ZONE, ...options })
}

export function formatNoteDateTime(value) {
    return formatDateTime(value, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    })
}

export function formatNoteDate(value) {
    return formatDateTime(value, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function noteWordCount(note) {
    const fromText = countNoteWords(note?.content_text)
    if (fromText > 0) return fromText
    return countNoteWords(extractNoteText(note?.content))
}

/**
 * A single-line snippet of the note body, used by the list and the dashboard
 * card. Falls back to an empty string when the body was not loaded.
 */
export function notePreview(note, maxLength = 160) {
    const text = cleanString(note?.content_text) || extractNoteText(note?.content)
    const firstLine = text.split('\n').map((line) => line.trim()).find(Boolean) || ''
    if (firstLine.length <= maxLength) return firstLine
    return `${firstLine.slice(0, maxLength - 1).trimEnd()}…`
}

/**
 * One-line summary used on list and card rows.
 *
 * `includeDraft: false` drops the Draft token. The dashboard card surfaces
 * notes as a plain recency list and does not label their status, while the
 * admin Notes page list keeps it.
 */
export function describeNoteSummary(note, options = {}) {
    const { includeDraft = true } = options
    const parts = [cleanString(note?.title) || 'Untitled note']
    const words = noteWordCount(note)

    if (words > 0) parts.push(`${words} word${words === 1 ? '' : 's'}`)
    if (includeDraft && note?.draft === true) parts.push('Draft')
    if (cleanString(note?.practitioner_name)) parts.push(cleanString(note.practitioner_name))

    return parts.join(' · ')
}

/**
 * Counts used by the admin Notes page summary tiles.
 */
export function buildNoteMetrics(notes) {
    const rows = Array.isArray(notes) ? notes : []

    return rows.reduce((metrics, row) => {
        metrics.total += 1
        if (row?.patient_id) metrics.linked += 1
        else metrics.unlinked += 1
        if (row?.draft === true) metrics.drafts += 1
        if (cleanString(row?.external_appointment_id)) metrics.withAppointment += 1
        return metrics
    }, { total: 0, linked: 0, unlinked: 0, drafts: 0, withAppointment: 0 })
}

/**
 * Group a note body into renderable chunks: consecutive list items collapse
 * into one list so the UI can emit real `<ul>`/`<ol>` elements, and everything
 * else is passed through as a single block.
 */
export function buildNoteRenderGroups(content) {
    const groups = []

    buildNoteBlocks(content).forEach((block, index) => {
        if (block.kind === 'listItem') {
            const previous = groups[groups.length - 1]
            const item = {
                key: `item-${index}`,
                text: block.text,
                checked: block.checked === true ? true : block.checked === false ? false : null,
            }

            if (previous && previous.type === 'list' && previous.depth === block.depth
                && previous.ordered === block.ordered) {
                previous.items.push(item)
                return
            }

            groups.push({
                type: 'list',
                key: `list-${index}`,
                ordered: block.ordered,
                depth: block.depth,
                items: [item],
            })
            return
        }

        groups.push({ type: 'block', key: `block-${index}`, block })
    })

    return groups
}
