/**
 * The admin portal remembers a superadmin's chosen default domain in
 * localStorage so it survives navigation.
 *
 * Pure and browser-safe: imported by client pages, so it must not touch
 * Next.js, cookies or any project module.
 */

export const DEFAULT_DOMAIN_STORAGE_KEY = 'default_domain_v1'

// Written by releases that shipped under the retired WordScout naming. Read (and
// migrated) so an operator's saved choice survives the rename.
const LEGACY_DEFAULT_DOMAIN_STORAGE_KEY = 'default_scout_v1'

function resolveStorage(storage) {
    if (storage) return storage
    return typeof window !== 'undefined' ? window.localStorage : null
}

/** Saved default domain preference, or null when none is stored. */
export function readStoredDefaultDomain(storage) {
    const store = resolveStorage(storage)
    if (!store) return null

    try {
        const current = store.getItem(DEFAULT_DOMAIN_STORAGE_KEY)
        if (current) return current

        const legacy = store.getItem(LEGACY_DEFAULT_DOMAIN_STORAGE_KEY)
        if (!legacy) return null

        store.setItem(DEFAULT_DOMAIN_STORAGE_KEY, legacy)
        store.removeItem(LEGACY_DEFAULT_DOMAIN_STORAGE_KEY)
        return legacy
    } catch {
        return null
    }
}

/** Remember the chosen default domain. */
export function writeStoredDefaultDomain(value, storage) {
    const store = resolveStorage(storage)
    if (!store) return

    store.setItem(DEFAULT_DOMAIN_STORAGE_KEY, String(value || ''))
}

/** Forget the saved preference so the hostname decides again. */
export function clearStoredDefaultDomain(storage) {
    const store = resolveStorage(storage)
    if (!store) return

    store.removeItem(DEFAULT_DOMAIN_STORAGE_KEY)
    store.removeItem(LEGACY_DEFAULT_DOMAIN_STORAGE_KEY)
}
