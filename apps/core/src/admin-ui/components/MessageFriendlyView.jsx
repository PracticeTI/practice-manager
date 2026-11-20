'use client'

// Human-readable rendering of a stored email/contact-form message. The raw
// tabs expose exactly what the provider sent; this view answers the question
// an admin actually has — who wrote in, how do I reach them, and what did they say.

const CONTACT_FORM_CATEGORIES = new Set([
    'contact_form',
    'contact-form',
    'contact',
    'website_enquiry',
    'website_enquiry_form',
])

function firstNonEmpty(...values) {
    for (const value of values) {
        if (value === null || value === undefined) continue
        const text = String(value).trim()
        if (text) return text
    }
    return ''
}

function formatDateTime(isoString) {
    if (!isoString) return 'n/a'
    const date = new Date(isoString)
    if (!Number.isFinite(date.getTime())) return 'n/a'
    return date.toLocaleString()
}

function extractEmailAddress(value) {
    const raw = String(value || '').trim()
    if (!raw) return ''
    const angleMatch = raw.match(/<([^<>]+)>/)
    const candidate = (angleMatch ? angleMatch[1] : raw).trim()
    return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(candidate) ? candidate : ''
}

function toHttpUrl(value) {
    const raw = String(value || '').trim()
    if (!raw) return ''
    if (/^https?:\/\//i.test(raw)) return raw
    if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(raw)) return `https://${raw}`
    return ''
}

function toTelHref(value) {
    const digits = String(value || '').replace(/[^\d+]/g, '')
    return digits ? `tel:${digits}` : ''
}

// Reply threads carry the whole back-and-forth; the new text is what the reader
// wants first, so pull the `>`-quoted tail into a collapsed section.
function splitQuotedBody(body) {
    const lines = String(body || '').split(/\r?\n/)
    const firstQuote = lines.findIndex((line) => /^\s*>/.test(line))
    if (firstQuote <= 0) return { main: body, quoted: '' }

    const main = lines.slice(0, firstQuote).join('\n').trim()
    const quoted = lines.slice(firstQuote).join('\n').trim()
    if (!main || !quoted) return { main: body, quoted: '' }
    return { main, quoted }
}

function isContactFormMessage(message) {
    const category = String(message?.category || '').trim().toLowerCase()
    if (CONTACT_FORM_CATEGORIES.has(category)) return true
    const payload = message?.payload || {}
    return Boolean(firstNonEmpty(payload.name) && (firstNonEmpty(payload.message) || firstNonEmpty(payload.enquiry)))
}

/**
 * Normalises a message into the pieces the friendly view renders: a short
 * caption, labelled contact fields, and the readable body text.
 */
export function buildFriendlyMessage(message) {
    if (!message) return null

    const payload = message.payload && typeof message.payload === 'object' ? message.payload : {}
    const isInbound = message.direction === 'inbound'
    const contactForm = isContactFormMessage(message)

    const fields = []
    const addField = (label, value, href) => {
        const text = firstNonEmpty(value)
        if (!text) return
        fields.push({ label, value: text, href: href || '' })
    }
    const addEmailField = (label, value) => {
        const raw = firstNonEmpty(value)
        if (!raw) return
        const address = extractEmailAddress(raw)
        fields.push({
            label,
            value: address || raw,
            href: address ? `mailto:${address}` : '',
        })
    }

    let caption
    let body

    if (contactForm) {
        caption = 'Enquiry message'
        addField('Name', payload.name || payload.fullName || payload.full_name)
        addEmailField('Email', payload.email || payload.replyToEmail)
        const phone = firstNonEmpty(payload.phone, payload.phoneNumber, payload.phone_number)
        addField('Phone', phone, toTelHref(phone))
        addField('Company', payload.company || payload.organisation || payload.organization)
        const website = toHttpUrl(payload.companyWebsite || payload.website)
        addField('Website', website, website)
        addField('Submitted', formatDateTime(payload.submitted_at || payload.submittedAt || message.createdAt))

        body = firstNonEmpty(payload.message, payload.enquiry, payload.body, payload.text, message.textBody)
    } else {
        caption = isInbound ? 'Received email' : 'Message body'
        if (isInbound) {
            addEmailField('From', message.fromEmail || payload.from)
            addEmailField('To', message.toEmail || payload.to)
            addField('Received', formatDateTime(message.processedAt || message.createdAt))
        } else {
            addEmailField('From', message.fromEmail || payload.senderEmail || payload.from)
            addEmailField('To', message.toEmail || payload.to)
            addField('Sent', formatDateTime(message.sentAt || message.createdAt))
        }

        body = firstNonEmpty(message.textBody, payload.text, payload.body, payload.message)
    }

    let fallbackNote = ''
    if (!body) {
        fallbackNote = message.htmlBody
            ? 'This message only has an HTML body. Open the HTML Preview tab to read it.'
            : 'This message has no readable body text. The Raw Payload JSON tab has everything that was received.'
    }

    const { main: bodyText, quoted } = splitQuotedBody(body)

    return {
        caption,
        fields,
        body: bodyText,
        quoted,
        fallbackNote,
        hasHtmlBody: Boolean(message.htmlBody),
    }
}

function Field({ label, value, href }) {
    const isExternal = href.startsWith('http')
    return (
        <div className="flex flex-col gap-0.5">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</dt>
            <dd className="min-w-0 break-all text-sm text-gray-900">
                {href ? (
                    <a
                        href={href}
                        className="text-blue-700 hover:text-blue-900 hover:underline"
                        target={isExternal ? '_blank' : undefined}
                        rel={isExternal ? 'noreferrer' : undefined}
                    >
                        {value}
                    </a>
                ) : value}
            </dd>
        </div>
    )
}

export default function MessageFriendlyView({ message, onOpenHtml, onOpenRaw }) {
    const friendly = buildFriendlyMessage(message)
    if (!friendly) return null

    return (
        <div className="space-y-4">
            {friendly.fields.length > 0 && (
                <dl className="grid grid-cols-1 gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4 sm:grid-cols-2 lg:grid-cols-3">
                    {friendly.fields.map((field) => (
                        <Field key={field.label} {...field} />
                    ))}
                </dl>
            )}

            <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{friendly.caption}</p>
                {friendly.body ? (
                    <div className="mt-2 rounded-lg border border-gray-200 bg-white p-4 text-sm leading-relaxed text-gray-900">
                        <p className="whitespace-pre-wrap">{friendly.body}</p>
                        {friendly.quoted && (
                            <details className="mt-4 border-t border-gray-100 pt-3">
                                <summary className="cursor-pointer text-xs font-medium text-gray-500 hover:text-gray-900">
                                    Show quoted email
                                </summary>
                                <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-gray-500">{friendly.quoted}</pre>
                            </details>
                        )}
                    </div>
                ) : (
                    <div className="mt-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600">
                        <p>{friendly.fallbackNote}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                            {friendly.hasHtmlBody && onOpenHtml && (
                                <button
                                    type="button"
                                    onClick={onOpenHtml}
                                    className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                >
                                    Open HTML Preview
                                </button>
                            )}
                            {onOpenRaw && (
                                <button
                                    type="button"
                                    onClick={onOpenRaw}
                                    className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                >
                                    Open Raw Payload
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
