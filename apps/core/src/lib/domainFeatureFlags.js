import { DEFAULT_WORKER_VISIBILITY, WORKER_VISIBILITY_KEY } from './aiWorkers.js'
import { DEFAULT_FILE_STORAGE_BACKEND } from './fileStorageConfig.js'
import { isSoloEdition } from './edition.js'

/**
 * Domain feature flags for the Allied Health directories, the practice-wide
 * header search, and the dashboard Quick Actions panel on /admin.
 *
 * `Suppliers` (`/admin/suppliers`, backed by /api/equipment) and `Providers`
 * (`/admin/providers`, backed by /api/providers) are Allied Health directories
 * that default ON for every domain. `practiceSearchEnabled` gates the Practice
 * search box in the admin header (backed by /api/admin/practice-search) and
 * defaults ON too.
 *
 * The flags live on the domain settings record (same place as `patientsEnabled`,
 * `recyclingEnabled`, ...) and are read by:
 *   - /api/settings/domains (normalize + persist)
 *   - /admin/settings/domains (Features checkboxes)
 *   - /admin (dashboard card visibility)
 *   - /api/admin/practice-search (header search availability)
 *
 * New domains and the unconfigured `default` domain use the feature settings
 * exported by `getDefaultDomainFeatureSettings`.
 *
 * `quickActionsEnabled` is a General (non-card) flag that gates the Quick
 * Actions panel on the /admin dashboard. Existing domains without a saved
 * value default OFF.
 *
 * `maintenanceModeEnabled` is a General (non-card) flag that marks a domain as
 * being under maintenance. It defaults OFF for every domain.
 *
 * `toolsEnabled` is a General (non-card) flag that turns the Tools dashboard
 * (`/admin/tools`) on for a domain and shows the Tools card on /admin that links
 * to it. The Tools page holds the Recycling, Funders, Content and Activities
 * cards, which are no longer rendered on the main Admin dashboard. It defaults
 * ON for every domain.
 *
 * `tasksEnabled` is a General (non-card) flag that turns the Tasks dashboard
 * (`/admin/tasks`) on for a domain and shows the Tasks card on /admin that links
 * to it. The Tasks page is the practice-wide roll-up of the per-patient "Waiting
 * on review" queue. It defaults ON for every domain.
 *
 * `websiteEnabled` is a General (non-card) flag that decides whether the domain's
 * public website answers at `/` (`src/app/layout.jsx`). It defaults ON so a
 * hosted deployment keeps its marketing site, and OFF for solo editions, which ship
 * without one: a solo install that turns it on serves the site at `/`, and one that
 * leaves it off redirects `/` to /admin.
 *
 * `filesEnabled` is a General (non-card) flag that turns the Files dashboard
 * (`/admin/files`) on for a domain and shows the Files card on /admin that links
 * to it. The Files page is the practice's whole upload library (patient files plus
 * practice-level files), so it is opt-in like Tools and Tasks. It defaults OFF for
 * every domain.
 */

export const SUPPLIERS_FEATURE_FLAG_KEY = 'suppliersEnabled'
export const PROVIDERS_FEATURE_FLAG_KEY = 'providersEnabled'
export const PRACTICE_SEARCH_FEATURE_FLAG_KEY = 'practiceSearchEnabled'
export const QUICK_ACTIONS_FEATURE_FLAG_KEY = 'quickActionsEnabled'
export const MAINTENANCE_MODE_FEATURE_FLAG_KEY = 'maintenanceModeEnabled'
export const TOOLS_PAGE_FEATURE_FLAG_KEY = 'toolsEnabled'
export const TASKS_PAGE_FEATURE_FLAG_KEY = 'tasksEnabled'
export const FILES_PAGE_FEATURE_FLAG_KEY = 'filesEnabled'
export const WEBSITE_FEATURE_FLAG_KEY = 'websiteEnabled'

