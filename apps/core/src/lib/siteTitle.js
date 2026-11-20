/**
 * Returns the site title stored in a practice home-page template object.
 * Falls back to an empty string if not set.
 * @param {object|null|undefined} template
 * @returns {string}
 */
export function getSiteTitleFromTemplate(template) {
    return String(template?.siteTitle || '').trim()
}

/**
 * Returns whether the practice site title should be shown on the public site.
 * Defaults to true for older templates that do not yet persist the flag.
 * @param {object|null|undefined} template
 * @returns {boolean}
 */
export function shouldShowSiteTitleOnPublicSite(template) {
    return template?.showSiteTitleOnPublicSite !== false
}

/**
 * Returns the public-facing practice site title when enabled.
 * Falls back to an empty string when the title is hidden.
 * @param {object|null|undefined} template
 * @returns {string}
 */
export function getPublicSiteTitleFromTemplate(template) {
    const siteTitle = getSiteTitleFromTemplate(template)
    return shouldShowSiteTitleOnPublicSite(template) ? siteTitle : ''
}
