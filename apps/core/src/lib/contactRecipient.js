// Where a public contact-form submission is delivered.
//
// Settings → Domains wins: the management entry may name a recipient directly
// (`contactEmailDelivery.recipient`) or fall back to its `emailContact`. Domains
// that ship their own descriptor can also declare a default, so a fresh
// deployment serves a working form before anyone opens the admin portal.

import { getPrivateDomainContactRecipients } from './domainExtension.js'

function normalizeEmail(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return ''
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : ''
}

/**
 * Resolve the contact-form recipient for a domain.
 *
 * @param {string} domainKey - Domain mode (e.g. `acme`).
 * @param {object|null} [domainEntry] - The domain's `management` settings entry.
 * @returns {string} A normalized address, or '' when nothing is configured.
 */
export function resolveContactRecipient(domainKey, domainEntry) {
  const delivery = domainEntry?.contactEmailDelivery
  const deliveryRecipient = delivery && typeof delivery === 'object' ? delivery.recipient : ''
  const configured = normalizeEmail(deliveryRecipient) || normalizeEmail(domainEntry?.emailContact)
  if (configured) return configured

  const normalizedMode = String(domainKey || '').trim().toLowerCase()
  if (!normalizedMode) return ''

  return normalizeEmail(getPrivateDomainContactRecipients()[normalizedMode])
}

/** True when Settings → Domains explicitly turned contact delivery off. */
export function isContactDeliveryDisabled(domainEntry) {
  const delivery = domainEntry?.contactEmailDelivery
  return Boolean(delivery && typeof delivery === 'object' && delivery.enabled === false)
}
