/**
 * Practice-type brand marks for the admin header.
 *
 * When an admin works in a practice type that has its own brand mark, that mark
 * becomes the primary brand in the header and the domain logo is demoted to a
 * co-brand on the right. Superadmins get the same lockup by default.
 *
 * Every practice type currently shares the open-source Practice Manager lockup, so the
 * header reads the same whichever practice the domain runs. A private domain overrides it
 * with its own `brandMark` descriptor field (`getPrivateDomainBrandMark`).
 */

import { PRACTICE_TYPE_OPTIONS, normalizePracticeType } from './practiceTypes.js'
import { isAnyAdminUser } from './adminRoles.js'

const PRACTICE_MANAGER = {
    src: '/branding/practice-manager-logo.png',
    alt: 'Practice Manager',
    // Intrinsic size of the lockup, so the header can size it without distortion.
    width: 2025,
    height: 554,
}

export const PRACTICE_TYPE_BRAND_IMAGES = Object.fromEntries(
    PRACTICE_TYPE_OPTIONS.map(({ value }) => [value, PRACTICE_MANAGER])
)

/**
 * Brand mark for a practice type, or null when the type has none.
 *
 * @param {string} practiceType - Stored practice type value (e.g. `occupational_therapy`).
 * @param {string} [domainKey] - Used to resolve the default for unnamed types.
 * @param {{ src: string, alt?: string, width?: number, height?: number }|null} [brandMark] - Domain override.
 * @returns {{ src: string, alt: string, width: number, height: number, practiceType: string }|null}
 */
export function getPracticeTypeBrandImage(practiceType, domainKey = '', brandMark = null) {
    const normalized = normalizePracticeType(practiceType, domainKey)
    const brand = PRACTICE_TYPE_BRAND_IMAGES[normalized]
    if (!brand) return null
    return {
        ...brand,
        ...(brandMark?.src ? { src: brandMark.src } : {}),
        ...(brandMark?.alt ? { alt: brandMark.alt } : {}),
        ...(Number(brandMark?.width) > 0 ? { width: Number(brandMark.width) } : {}),
        ...(Number(brandMark?.height) > 0 ? { height: Number(brandMark.height) } : {}),
        practiceType: normalized,
    }
}

/**
 * True when the signed-in admin should see the practice/domain brand lockup. Every
 * admin gets it — superadmins included — so the header never falls back to a text title.
 *
 * @param {{ role?: string, simulated?: boolean }|null} user
 * @returns {boolean}
 */
export function shouldUsePracticeTypeBranding(user) {
    if (!user) return false
    return isAnyAdminUser(user) || user.simulated === true
}
