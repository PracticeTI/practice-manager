// Web form alerts (public contact forms) use a per-domain mailbox so recipients
// can tell which site an enquiry came from, e.g.
//   example     ->  "Example Contact Form" <example.contact@mail.example.com>
// instead of the shared alerts@ mailbox configured by the email worker.
//
// The mailbox local part is derived from the domain key (stable / provisioned),
// while the friendly name comes from the domain's configured display name.
// Replies are routed back to the person who submitted the form.

import { getPrivateDomainFieldMap, getPrivateMailDomain } from './domainExtension.js'

export const FORM_ALERT_EMAIL_DOMAIN = String(
    process.env.FORM_ALERT_EMAIL_DOMAIN || getPrivateMailDomain() || 'mail.example.com'
).trim()

// Friendly-name overrides for domains whose key does not pretty-print the way
// the practice writes its own name ("Acme OT" when the key is "acmeot").
const FORM_ALERT_DISPLAY_NAME_OVERRIDES = getPrivateDomainFieldMap('formAlertDisplayName')

function toMailboxSlug(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

export function resolveFormAlertSenderEmail(domainKey) {
    const slug = toMailboxSlug(domainKey)
    return slug ? `${slug}.contact@${FORM_ALERT_EMAIL_DOMAIN}` : ''
}

export function resolveFormAlertSenderName(domainKey, displayName = '') {
    const slug = toMailboxSlug(domainKey)
    if (!slug) return ''

    const label = FORM_ALERT_DISPLAY_NAME_OVERRIDES[slug] || String(displayName || '').trim() || slug
    return `${label} Contact Form`
}

// RFC-5322 style sender for the email queue, e.g.
//   'Example Contact Form <example.contact@mail.example.com>'
export function resolveFormAlertSender(domainKey, displayName = '') {
    const email = resolveFormAlertSenderEmail(domainKey)
    if (!email) return ''

    const name = resolveFormAlertSenderName(domainKey, displayName)
    return name ? `${name} <${email}>` : email
}

// Reply-To for a form alert: the submitter, so hitting Reply on the alert writes
// back to the person who filled in the form rather than the sending mailbox.
// Header values must stay single-line, so CR/LF are stripped from the name.
export function resolveFormAlertReplyTo(submitterName, submitterEmail) {
    const address = String(submitterEmail || '').trim()
    const name = String(submitterName || '').replace(/[\r\n]/g, '').trim()
    if (!address) return ''

    return name ? `${name} <${address}>` : address
}
