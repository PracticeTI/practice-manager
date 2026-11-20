/**
 * The AI worker cards a domain can show, and whether each is on.
 *
 * Per-domain visibility is stored in the domain settings record. The record was
 * saved under `asenticWorkerVisibility` before the rename to a neutral name, so
 * reads fall back to that key and writes drop it.
 */

export const WORKER_DEFINITIONS = [
    { key: 'reporting', label: 'Reporting' },
    { key: 'equipmentSourcer', label: 'Equipment Sourcer' },
    { key: 'hsrCreator', label: 'HSR Writer' },
    { key: 'hsrSummariser', label: 'HSR Summariser' },
    { key: 'billing', label: 'Billing' },
    { key: 'quoteWriter', label: 'Quote Writer' },
    { key: 'analyst', label: 'FCA Analyst' },
    { key: 'scribe', label: 'Transcript Summariser' },
]

export const WORKER_VISIBILITY_KEY = 'workerVisibility'

/** Retired settings key, still present in records saved by earlier releases. */
export const LEGACY_WORKER_VISIBILITY_KEY = 'asenticWorkerVisibility'

export const DEFAULT_WORKER_VISIBILITY = WORKER_DEFINITIONS.reduce((visibility, worker) => {
    visibility[worker.key] = true
    return visibility
}, {})

export function normalizeWorkerVisibility(value) {
    const source = value && typeof value === 'object' ? value : {}
    return WORKER_DEFINITIONS.reduce((visibility, worker) => {
        visibility[worker.key] = source[worker.key] !== false
        return visibility
    }, {})
}

/** Stored visibility for a domain settings record, including the retired key. */
export function readWorkerVisibility(settings, fallbackSettings = null) {
    const source = settings && typeof settings === 'object' ? settings : {}
    const stored = source[WORKER_VISIBILITY_KEY] ?? source[LEGACY_WORKER_VISIBILITY_KEY]
    if (stored != null) return normalizeWorkerVisibility(stored)

    const fallback = fallbackSettings && typeof fallbackSettings === 'object' ? fallbackSettings : {}
    return normalizeWorkerVisibility(fallback[WORKER_VISIBILITY_KEY] ?? fallback[LEGACY_WORKER_VISIBILITY_KEY])
}
