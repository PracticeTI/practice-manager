import { getPrivateDomainFieldMap } from './domainExtension.js'

export const PRACTICE_TYPE_OPTIONS = [
    { value: 'occupational_therapy', label: 'Occupational Therapy', profession: 'ot' },
    { value: 'physiotherapy', label: 'Physiotherapy', profession: 'physio' },
    { value: 'speech_pathology', label: 'Speech Pathology', profession: 'speech' },
    { value: 'exercise_physiology', label: 'Exercise Physiology', profession: '' },
    { value: 'psychology', label: 'Psychology', profession: '' },
    { value: 'dietetics_nutrition', label: 'Dietetics / Nutrition', profession: '' },
    { value: 'podiatry', label: 'Podiatry', profession: '' },
    { value: 'audiology', label: 'Audiology', profession: '' },
    { value: 'orthoptics', label: 'Orthoptics', profession: '' },
    { value: 'prosthetics_orthotics', label: 'Prosthetics & Orthotics', profession: '' },
    { value: 'social_work', label: 'Social Work', profession: '' },
    { value: 'rehabilitation_counselling', label: 'Rehabilitation Counselling', profession: '' },
    { value: 'osteopathy', label: 'Osteopathy', profession: '' },
    { value: 'chiropractic', label: 'Chiropractic', profession: '' },
    { value: 'respiratory_therapy', label: 'Respiratory Therapy', profession: '' },
    { value: 'radiography', label: 'Radiography', profession: '' },
    { value: 'music_therapy', label: 'Music Therapy', profession: '' },
    { value: 'art_therapy', label: 'Art Therapy', profession: '' },
    { value: 'clinical_counselling', label: 'Clinical Counselling', profession: '' },
    { value: 'general', label: 'General', profession: '' },
]

const PRACTICE_TYPE_VALUES = new Set(PRACTICE_TYPE_OPTIONS.map((option) => option.value))

export function getDefaultPracticeType(domainKey) {
    const normalized = String(domainKey || '').trim().toLowerCase()
    if (!normalized) return 'general'
    return getPrivateDomainFieldMap('defaultPracticeType')[normalized] || 'general'
}

export function normalizePracticeType(value, domainKey = '') {
    const normalized = String(value || '').trim().toLowerCase()
    return PRACTICE_TYPE_VALUES.has(normalized) ? normalized : getDefaultPracticeType(domainKey)
}

export function getEquipmentDirectoryUrl(practiceType, domainKey = '') {
    const normalized = normalizePracticeType(practiceType, domainKey)
    const option = PRACTICE_TYPE_OPTIONS.find((item) => item.value === normalized)
    const path = '/allied-health/suppliers'
    return option?.profession ? `${path}?p=${option.profession}` : path
}

/** Human-readable label for a practice type, e.g. `occupational_therapy` → `Occupational Therapy`. */
export function getPracticeTypeLabel(value, domainKey = '') {
    const normalized = normalizePracticeType(value, domainKey)
    return PRACTICE_TYPE_OPTIONS.find((option) => option.value === normalized)?.label || ''
}

/**
 * Folder shared by a practice type's assets across domains — the single source of
 * truth for the `OT` / `physio` / `speech` folder convention used by the Template
 * Library, the template image library and domain artwork.
 * Returns '' for practice types with no folder (e.g. `general`).
 */
export function getPracticeTypeFolder(value, domainKey = '') {
    const normalized = normalizePracticeType(value, domainKey)
    const option = PRACTICE_TYPE_OPTIONS.find((item) => item.value === normalized)
    if (!option?.profession) return ''
    // `ot` is conventionally upper-case; the other professions are lower-case.
    return option.profession === 'ot' ? 'OT' : option.profession
}