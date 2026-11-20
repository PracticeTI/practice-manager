import { cache } from 'react'
import { getDomainSetting } from '@/lib/appSettings'
import { isMaintenanceModeActive } from '@/lib/domainFeatureFlags'

/** Maintenance mode is production-only. */
export function isMaintenanceEnvironment(env = process.env.NODE_ENV) {
    return env === 'production'
}

async function readDomainSettingsEntry(domainKey) {
    const normalizedDomainKey = String(domainKey || '').trim().toLowerCase()
    if (!normalizedDomainKey) return {}

    const entry = await getDomainSetting(normalizedDomainKey, 'management')
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return {}
    }

    return entry
}

/**
 * True when the given domain should currently serve its maintenance screen.
 *
 * Wrapped in React `cache()` so the root layout and `generateMetadata` share a
 * single settings read per request. Always `false` outside production, so
 * local dev and previews are never gated.
 */
export const resolveDomainMaintenanceMode = cache(async function resolveDomainMaintenanceMode(domainKey) {
    const production = isMaintenanceEnvironment()
    if (!production) return false

    const settings = await readDomainSettingsEntry(domainKey)
    return isMaintenanceModeActive(settings, domainKey, production)
})