/** Domain feature flags that gate a dashboard card. */
export const DOMAIN_DIRECTORY_FEATURE_FLAG_KEYS = [
    SUPPLIERS_FEATURE_FLAG_KEY,
    PROVIDERS_FEATURE_FLAG_KEY,
]

/**
 * Dashboard cards that only exist for a domain with the Patients entity on.
 *
 * The API persists the `...CardEnabled` members as
 * `patientsEnabled === true && value !== false` (an absent key means ON) and
 * `patientBillingEnabled` as opt-in (`=== true`, absent means OFF). Either way an
 * absent key carries a meaning, so a full-record save must not invent a value for
 * one: the settings form therefore sends only the flags the user actually touched
 * and the API preserves the stored value for the rest. Without that, a form that
 * had defaulted or gone stale on a flag could silently retire a card on save.
 */
export const PATIENT_CARD_FLAG_KEYS = [
    'reportsCardEnabled',
    'casesCardEnabled',
    'appointmentsCardEnabled',
    'formsCardEnabled',
    'notesCardEnabled',
    'docsCardEnabled',
    'analysisCardEnabled',
    'patientBillingEnabled',
]

export const DOCS_CARD_FLAG_KEY = 'docsCardEnabled'

/** Cards whose records the Docs page also indexes. */
export const DOCS_BACKED_CARD_FLAG_KEYS = [
    'casesCardEnabled',
    'formsCardEnabled',
    'analysisCardEnabled',
]

/**
 * True when a Docs-backed card's page should stay reachable for this domain.
 *
 * The Docs page indexes the same records as the Cases, Forms and Analysis cards,
 * so it is a second access point to those pages. Unchecking one of those cards
 * only retires it from the dashboard; the page keeps working while the Docs card
 * is on (and only the Patients entity can force it off).
 */
export function isDocsBackedPageEnabled(settings, cardFlagKey) {
    if (settings?.patientsEnabled !== true) return false
    if (settings?.[DOCS_CARD_FLAG_KEY] !== false) return true
    return settings?.[cardFlagKey] !== false
}

/**
 * Keep the stored value of every patient card flag the caller omitted, so a PATCH
 * never changes a card the user did not touch.
 *
 * A flag the caller did send is left exactly as normalized (the caller is editing
 * it). A flag that was omitted and has nothing stored stays omitted, which is what
 * makes the `!== false` / `=== true` defaults apply.
 */
export function preserveOmittedPatientCardFlags(normalizedSettings, providedSettings, storedSettings) {
    const normalized = { ...(normalizedSettings || {}) }
    const provided = providedSettings && typeof providedSettings === 'object' ? providedSettings : {}
    const stored = storedSettings && typeof storedSettings === 'object' ? storedSettings : {}

    for (const flagKey of PATIENT_CARD_FLAG_KEYS) {
        if (Object.prototype.hasOwnProperty.call(provided, flagKey)) continue

        if (Object.prototype.hasOwnProperty.call(stored, flagKey)) {
            normalized[flagKey] = stored[flagKey]
        } else {
            delete normalized[flagKey]
        }
    }

    return normalized
}

function parseFeatureFlag(value, fallback) {
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase()
        if (normalized === 'true') return true
        if (normalized === 'false') return false
    }
    return fallback
}

/**
 * Default state of the Website flag for an installation.
 *
 * Solo editions have no marketing site, so their domains start with the website
 * off; every hosted deployment starts with it on.
 */
export function getDefaultWebsiteFeatureFlag(env = process.env) {
    return !isSoloEdition(env)
}

/**
 * Default flag state for a domain that has nothing (or nothing relevant)
 * stored yet.
 *
 * These are the hard-coded defaults for the `default` domain and for domains
 * created later, so they do not vary by domain key. `websiteEnabled` is the
 * exception: it stays edition-aware (see `getDefaultWebsiteFeatureFlag`).
 */
