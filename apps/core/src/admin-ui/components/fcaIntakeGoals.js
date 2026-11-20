// Helpers that turn an intake form's NDIS goals answer into the goal list the
// FCA builder's Step 7 ("Goals & Objectives") edits.
//
// The intake form stores the answer under the `ndis_goals` field id and also
// keeps the question title, so both spellings are matched.

/** Intake questions whose answer carries the participant's NDIS goals. */
export const INTAKE_GOALS_KEYS = new Set([
    'ndis goals',
    'what are their ndis goals',
    'what are your ndis goals',
    'participant ndis goals',
])

function safeObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export function normalizeAnswerKey(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

/**
 * Split an intake goals answer into individual goals.
 *
 * Answers arrive either newline separated or as a single paragraph using
 * "1. ... 2. ..." markers, so both shapes are handled.
 */
export function splitGoalList(value) {
    const items = []

    const pushItem = (entry) => {
        const text = String(entry ?? '')
            .replace(/^\s*(?:[-*•·]|\d{1,2}\s*[.)])\s*/, '')
            .replace(/^[\s:;,.\u2013\u2014-]+/, '')
            .replace(/\s+/g, ' ')
            .trim()

        if (text.length < 3) return
        const key = text.toLowerCase()
        if (items.some((existing) => existing.toLowerCase() === key)) return
        items.push(text)
    }

    if (Array.isArray(value)) {
        value.forEach(pushItem)
        return items
    }

    const text = String(value ?? '').replace(/\r\n?/g, '\n').trim()
    if (!text) return items

    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
    if (lines.length > 1) {
        lines.forEach(pushItem)
        return items
    }

    text
        // "1. Goal" / "2) Goal" markers become line breaks. Requiring
        // whitespace after the marker keeps decimals such as "2.0" intact.
        .replace(/(?:^|\s)\d{1,2}\s*[.)]\s+(?=\S)/g, '\n')
        .replace(/\s*;\s+(?=\S)/g, '\n')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach(pushItem)

    return items
}

/** Keep every goal, but never fewer than the three inputs the step renders. */
export function padGoalsForEditing(goals) {
    const list = (Array.isArray(goals) ? goals : [])
        .map((goal) => String(goal || '').trim())
        .filter(Boolean)

    while (list.length < 3) list.push('')
    return list
}

/**
 * Pull the participant's goals out of the intake answers held on the patient
 * record (`metadata.sploseAnswers` / `metadata.sploseLabelledAnswers`), falling
 * back to the Splose patient export field of the same name.
 */
export function extractIntakeGoals(patient) {
    const source = safeObject(patient)
    const metadata = safeObject(source.metadata)
    const answers = safeObject(metadata.sploseAnswers)
    const labels = safeObject(metadata.sploseLabelledAnswers)
    const splosePatient = safeObject(metadata.splosePatient)

    const candidates = [
        answers.ndis_goals,
        splosePatient.ndis_goals,
        metadata.ndis_goals,
        metadata.ndisGoals,
    ]

    Object.entries(answers).forEach(([key, value]) => {
        if (INTAKE_GOALS_KEYS.has(normalizeAnswerKey(key))) candidates.push(value)
    })

    Object.entries(labels).forEach(([label, value]) => {
        if (INTAKE_GOALS_KEYS.has(normalizeAnswerKey(label))) candidates.push(value)
    })

    for (const candidate of candidates) {
        const goals = splitGoalList(candidate)
        if (goals.length > 0) return goals
    }

    return []
}
