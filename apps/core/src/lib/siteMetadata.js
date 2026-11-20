import { getDomainLabel } from '@/lib/domainMode'
import { getDomainSetting } from '@/lib/appSettings'
import { getDefaultDomainSeoSettings, normalizeDomainSeoSettings } from '@/lib/domainSettings'
import {
    getPrivateCanonicalOrigins,
    getPrivateOgAssets,
    getPrivateSiteDescriptions,
    getPrivateThumbnailBackedOgModes,
} from '@/lib/domainExtension'


const BUILT_IN_CANONICAL_ORIGINS = {
    ...getPrivateCanonicalOrigins(),
}

const CORE_SITE_DESCRIPTIONS = {}

const BUILT_IN_SITE_DESCRIPTIONS = {
    ...CORE_SITE_DESCRIPTIONS,
    ...getPrivateSiteDescriptions(),
}

const LOCAL_THUMBNAIL_BACKED_OG_MODES = new Set([
    ...getPrivateThumbnailBackedOgModes(),
])
const LOCAL_PUBLIC_OG_ASSET_BY_MODE = {
    ...getPrivateOgAssets(),
}


function isLikelyLocalHostname(hostname) {
    const normalized = String(hostname || '').trim().toLowerCase()
    if (!normalized) return false
    if (normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1') return true
    if (normalized.endsWith('.local')) return true
    // Single-label hosts are commonly used as local dev aliases.
    if (!normalized.includes('.')) return true
    return false
}

function parseCanonicalOriginMapFromEnv() {
    const raw = process.env.NEXT_PUBLIC_CANONICAL_ORIGIN_MAP
    if (!raw) return {}

    try {
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

        const result = {}
        for (const [mode, origin] of Object.entries(parsed)) {
            if (typeof mode !== 'string' || typeof origin !== 'string') continue
            const normalizedMode = mode.trim().toLowerCase()
            const normalizedOrigin = normalizeOrigin(origin)
            if (!normalizedMode || !normalizedOrigin) continue
            result[normalizedMode] = normalizedOrigin
        }
        return result
    } catch {
        return {}
    }
}

function normalizeOrigin(value) {
    const normalized = String(value || '').trim()
    if (!normalized) return ''

    try {
        const parsed = new URL(normalized)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
        return parsed.origin
    } catch {
        return ''
    }
}

function inferOriginFromHeaders(headerStore) {
    const hostHeader =
        headerStore?.get?.('x-forwarded-host') ||
        headerStore?.get?.('host') ||
        ''
    const forwardedProto = String(headerStore?.get?.('x-forwarded-proto') || '').trim().toLowerCase()
    const host = String(hostHeader || '').split(',')[0].trim()
    if (!host) return ''

    const withoutPort = host.split(':')[0]
    const isLocal = isLikelyLocalHostname(withoutPort)
    const protocol = forwardedProto === 'http' || forwardedProto === 'https'
        ? forwardedProto
        : isLocal
            ? 'http'
            : 'https'
    return `${protocol}://${host}`
}

async function getDomainSettingsEntry(mode) {
    const normalizedMode = String(mode || '').trim().toLowerCase()
    if (!normalizedMode) return {}

    const entry = await getDomainSetting(normalizedMode, 'management')
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return {}
    }

    return entry
}

export async function resolveCanonicalOrigin({ mode, headerStore }) {
    const normalizedMode = String(mode || '').trim().toLowerCase()
    const envMap = parseCanonicalOriginMapFromEnv()
    const configured = normalizeOrigin(envMap[normalizedMode])
    if (configured) return configured

    const inferred = normalizeOrigin(inferOriginFromHeaders(headerStore))
    if (isLocalOrigin(inferred)) return inferred

    const domainSettings = await getDomainSettingsEntry(normalizedMode)
    const fromDomainSettings = normalizeOrigin(domainSettings?.publicBaseUrl)
    if (fromDomainSettings) return fromDomainSettings

    const builtIn = normalizeOrigin(BUILT_IN_CANONICAL_ORIGINS[normalizedMode])
    if (builtIn) return builtIn

    if (inferred) return inferred

    return 'http://localhost:3000'
}