export function getDefaultDomainFeatureFlags(domainKey, env = process.env) {
    return {
        [SUPPLIERS_FEATURE_FLAG_KEY]: true,
        [PROVIDERS_FEATURE_FLAG_KEY]: true,
        [PRACTICE_SEARCH_FEATURE_FLAG_KEY]: true,
        [QUICK_ACTIONS_FEATURE_FLAG_KEY]: false,
        // Maintenance mode is off for every domain by default.
        [MAINTENANCE_MODE_FEATURE_FLAG_KEY]: false,
        [TOOLS_PAGE_FEATURE_FLAG_KEY]: true,
        [TASKS_PAGE_FEATURE_FLAG_KEY]: true,
        // Files is an opt-in library, not a practice default.
        [FILES_PAGE_FEATURE_FLAG_KEY]: false,
        [WEBSITE_FEATURE_FLAG_KEY]: getDefaultWebsiteFeatureFlag(env),
    }
}

/**
 * Feature settings used when creating a domain and when the default domain has
 * no saved settings. This is the hard-coded launch state shown in Features.
 */
export function getDefaultDomainFeatureSettings() {
    return {
        homePageBlockEditorEnabled: false,
        recentUpdatesEnabled: false,
        ...getDefaultDomainFeatureFlags('default'),
        // Files stay in the database unless a practice chooses another backend.
        fileStorageBackend: DEFAULT_FILE_STORAGE_BACKEND,
        patientsEnabled: true,
        adminFloatingLinkEnabled: true,
        assistantEnabled: true,
        allowPublicFrontend: true,
        requireAdminDomainMatch: true,
        enableLocalCaching: true,
        localCacheTtlHours: 24,
        reportsCardEnabled: true,
        casesCardEnabled: false,
        appointmentsCardEnabled: true,
        formsCardEnabled: false,
        notesCardEnabled: true,
        docsCardEnabled: true,
        analysisCardEnabled: false,
        patientBillingEnabled: true,
        aiUsageEnabled: true,
        recyclingEnabled: true,
        [WORKER_VISIBILITY_KEY]: { ...DEFAULT_WORKER_VISIBILITY },
        homepagePalette: { enabled: false, editMode: false },
    }
}

/**
 * Read the directory flags off a stored domain settings record, falling back to
 * the per-domain defaults for missing/blank values.
 */
export function normalizeDomainFeatureFlags(value, domainKey, env = process.env) {
    const defaults = getDefaultDomainFeatureFlags(domainKey, env)
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}

    return {
        [SUPPLIERS_FEATURE_FLAG_KEY]: parseFeatureFlag(source[SUPPLIERS_FEATURE_FLAG_KEY], defaults[SUPPLIERS_FEATURE_FLAG_KEY]),
        [PROVIDERS_FEATURE_FLAG_KEY]: parseFeatureFlag(source[PROVIDERS_FEATURE_FLAG_KEY], defaults[PROVIDERS_FEATURE_FLAG_KEY]),
        [PRACTICE_SEARCH_FEATURE_FLAG_KEY]: parseFeatureFlag(source[PRACTICE_SEARCH_FEATURE_FLAG_KEY], defaults[PRACTICE_SEARCH_FEATURE_FLAG_KEY]),
        [QUICK_ACTIONS_FEATURE_FLAG_KEY]: parseFeatureFlag(source[QUICK_ACTIONS_FEATURE_FLAG_KEY], defaults[QUICK_ACTIONS_FEATURE_FLAG_KEY]),
        [MAINTENANCE_MODE_FEATURE_FLAG_KEY]: parseFeatureFlag(source[MAINTENANCE_MODE_FEATURE_FLAG_KEY], defaults[MAINTENANCE_MODE_FEATURE_FLAG_KEY]),
        [TOOLS_PAGE_FEATURE_FLAG_KEY]: parseFeatureFlag(source[TOOLS_PAGE_FEATURE_FLAG_KEY], defaults[TOOLS_PAGE_FEATURE_FLAG_KEY]),
        [TASKS_PAGE_FEATURE_FLAG_KEY]: parseFeatureFlag(source[TASKS_PAGE_FEATURE_FLAG_KEY], defaults[TASKS_PAGE_FEATURE_FLAG_KEY]),
        [FILES_PAGE_FEATURE_FLAG_KEY]: parseFeatureFlag(source[FILES_PAGE_FEATURE_FLAG_KEY], defaults[FILES_PAGE_FEATURE_FLAG_KEY]),
        [WEBSITE_FEATURE_FLAG_KEY]: parseFeatureFlag(source[WEBSITE_FEATURE_FLAG_KEY], defaults[WEBSITE_FEATURE_FLAG_KEY]),
    }
}

