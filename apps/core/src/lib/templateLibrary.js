/**
 * Template Library path conventions (server-safe helpers, no fs access).
 *
 * Layout (relative to the repo root, under the private `content/` directory):
 *
 *   content/templates/allied-health/
 *     OT/                 practice-type default for Occupational Therapy
 *     physio/             practice-type default for Physiotherapy
 *     speech/             practice-type default for Speech Pathology
 *     domains/<domain>/   per-domain override, used when it exists
 *
 * The stored `templateLibraryPath` domain setting is an explicit override. When it
 * is blank, the library is resolved automatically: a domain folder under `domains/`
 * wins, otherwise the folder for the domain's practice type is used.
 */

import { getPracticeTypeFolder } from '@/lib/practiceTypes'

export const TEMPLATE_LIBRARY_ROOT_RELATIVE = 'content/templates/allied-health'

const DOMAINS_SEGMENT = 'domains'

/**
 * Ids of templates that come from the on-disk library (rather than the domain's
 * stored templates) always start with this prefix. They are derived on read and
 * never persisted.
 */
export const TEMPLATE_LIBRARY_ID_PREFIX = 'template-library-'

export const TEMPLATE_LIBRARY_SOURCE = 'template-library'

/** True when a template object originates from the on-disk Template Library. */
export function isTemplateLibraryTemplate(template) {
    const id = String(template?.id || '').trim()
    const source = String(template?.source || '').trim().toLowerCase()
    return source === TEMPLATE_LIBRARY_SOURCE || id.startsWith(TEMPLATE_LIBRARY_ID_PREFIX)
}

/** Practice type value → template folder name. `general` has no folder. */
export const PRACTICE_TYPE_TEMPLATE_FOLDERS = {
    occupational_therapy: 'OT',
    physiotherapy: 'physio',
    speech_pathology: 'speech',
}

export function normalizeDomainKey(value) {
    return String(value || '').trim().toLowerCase()
}

/**
 * Folder name for a practice type, or '' when the type has no folder.
 * Delegates to `getPracticeTypeFolder` so the `OT` / `physio` / `speech` folder
 * convention has exactly one definition.
 */
export function getPracticeTypeTemplateFolder(practiceType) {
    return getPracticeTypeFolder(practiceType)
}

/** `content/templates/allied-health/domains/<domain>`, or '' when there is no domain key. */
export function getDomainTemplateRelativePath(domainKey) {
    const key = normalizeDomainKey(domainKey)
    return key ? `${TEMPLATE_LIBRARY_ROOT_RELATIVE}/${DOMAINS_SEGMENT}/${key}` : ''
}

/** `content/templates/allied-health/<folder>`, or '' when the practice type has no folder. */
export function getPracticeTypeTemplateRelativePath(practiceType) {
    const folder = getPracticeTypeTemplateFolder(practiceType)
    return folder ? `${TEMPLATE_LIBRARY_ROOT_RELATIVE}/${folder}` : ''
}

/**
 * Template *image* library conventions.
 *
 * Images mirror the template folder names but live under `public/` rather than the
 * private `content/` directory, because the editor preview and generated reports
 * load them by URL:
 *
 *   public/allied-health/<OT|physio|speech>/   practice-type assets (shared)
 *   public/allied-health/domains/<domain>/     domain-specific assets
 */
export const TEMPLATE_IMAGE_ROOT_RELATIVE = 'allied-health'

/** Path relative to `public/`, e.g. `allied-health/OT`. */
export function getPracticeTypeImageRelativePath(practiceType) {
    const folder = getPracticeTypeTemplateFolder(practiceType)
    return folder ? `${TEMPLATE_IMAGE_ROOT_RELATIVE}/${folder}` : ''
}

/** Path relative to `public/`, e.g. `allied-health/domains/acme`. */
export function getDomainImageRelativePath(domainKey) {
    const key = normalizeDomainKey(domainKey)
    return key ? `${TEMPLATE_IMAGE_ROOT_RELATIVE}/${DOMAINS_SEGMENT}/${key}` : ''
}

/**
 * Domain artwork (the worker / assistant marks worn by the AI surfaces) follows the
 * same layout as the template image library:
 *
 *   public/allied-health/domains/<domain>/<file>        domain override (wins)
 *   public/allied-health/<OT|physio|speech>/<file>      shared by practice type
 *
 * Both are under `public/` because the browser probes and renders them directly.
 */
export const DOMAIN_ARTWORK_FILES = {
    assistant: 'assistant.png',
    worker: 'worker.png',
}

/** Path relative to `public/`, e.g. `allied-health/domains/acme`. */
export function getDomainArtworkRelativePath(domainKey) {
    return getDomainImageRelativePath(domainKey)
}

/** Path relative to `public/`, e.g. `allied-health/OT`. */
export function getPracticeTypeArtworkRelativePath(practiceType) {
    return getPracticeTypeImageRelativePath(practiceType)
}
