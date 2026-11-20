/**
 * Per-domain favicon and app icon assets.
 *
 * Entries reference static raster icons under `/public` that are derived from a
 * domain's master artwork (`public/<domain>/favicon.png`). Modes without an
 * entry fall back to the initials SVG served by `/api/branding/icon`.
 *
 * Customer-specific icon sets arrive from the private overlay; see
 * lib/domainExtension.js.
 */
import { getPrivateBrandIconSets } from './domainExtension.js'
import { DEFAULT_DOMAIN_MODE } from './domainMode.js'

const DEFAULT_ICON_MODE = DEFAULT_DOMAIN_MODE
const FALLBACK_ICON_SIZE = '64x64'

const CORE_BRAND_ICON_SETS = {}

const BRAND_ICON_SET_BY_MODE = {
    ...CORE_BRAND_ICON_SETS,
    ...getPrivateBrandIconSets(),
}


export function normalizeBrandIconMode(mode) {
    const normalized = typeof mode === 'string' ? mode.trim().toLowerCase() : ''
    return normalized || DEFAULT_ICON_MODE
}

/** Safari pinned-tab icon: a monochrome vector mounted as `rel="mask-icon"`. */
function getBrandMaskIcon(mode) {
    const set = getBrandIconSet(mode)
    if (!set?.maskIcon) return null
    return { url: set.maskIcon, color: set.maskIconColor }
}

export function getBrandIconSet(mode) {
    return BRAND_ICON_SET_BY_MODE[normalizeBrandIconMode(mode)] || null
}

function getBrandIconEntries(mode) {
    const set = getBrandIconSet(mode)
    if (set) return set.icons
    return [
        {
            src: `/api/branding/icon?mode=${normalizeBrandIconMode(mode)}`,
            sizes: FALLBACK_ICON_SIZE,
            type: 'image/svg+xml',
        },
    ]
}

/**
 * Icon candidates for a domain as `{ url, sizes, type, width }`.
 * `width` is `null` for scalable sources (the SVG fallback), which can serve any size.
 */
export function resolveBrandIconCandidates(mode) {
    return getBrandIconEntries(mode).map(({ src, sizes, type }) => ({
        url: src,
        sizes,
        type,
        width: type === 'image/svg+xml' ? null : Number.parseInt(sizes, 10),
    }))
}

/**
 * Pick the best candidate for a display size: the smallest icon that still covers it,
 * so rendering never upscales a smaller raster. Scalable candidates always win.
 */
export function pickBrandIconForSize(candidates, size) {
    if (!Array.isArray(candidates) || candidates.length === 0) return null

    const scalable = candidates.find((candidate) => candidate.width === null)
    if (scalable) return scalable

    const covering = candidates
        .filter((candidate) => Number.isFinite(candidate.width) && candidate.width >= size)
        .sort((a, b) => a.width - b.width)
    if (covering.length > 0) return covering[0]

    return candidates.reduce((largest, candidate) =>
        (candidate.width || 0) > (largest.width || 0) ? candidate : largest
    )
}

/** Best single icon URL for tab-scale previews (e.g. the /presence page). */
export function resolveBrandIconUrl(mode) {
    const set = getBrandIconSet(mode)
    if (set) return set.tabIcon
    return getBrandIconEntries(mode)[0].src
}

/** URL for the home-screen icon used by iOS/Safari. */
export function resolveBrandAppleIconUrl(mode) {
    const set = getBrandIconSet(mode)
    if (set) return set.apple
    return getBrandIconEntries(mode)[0].src
}

/** Value for the Next.js `metadata.icons` field. */
export function resolveBrandIconLinks(mode) {
    const icon = getBrandIconEntries(mode).map(({ src, sizes, type }) => ({ url: src, sizes, type }))
    const set = getBrandIconSet(mode)
    const maskIcon = getBrandMaskIcon(mode)

    return {
        icon,
        shortcut: resolveBrandIconUrl(mode),
        apple: set
            ? { url: set.apple, sizes: set.appleSizes, type: 'image/png' }
            : icon[0].url,
        ...(maskIcon ? { other: [{ rel: 'mask-icon', url: maskIcon.url }] } : {}),
    }
}

/** URL for the monochrome Safari pinned-tab icon, if this domain has one. */
export function resolveBrandMaskIcon(mode) {
    return getBrandMaskIcon(mode)
}

/** Value for the PWA manifest `icons` array. */
export function resolveBrandManifestIcons(mode) {
    return getBrandIconEntries(mode).map(({ src, sizes, type }) => ({ src, sizes, type }))
}