/** True when the Suppliers directory should be visible for this domain. */
export function isSuppliersFeatureEnabled(settings, domainKey) {
    return normalizeDomainFeatureFlags(settings, domainKey)[SUPPLIERS_FEATURE_FLAG_KEY]
}

/** True when the Providers directory should be visible for this domain. */
export function isProvidersFeatureEnabled(settings, domainKey) {
    return normalizeDomainFeatureFlags(settings, domainKey)[PROVIDERS_FEATURE_FLAG_KEY]
}

/** True when the Practice search box should be available for this domain. */
export function isPracticeSearchFeatureEnabled(settings, domainKey) {
    return normalizeDomainFeatureFlags(settings, domainKey)[PRACTICE_SEARCH_FEATURE_FLAG_KEY]
}

/** True when the /admin Quick Actions panel should be visible for this domain. */
export function isQuickActionsFeatureEnabled(settings, domainKey) {
    return normalizeDomainFeatureFlags(settings, domainKey)[QUICK_ACTIONS_FEATURE_FLAG_KEY]
}

/** True when the domain is flagged as being under maintenance. */
export function isMaintenanceModeFeatureEnabled(settings, domainKey) {
    return normalizeDomainFeatureFlags(settings, domainKey)[MAINTENANCE_MODE_FEATURE_FLAG_KEY]
}

/** True when the Tools dashboard (`/admin/tools`) is available for this domain. */
export function isToolsPageFeatureEnabled(settings, domainKey) {
    return normalizeDomainFeatureFlags(settings, domainKey)[TOOLS_PAGE_FEATURE_FLAG_KEY]
}

/** True when the Tasks dashboard (`/admin/tasks`) is available for this domain. */
export function isTasksPageFeatureEnabled(settings, domainKey, env = process.env) {
    return normalizeDomainFeatureFlags(settings, domainKey, env)[TASKS_PAGE_FEATURE_FLAG_KEY]
}

/** True when the Files dashboard (`/admin/files`) is available for this domain. */
export function isFilesPageFeatureEnabled(settings, domainKey, env = process.env) {
    return normalizeDomainFeatureFlags(settings, domainKey, env)[FILES_PAGE_FEATURE_FLAG_KEY]
}

/**
 * True when the domain's public website should answer at `/`.
 *
 * The default depends on the edition (see `getDefaultWebsiteFeatureFlag`), so a
 * stored value is what lets a solo install opt in and a hosted deployment opt out.
 */
export function isWebsiteFeatureEnabled(settings, domainKey, env = process.env) {
    return normalizeDomainFeatureFlags(settings, domainKey, env)[WEBSITE_FEATURE_FLAG_KEY]
}

/**
 * True only when maintenance mode should actually take effect: the flag is on
 * for the domain AND we are running in production. Local/dev environments never
 * activate maintenance mode, so a flag flipped in a dev database cannot lock
 * developers out of their own sites.
 *
 * `production` is passed in explicitly (rather than read from `process.env`
 * here) so this stays a pure function that both client bundles and the plain
 * `node --test` runner can import safely.
 */
export function isMaintenanceModeActive(settings, domainKey, production) {
    if (production !== true) return false
    return isMaintenanceModeFeatureEnabled(settings, domainKey)
}
