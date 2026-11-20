// Shared between the admin sourcing wizard (client) and the quote-request API (server),
// so the email an admin edits on screen is the same shape that gets queued.

import { getPrivateDomainFieldMap, getPrivateMailDomain } from './domainExtension.js'

const SOURCING_EMAIL_DOMAIN = String(
    process.env.SOURCING_EMAIL_DOMAIN || getPrivateMailDomain() || 'mail.example.com'
).trim()

export const EQUIPMENT_QUOTE_REQUEST_CATEGORY = 'equipment_quote_request'
export const SOURCING_DOMAIN_LOGO_URL_TOKEN = '{{DOMAIN_LOGO_URL}}'

export function toSourcingMailboxSlug(displayName) {
    return String(displayName || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

// Sender mailbox is derived from the domain Display Name, e.g. "Acme Therapy" -> acmetherapy.sourcing@mail.example.com
export function resolveSourcingSenderEmail(displayName) {
    const slug = toSourcingMailboxSlug(displayName)
    return slug ? `${slug}.sourcing@${SOURCING_EMAIL_DOMAIN}` : ''
}

export function resolveSourcingSenderName(displayName) {
    const slug = toSourcingMailboxSlug(displayName)
    const override = getPrivateDomainFieldMap('sourcingSenderName')[slug]
    if (override) return override

    const name = String(displayName || '').trim()
    return name ? `${name} Sourcing` : ''
}

export function resolveSourcingSender(displayName) {
    const email = resolveSourcingSenderEmail(displayName)
    const name = resolveSourcingSenderName(displayName)
    return email && name ? `${name} <${email}>` : email
}

export function resolveSourcingReplyTo(name, email) {
    const address = String(email || '').trim()
    const friendlyName = String(name || '').replace(/[\r\n]/g, '').trim()
    return address && friendlyName ? `${friendlyName} <${address}>` : address
}

function resolvePracticeNameForEmail(value) {
    const raw = String(value || '').trim()
    if (!raw) return 'our practice'

    const normalized = raw.toLowerCase()
    const override = getPrivateDomainFieldMap('practiceDisplayName')[normalized]
    if (override) return override

    return raw
}

function normalizeOrigin(value) {
    const normalized = String(value || '').trim()
    if (!normalized) return ''

    const directCandidate = /^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`

    try {
        const parsed = new URL(directCandidate)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
        return parsed.origin
    } catch {
        return ''
    }
}

export function resolveDomainLogoUrl({ domainKey = '', publicBaseUrl = '', primaryHostname = '', fallbackOrigin = '' } = {}) {
    const normalizedDomainKey = String(domainKey || '').trim().toLowerCase()
    if (!normalizedDomainKey) return ''

    const logoPath = `/${normalizedDomainKey}/logo.png`
    const origins = [publicBaseUrl, primaryHostname, fallbackOrigin]
    for (const originCandidate of origins) {
        const origin = normalizeOrigin(originCandidate)
        if (origin) {
            return `${origin}${logoPath}`
        }
    }

    return logoPath
}

export function applySourcingTemplateTokens(value, { domainLogoUrl = '' } = {}) {
    const source = String(value || '')
    const replacement = String(domainLogoUrl || '').trim()
    return source.split(SOURCING_DOMAIN_LOGO_URL_TOKEN).join(replacement)
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function renderTextAsHtmlParagraphs(value) {
    const source = String(value || '').replace(/\r\n?/g, '\n')
    const blocks = source
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean)

    return blocks
        .map((block) => `<p style="margin:0 0 12px;line-height:1.5;">${escapeHtml(block).replace(/\n/g, '<br/>')}</p>`)
        .join('')
}

function renderSourcingSignatureHtml(signatureTemplate, { domainLogoUrl = '', defaultLogoAlt = 'Domain logo' } = {}) {
    const lines = String(signatureTemplate || '').replace(/\r\n?/g, '\n').split('\n')
    if (lines.length === 0) return ''

    let firstTextLineRendered = false

    const renderedLines = lines.map((line) => {
        const trimmed = String(line || '').trim()
        if (!trimmed) return ''

        if (trimmed === SOURCING_DOMAIN_LOGO_URL_TOKEN) {
            const logoSrc = String(domainLogoUrl || '').trim()
            if (!logoSrc) return ''
            return `<img src="${escapeHtml(logoSrc)}" alt="${escapeHtml(defaultLogoAlt)}" style="display:block;max-width:180px;height:auto;border:0;outline:none;text-decoration:none;"/>`
        }

        const markdownLogoMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
        if (markdownLogoMatch) {
            const logoAlt = String(markdownLogoMatch[1] || '').trim() || defaultLogoAlt
            const logoSrc = applySourcingTemplateTokens(markdownLogoMatch[2], { domainLogoUrl }).trim()
            if (logoSrc) {
                return `<img src="${escapeHtml(logoSrc)}" alt="${escapeHtml(logoAlt)}" style="display:block;max-width:180px;height:auto;border:0;outline:none;text-decoration:none;"/>`
            }
        }

        const renderedText = escapeHtml(applySourcingTemplateTokens(line, { domainLogoUrl }))
        if (!firstTextLineRendered) {
            firstTextLineRendered = true
            return `<strong>${renderedText}</strong>`
        }

        return renderedText
    })

    const compact = renderedLines.filter((line) => line !== '')
    return compact.join('<br/>')
}

function renderSourcingSignatureText(signatureTemplate, { domainLogoUrl = '' } = {}) {
    const lines = String(signatureTemplate || '').replace(/\r\n?/g, '\n').split('\n')
    if (lines.length === 0) return ''

    const rendered = lines.map((line) => {
        const trimmed = String(line || '').trim()
        if (!trimmed) return ''

        if (trimmed === SOURCING_DOMAIN_LOGO_URL_TOKEN) {
            return ''
        }

        const markdownLogoMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
        if (markdownLogoMatch) {
            return ''
        }

        return applySourcingTemplateTokens(line, { domainLogoUrl })
    })

    return rendered.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function buildSourcingSignaturePreviewHtml({
    signatureTemplate = '',
    domainLogoUrl = '',
    practiceName = '',
    senderName = 'Equipment Sourcing',
} = {}) {
    const normalizedSignatureTemplate = String(signatureTemplate || '').trim()
    const resolvedPracticeName = resolvePracticeNameForEmail(practiceName)
    const normalizedSignatureText = renderSourcingSignatureText(normalizedSignatureTemplate, { domainLogoUrl }).trim()

    const signatureHtml = renderSourcingSignatureHtml(normalizedSignatureTemplate, {
        domainLogoUrl,
        defaultLogoAlt: `${resolvedPracticeName || 'Domain'} logo`,
    })

    const defaultSignatureLines = [
        String(senderName || '').trim() || 'Equipment Sourcing',
        resolvedPracticeName,
    ].filter(Boolean)

    const fallbackSignatureHtml = normalizedSignatureText
        ? renderTextAsHtmlParagraphs(normalizedSignatureText)
        : renderTextAsHtmlParagraphs(defaultSignatureLines.join('\n'))

    const renderedSignatureHtml = signatureHtml || fallbackSignatureHtml
    const signOffHtml = renderTextAsHtmlParagraphs('Kind regards,')

    return renderedSignatureHtml
        ? `${signOffHtml}<div style="margin-top:12px;">${renderedSignatureHtml}</div>`
        : signOffHtml
}

function funderLine(funderType, funderReference) {
    const type = String(funderType || '').trim()
    const reference = String(funderReference || '').trim()
    if (type && reference) return `Funding: ${type} — participant/claim number ${reference}`
    if (type) return `Funding: ${type}`
    if (reference) return `Funding reference: ${reference}`
    return 'Funding: to be confirmed'
}

export function buildEquipmentQuoteRequest({
    itemName = '',
    itemDescription = '',
    supplierName = '',
    funderType = '',
    funderReference = '',
    practiceName = '',
    senderName = '',
    deliverySuburb = '',
    emailSignature = '',
    domainLogoUrl = '',
} = {}) {
    const name = String(itemName || '').trim() || 'assistive equipment'
    const subject = `Quote request — ${name}${funderReference ? ` (${String(funderType || 'Funder').trim()} ${String(funderReference).trim()})` : ''}`
    const resolvedPracticeName = resolvePracticeNameForEmail(practiceName)

    const normalizedSignatureTemplate = String(emailSignature || '').trim()

    const baseBodyLines = [
        supplierName ? `Hello ${String(supplierName).trim()} team,` : 'Hello,',
        '',
        `We are seeking a written quote for the following item for a client of ${resolvedPracticeName}:`,
        '',
        `Item: ${name}`,
        String(itemDescription || '').trim() ? `Details: ${String(itemDescription).trim()}` : null,
        funderLine(funderType, funderReference),
        String(deliverySuburb || '').trim() ? `Delivery area: ${String(deliverySuburb).trim()}` : null,
        '',
        'Could you please reply by email with:',
        '1. Itemised pricing (including GST status) and any delivery or setup fees',
        '2. Product make/model and available options or sizing',
        '3. Estimated lead time and trial/hire availability',
        '4. Quote validity period',
        '',
        'Please quote against the funding reference above.',
        '',
        'Kind regards,',
    ].filter((line) => line !== null)

    const bodyLines = [...baseBodyLines]

    const normalizedSignature = renderSourcingSignatureText(normalizedSignatureTemplate, { domainLogoUrl }).trim()
    if (normalizedSignature) {
        bodyLines.push('', ...normalizedSignature.split(/\r?\n/))
    } else {
        bodyLines.push(
            '',
            String(senderName || '').trim() || 'Equipment Sourcing',
            resolvedPracticeName,
        )
    }

    const body = bodyLines.join('\n')
    const quoteHtml = renderTextAsHtmlParagraphs(baseBodyLines.join('\n'))
    const signatureHtml = renderSourcingSignatureHtml(normalizedSignatureTemplate, {
        domainLogoUrl,
        defaultLogoAlt: `${resolvedPracticeName || 'Domain'} logo`,
    })
    const fallbackSignatureHtml = normalizedSignature
        ? renderTextAsHtmlParagraphs(normalizedSignature)
        : ''
    const renderedSignatureHtml = signatureHtml || fallbackSignatureHtml
    const html = renderedSignatureHtml
        ? `${quoteHtml}<div style="margin-top:12px;">${renderedSignatureHtml}</div>`
        : quoteHtml

    return { subject, body, html }
}
