// Hero-card presentation constants shared by the server capture pipeline and the client
// card layout.
//
// This module must stay dependency-free: a client component imports it, so it cannot pull
// in the Node-only capture library (child_process, fs, ...).
//
// Keeping the viewport size here means the captured image and the CSS box it renders into
// cannot drift apart — changing the height changes the screenshot and the card together.

/**
 * Mobile viewport used for every provider screenshot.
 *
 * Height is deliberately shorter than a real phone's above-the-fold: a full 844px capture
 * made ~900px tall cards, which is too heavy for a directory row. 390x520 (3:4) keeps the
 * header and primary hero content while staying compact.
 */
export const PROVIDER_HERO_VIEWPORT = { width: 390, height: 520 }

export const PROVIDER_HERO_ASPECT_RATIO = `${PROVIDER_HERO_VIEWPORT.width} / ${PROVIDER_HERO_VIEWPORT.height}`

/** Public location of human-approved captures. */
export const PROVIDER_HERO_PUBLIC_PREFIX = '/allied-health/provider-heroes'

/**
 * Bare lowercase hostname for a site, without a leading "www.". Returns '' when unusable.
 *
 * Shared so the capture, hiding and review layers all key a site the same way — an approved asset,
 * a per-host hiding rule and an "unreachable" mark must agree on what identifies a site.
 */
export function providerHeroHostname(value) {
    try {
        return new URL(String(value || '').trim()).hostname.replace(/^www\./, '').toLowerCase()
    } catch {
        return ''
    }
}
