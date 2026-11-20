// What a report's branded page header shows.
//
// The practice's reference FCA carries the practice logo, one line of practitioner credentials and
// a hairline rule at the top of every page. The same header is drawn by the browser paginator and
// by the Word writer, so its content is resolved here rather than in either renderer.
//
// Branding is configuration, never customer data: the logo path is the domain's own public asset
// (`/<domain>/logo.png`, the same convention as quote emails) unless the practice overrides it, and
// the credential line is a report setting. Nothing in this module names a practice.

function asPlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

/** Accept the shapes a caller may have: the stored settings row, the API response, or bare config. */
export function resolveReportConfig({ settings = null, config = null } = {}) {
    const direct = asPlainObject(config)
    if (direct) return direct

    const nested = asPlainObject(settings?.settings?.config)
    if (nested) return nested

    return asPlainObject(settings?.config) || {}
}

function firstNonEmptyLine(value) {
    return String(value || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) || ''
}

/**
 * The line under the logo: the configured header line, else the practitioner named in Provider
 * details, else the practice name. Credentials are never inferred - a practice that wants "AHPRA
 * registered" in the header sets it in Report settings.
 */
export function resolveReportHeaderText(config, practiceName = '') {
    const configured = String(config?.reportHeaderText || '').trim()
    if (configured) return configured

    const provider = firstNonEmptyLine(config?.providerDetails)
    if (provider) return provider

    return String(practiceName || '').trim()
}

/** The logo in the header: a configured override, else the domain's own logo asset. */
export function resolveReportHeaderLogoUrl({ domain = '', config = null, logoOrigin = '' } = {}) {
    const configured = String(config?.reportHeaderLogoUrl || '').trim()
    if (configured) return configured

    const domainKey = String(domain || '').trim().toLowerCase()
    if (!domainKey) return ''

    const path = `/${domainKey}/logo.png`
    const origin = String(logoOrigin || '').trim().replace(/\/+$/, '')
    return origin ? `${origin}${path}` : path
}

/**
 * Resolve the header the renderers should draw, or null when the practice has configured neither a
 * logo nor a line. Returning null keeps an unbranded report laid out exactly as it was.
 */
export function buildReportBranding({ domain = '', settings = null, config = null, practiceName = '', logoOrigin = '' } = {}) {
    const resolvedConfig = resolveReportConfig({ settings, config })
    const text = resolveReportHeaderText(resolvedConfig, practiceName)
    const logoUrl = resolveReportHeaderLogoUrl({ domain, config: resolvedConfig, logoOrigin })

    if (!text && !logoUrl) return null
    return { logoUrl, text }
}