export function getDefaultOgImageUrl({ mode, origin }) {
    const resolvedOrigin = normalizeOrigin(origin)
    if (!resolvedOrigin) return ''
    const normalizedMode = encodeURIComponent(String(mode || '').trim().toLowerCase())
    return `${resolvedOrigin}/api/og/image?mode=${normalizedMode}`
}

function isLocalOrigin(origin) {
    const resolvedOrigin = normalizeOrigin(origin)
    if (!resolvedOrigin) return false

    try {
        const parsed = new URL(resolvedOrigin)
        const hostname = String(parsed.hostname || '').trim().toLowerCase()
        return isLikelyLocalHostname(hostname)
    } catch {
        return false
    }
}

export function toAbsoluteUrl(origin, value) {
    const resolvedOrigin = normalizeOrigin(origin)
    const normalizedValue = String(value || '').trim()
    if (!resolvedOrigin || !normalizedValue) return ''

    if (/^https?:\/\//i.test(normalizedValue)) {
        return normalizeOrigin(normalizedValue) ? normalizedValue : ''
    }

    if (normalizedValue.startsWith('/')) {
        return `${resolvedOrigin}${normalizedValue}`
    }

    return ''
}

export function resolveDomainOgImage({ mode, origin, configuredImageUrl }) {
    const normalizedMode = String(mode || '').trim().toLowerCase()
    const defaultOgImage = getDefaultOgImageUrl({ mode: normalizedMode, origin })
    const configuredOgImage = toAbsoluteUrl(origin, configuredImageUrl)
    const localPublicOgAsset = toAbsoluteUrl(origin, LOCAL_PUBLIC_OG_ASSET_BY_MODE[normalizedMode])

    // In local dev, prefer settings-backed OG images for modes that store
    // their hero thumbnail locally via admin settings.
    if (isLocalOrigin(origin) && LOCAL_THUMBNAIL_BACKED_OG_MODES.has(normalizedMode)) {
        return defaultOgImage || configuredOgImage
    }

    // For static OG assets, local dev should use the local public file rather
    // than production absolute URLs configured in domain settings.
    if (isLocalOrigin(origin) && localPublicOgAsset) {
        return localPublicOgAsset
    }

    return configuredOgImage || defaultOgImage
}

export function resolveContentOgImage({ metadata, mode, origin }) {
    const candidate = String(metadata?.presentation?.default?.image_url || '').trim()
    const absoluteCandidate = toAbsoluteUrl(origin, candidate)
    if (absoluteCandidate) return absoluteCandidate
    return getDefaultOgImageUrl({ mode, origin })
}

export function getSiteDescription(mode) {
    const normalizedMode = String(mode || '').trim().toLowerCase()
    return BUILT_IN_SITE_DESCRIPTIONS[normalizedMode] || 'Search and content tools'
}

export function getSiteName(mode) {
    return getDomainLabel(mode)
}

export async function getDomainSeoSettings(mode) {
    const entry = await getDomainSettingsEntry(mode)
    const defaults = getDefaultDomainSeoSettings(mode)
    const configured = normalizeDomainSeoSettings(entry?.seo)

    return {
        siteName: configured.siteName || defaults.siteName,
        metaTitle: configured.metaTitle || defaults.metaTitle,
        metaDescription: configured.metaDescription || defaults.metaDescription,
        ogTitle: configured.ogTitle || defaults.ogTitle,
        ogDescription: configured.ogDescription || defaults.ogDescription,
        ogImageUrl: configured.ogImageUrl || defaults.ogImageUrl,
        twitterCard: configured.twitterCard || defaults.twitterCard,
        twitterTitle: configured.twitterTitle || defaults.twitterTitle,
        twitterDescription: configured.twitterDescription || defaults.twitterDescription,
        twitterImageUrl: configured.twitterImageUrl || defaults.twitterImageUrl,
        robotsIndex: typeof entry?.seo?.robotsIndex === 'boolean' ? configured.robotsIndex : defaults.robotsIndex,
        robotsFollow: typeof entry?.seo?.robotsFollow === 'boolean' ? configured.robotsFollow : defaults.robotsFollow,
    }
}