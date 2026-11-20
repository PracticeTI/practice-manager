// Presentation helpers for the Forms entity.
//
// Pure/client-safe: the admin Forms page and the patient record panel both use
// these, so status text and date formatting stay identical in both places.

import { buildFormFieldList, isEmptyAnswer } from './forms.js'

const FORM_TIME_ZONE = 'Australia/Melbourne'

/**
 * Format a submission timestamp for display. Returns '' for a blank value and
 * falls back to the raw text when the value cannot be parsed.
 */
export function formatFormDateTime(value) {
    const text = String(value === null || value === undefined ? '' : value).trim()
    if (!text) return ''

    const date = new Date(text)
    if (Number.isNaN(date.getTime())) return text

    return date.toLocaleString('en-AU', {
        timeZone: FORM_TIME_ZONE,
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    })
}

export function formatFormDate(value) {
    const text = String(value === null || value === undefined ? '' : value).trim()
    if (!text) return ''

    const date = new Date(text)
    if (Number.isNaN(date.getTime())) return text

    return date.toLocaleDateString('en-AU', {
        timeZone: FORM_TIME_ZONE,
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    })
}

function toAnswerText(answer) {
    if (isEmptyAnswer(answer)) return ''
    if (typeof answer === 'object' && !Array.isArray(answer)) {
        return Object.values(answer).filter(Boolean).join(', ')
    }
    return String(answer)
}

/**
 * Group an imported submission into its answered questions, in form order, so
 * the UI can render it as read-only sections.
 */
export function buildFormSections(form) {
    const entries = buildFormFieldList(form?.content, { title: form?.title || '' })

    return entries.reduce((sections, entry) => {
        const name = entry.section || 'Form'
        const existing = sections.find((section) => section.name === name)
        const row = {
            key: `${name}:${entry.question}`,
            question: entry.question,
            answer: toAnswerText(entry.answer),
            fieldLabel: entry.fieldLabel,
            matched: Boolean(entry.fieldId),
        }

        if (existing) {
            existing.entries.push(row)
        } else {
            sections.push({ name, entries: [row] })
        }

        return sections
    }, [])
}

export function countFormAnswers(form) {
    const fromContent = buildFormFieldList(form?.content, { title: form?.title || '' }).length
    if (fromContent > 0) return fromContent

    // A compact list query omits `content`, so fall back to the projected
    // answers the importer matched onto the intake schema.
    const answers = form?.answers
    return answers && typeof answers === 'object' && !Array.isArray(answers)
        ? Object.keys(answers).length
        : 0
}

/**
 * One-line summary used on dashboard/card rows.
 */
export function describeFormSummary(form) {
    const answered = countFormAnswers(form)
    const parts = [String(form?.title || '').trim() || 'Untitled form']

    if (answered > 0) parts.push(`${answered} answer${answered === 1 ? '' : 's'}`)

    const submitted = formatFormDate(form?.submitted_at)
    if (submitted) parts.push(`Submitted ${submitted}`)

    return parts.join(' · ')
}

/**
 * Counts used by the admin Forms page summary tiles.
 */
export function buildFormMetrics(forms) {
    const rows = Array.isArray(forms) ? forms : []

    return rows.reduce((metrics, row) => {
        metrics.total += 1
        if (row?.patient_id) metrics.linked += 1
        else metrics.unlinked += 1
        if (row?.archived === true) metrics.archived += 1
        return metrics
    }, { total: 0, linked: 0, unlinked: 0, archived: 0 })
}
