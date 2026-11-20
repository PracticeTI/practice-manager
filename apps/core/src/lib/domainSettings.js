import {
    getPrivateDomainDefinitions,
    getPrivateSeoPresets,
} from './domainExtension.js'
import { DEFAULT_DOMAIN_KEY } from './domainMode.js'

const CORE_DOMAIN_DEFINITIONS = [
    { key: DEFAULT_DOMAIN_KEY, name: 'Default', description: 'Default workspace and unbranded public site.' },
]

export const DEFAULT_DOMAIN_DEFINITIONS = [
    ...CORE_DOMAIN_DEFINITIONS,
    ...getPrivateDomainDefinitions(),
]

/**
 * Only a configured domain may be chosen as the Default Domain. Saved settings can
 * still carry a key from a retired mode, which is why this tests membership rather
 * than listing the keys to exclude.
 */
export function isDefaultDomainSelectorOption(domainKey) {
    const key = String(domainKey || '').trim().toLowerCase()
    return DEFAULT_DOMAIN_DEFINITIONS.some((definition) => definition.key === key)
}

export const DEFAULT_DOMAIN_SEO_SETTINGS = {
    siteName: '',
    metaTitle: '',
    metaDescription: '',
    ogTitle: '',
    ogDescription: '',
    ogImageUrl: '',
    twitterCard: 'summary_large_image',
    twitterTitle: '',
    twitterDescription: '',
    twitterImageUrl: '',
    robotsIndex: true,
    robotsFollow: true,
}

const DOMAIN_SEO_PRESETS = {
    ...getPrivateSeoPresets(),
}

function normalizeString(value) {
    return String(value || '').trim()
}

function normalizeBoolean(value, fallback = false) {
    if (typeof value === 'boolean') return value
    return fallback
}

function normalizeTwitterCard(value) {
    const normalized = normalizeString(value).toLowerCase()
    if (normalized === 'summary' || normalized === 'summary_large_image') {
        return normalized
    }
    return DEFAULT_DOMAIN_SEO_SETTINGS.twitterCard
}

export function getDefaultDomainSeoSettings(domainKey) {
    const normalizedDomainKey = String(domainKey || '').trim().toLowerCase()
    const preset = DOMAIN_SEO_PRESETS[normalizedDomainKey] || {}
    return {
        ...DEFAULT_DOMAIN_SEO_SETTINGS,
        ...preset,
    }
}

export function normalizeDomainSeoSettings(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}

    return {
        siteName: normalizeString(source.siteName),
        metaTitle: normalizeString(source.metaTitle),
        metaDescription: normalizeString(source.metaDescription),
        ogTitle: normalizeString(source.ogTitle),
        ogDescription: normalizeString(source.ogDescription),
        ogImageUrl: normalizeString(source.ogImageUrl),
        twitterCard: normalizeTwitterCard(source.twitterCard),
        twitterTitle: normalizeString(source.twitterTitle),
        twitterDescription: normalizeString(source.twitterDescription),
        twitterImageUrl: normalizeString(source.twitterImageUrl),
        robotsIndex: normalizeBoolean(source.robotsIndex, DEFAULT_DOMAIN_SEO_SETTINGS.robotsIndex),
        robotsFollow: normalizeBoolean(source.robotsFollow, DEFAULT_DOMAIN_SEO_SETTINGS.robotsFollow),
    }
}

export function formatDomainLabelFromKey(domainKey) {
    return String(domainKey || '')
        .split('-')
        .filter(Boolean)
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join(' ')
}

export function buildDomainOptions(configuredDomains = {}) {
    const defaultsByKey = new Map(DEFAULT_DOMAIN_DEFINITIONS.map((item) => [item.key, item]))
    const mergedDomainMap = {}

    DEFAULT_DOMAIN_DEFINITIONS.forEach((item) => {
        mergedDomainMap[item.key] = {
            domainKey: item.key,
            displayName: item.name,
            updatedAt: null,
        }
    })

    Object.entries(configuredDomains || {}).forEach(([domainKey, value]) => {
        const existing = mergedDomainMap[domainKey] || {
            domainKey,
            displayName: defaultsByKey.get(domainKey)?.name || formatDomainLabelFromKey(domainKey),
            updatedAt: null,
        }

        mergedDomainMap[domainKey] = {
            ...existing,
            ...(value || {}),
            domainKey,
        }
    })

    const sortedKeys = Object.keys(mergedDomainMap).sort((leftKey, rightKey) => {
        const leftUpdatedAt = Date.parse(mergedDomainMap[leftKey]?.updatedAt || '')
        const rightUpdatedAt = Date.parse(mergedDomainMap[rightKey]?.updatedAt || '')
        const leftHasTimestamp = Number.isFinite(leftUpdatedAt)
        const rightHasTimestamp = Number.isFinite(rightUpdatedAt)

        if (leftHasTimestamp && rightHasTimestamp && leftUpdatedAt !== rightUpdatedAt) {
            return rightUpdatedAt - leftUpdatedAt
        }

        if (leftHasTimestamp !== rightHasTimestamp) {
            return leftHasTimestamp ? -1 : 1
        }

        return leftKey.localeCompare(rightKey)
    })

    return sortedKeys.map((domainKey) => {
        const defaults = defaultsByKey.get(domainKey)
        const displayName = String(
            mergedDomainMap[domainKey]?.displayName || defaults?.name || formatDomainLabelFromKey(domainKey)
        ).trim()

        return {
            key: domainKey,
            label: displayName || formatDomainLabelFromKey(domainKey),
            description: defaults?.description || '',
        }
    })
}
