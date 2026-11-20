import { getDomainSetting } from '@/lib/appSettings'
import { getDomainDisplayLabel } from '@/lib/assistantConfig'

/**
 * The name a generated report should carry for a domain (its display label), never the domain key it
 * is stored under. Queue payloads pass this to the report worker, which prints it
 * as the practice name on the report and in the section prompts.
 *
 * Falls back to a prettified key so the worker always has a practice name to render.
 */
export async function readDomainPracticeName(domainKey) {
    const key = String(domainKey || '').trim().toLowerCase()
    if (!key) return ''

    try {
        const settings = await getDomainSetting(key, 'management')
        const configured = String(settings?.displayName || '').trim()
        return getDomainDisplayLabel(key, configured)
    } catch {
        return getDomainDisplayLabel(key)
    }
}
