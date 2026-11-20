// Shared metadata for the public Allied Health directory pages.
//
// These pages belong to the directory operator's own site even when they are reached through a
// client hostname: the routes exist on every host, and the directory's own "sign in to favourite"
// link is relative, so an admin stays on the host they arrived on. The root layout derives
// `canonical` and `openGraph` from the *request host*, which would let a shared link preview with
// whichever brand the sharer happened to be on.
//
// A deployment that wants one stable canonical origin declares it via the private overlay
// (`alliedHealthBrand`). Without that declaration the canonical stays host-relative and each host
// resolves its own origin, which is the correct default for the open-source distribution.
//
// metadataBase is deliberately NOT overridden, so per-host icons and the web manifest keep
// resolving against the host the page was served from.

import { getPrivateDomainFieldMap } from './domainExtension.js'

const ALLIED_HEALTH_BRAND = Object.values(getPrivateDomainFieldMap('alliedHealthBrand'))[0] || null

export const ALLIED_HEALTH_ORIGIN = ALLIED_HEALTH_BRAND?.origin || ''
export const ALLIED_HEALTH_SITE_NAME = ALLIED_HEALTH_BRAND?.siteName || 'Allied Health Directory'

// A committed raster rather than /api/og/image, because social scrapers do not render the SVG
// that route falls back to.
const OG_IMAGE_URL = ALLIED_HEALTH_BRAND?.ogImage
    ? `${ALLIED_HEALTH_ORIGIN}${ALLIED_HEALTH_BRAND.ogImage}`
    : null
const OG_IMAGE_WIDTH = 1200
const OG_IMAGE_HEIGHT = 630

export function buildAlliedHealthDirectoryMetadata({ path, title, description }) {
    const canonical = ALLIED_HEALTH_ORIGIN ? `${ALLIED_HEALTH_ORIGIN}${path}` : path

    return {
        title,
        description,
        alternates: { canonical },
        openGraph: {
            type: 'website',
            title,
            description,
            url: canonical,
            siteName: ALLIED_HEALTH_SITE_NAME,
            ...(OG_IMAGE_URL
                ? {
                    images: [{
                        url: OG_IMAGE_URL,
                        width: OG_IMAGE_WIDTH,
                        height: OG_IMAGE_HEIGHT,
                        alt: `${ALLIED_HEALTH_SITE_NAME} directory`,
                    }],
                }
                : {}),
        },
        twitter: {
            card: 'summary_large_image',
            title,
            description,
            ...(OG_IMAGE_URL ? { images: [OG_IMAGE_URL] } : {}),
        },
    }
}
