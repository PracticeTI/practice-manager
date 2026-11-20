/**
 * Notification types surfaced by the admin notification panel.
 *
 * Shared by the client panel and the server helpers so both agree on ids,
 * labels, and defaults. Whatever an admin changes is stored as the difference
 * from their domain's defaults.
 *
 * Every type also declares who it is addressed to and how it reaches them, which
 * is what decides delivery and whether a per-admin opt-out means anything - see
 * `NOTIFICATION_AUDIENCE` and `NOTIFICATION_DELIVERY`. A per-admin preference
 * only governs an alert addressed to the admin's own address; a site-wide alert
 * is routed by the domain's own settings instead.
 */

/**
 * Who a notification is addressed to.
 *
 * - `domain` types go to the inbox a domain configures for that job, which is
 *   typically a shared or role address. That destination is a domain setting, so
 *   a per-admin preference has nothing to change here.
 * - `admins` types fan out to every admin of the domain at their own address, so
 *   each admin's preference governs their own copy and nobody else's.
 */
export const NOTIFICATION_AUDIENCE = {
    DOMAIN: 'domain',
    ADMINS: 'admins',
}

/**
 * How a notification reaches anyone at all.
 *
 * - `email` types queue an alert email, to the audience above.
 * - `panel` types exist only in the notification panel: they are derived from
 *   activity the app already records (an inbound reply, a logged chat, a failed
 *   outbound message), so there is no alert email to send and nothing for an
 *   opt-out to change.
 */
export const NOTIFICATION_DELIVERY = {
    EMAIL: 'email',
    PANEL: 'panel',
}

/**
 * The order here is the order the panel lists them in, with the site-routed
 * contact form alert last so an admin reads their own alerts first.
 */
export const NOTIFICATION_TYPES = [
    {
        id: 'inbound_email',
        label: 'Inbound email replies',
        description: 'An email arrived in one of your domain mailboxes.',
        audience: NOTIFICATION_AUDIENCE.DOMAIN,
        delivery: NOTIFICATION_DELIVERY.PANEL,
    },
    {
        id: 'chat_session',
        label: 'Website chat sessions',
        description: 'A visitor finished a chat conversation on your website.',
        audience: NOTIFICATION_AUDIENCE.DOMAIN,
        delivery: NOTIFICATION_DELIVERY.PANEL,
    },
    {
        id: 'equipment_quote_reply',
        label: 'Equipment quote replies',
        description: 'A supplier replied to an equipment quote request.',
        audience: NOTIFICATION_AUDIENCE.ADMINS,
        delivery: NOTIFICATION_DELIVERY.EMAIL,
    },
    {
        id: 'email_failure',
        label: 'Email delivery failures',
        description: 'One of your domain emails failed to send and needs attention.',
        audience: NOTIFICATION_AUDIENCE.DOMAIN,
        delivery: NOTIFICATION_DELIVERY.PANEL,
    },
    {
        id: 'contact_form',
        label: 'Website contact form enquiries',
        description: 'Someone submitted the contact form on one of your sites.',
        audience: NOTIFICATION_AUDIENCE.DOMAIN,
        delivery: NOTIFICATION_DELIVERY.EMAIL,
    },
]

/**
 * Map an outbound email queue `category` onto a notification type.
 * Categories without an entry are not admin notifications and are never
 * filtered by notification preferences.
 */
const CATEGORY_TO_NOTIFICATION_TYPE = {
    contact_form: 'contact_form',
    chatbot_log: 'chat_session',
    chatbot_logs: 'chat_session',
    equipment_quote_reply: 'equipment_quote_reply',
}

/**
 * Preference keys written before a type was renamed. The quote alert used to
 * cover the request going out; it now covers the supplier's reply, so an admin
 * who had turned it off stays off.
 */
const LEGACY_NOTIFICATION_TYPE_IDS = {
    equipment_quote_reply: 'equipment_quote_request',
}

/**
 * Types that are on before an admin touches anything. Nothing is: the contact
 * form alert is routed by the domain rather than by an admin preference, so
 * there is no alert that starts out subscribed. An admin opts in to what they
 * want emailed to them.
 */
const DEFAULT_ON_NOTIFICATION_TYPE_IDS = []

/**
 * Domains that keep every type on by default: they run the searching and
 * sourcing features the emailable types belong to, so their admins start out
 * subscribed to the supplier reply alerts.
 */
const ALL_TYPES_DEFAULT_ON_DOMAINS = getPrivateDomainModesWithFlag('allNotificationsDefaultOn')

/**
 * The `user_settings` scope a per-admin notification value belongs to: the
 * caller's domain, or a reserved fleet-wide scope when the feed spans every
 * domain. A real domain mode can never be `*`.
 */
export const FLEET_WIDE_SETTINGS_SCOPE = '*'

export function resolveNotificationSettingsScope(domain) {
    const normalized = String(domain || '').trim().toLowerCase()
    return normalized || FLEET_WIDE_SETTINGS_SCOPE
}

/**
 * The id -> boolean defaults for a domain. A null or unrecognised domain uses
 * the opt-in set, which is what a fleet-wide admin sees.
 */
export function notificationDefaultsForDomain(domain) {
    const normalized = String(domain || '').trim().toLowerCase()
    const allOn = ALL_TYPES_DEFAULT_ON_DOMAINS.includes(normalized)
    const defaults = {}

    for (const { id } of NOTIFICATION_TYPES) {
        defaults[id] = allOn || DEFAULT_ON_NOTIFICATION_TYPE_IDS.includes(id)
    }

    return defaults
}

export const NOTIFICATION_TYPE_IDS = NOTIFICATION_TYPES.map((type) => type.id)

export function notificationTypeForCategory(category) {
    const normalized = String(category || '').trim().toLowerCase()
    return CATEGORY_TO_NOTIFICATION_TYPE[normalized] || null
}

/**
 * Who a type is addressed to. An id this registry does not know - or a category
 * with no type at all - is reported as domain-addressed, so an unrecognised
 * notification is never fanned out to every admin's inbox.
 */
export function notificationAudienceForType(value) {
    const id = String(value || '').trim()
    const match = NOTIFICATION_TYPES.find((type) => type.id === id)
    return match?.audience || NOTIFICATION_AUDIENCE.DOMAIN
}

export function notificationAudienceForCategory(category) {
    return notificationAudienceForType(notificationTypeForCategory(category))
}

/**
 * Whether a type emails at all. An id this registry does not know - or a
 * category with no type at all - is reported as `email`, so a notification we
 * cannot classify keeps reaching its recipients instead of being dropped.
 */
export function notificationDeliveryForType(value) {
    const id = String(value || '').trim()
    const match = NOTIFICATION_TYPES.find((type) => type.id === id)
    return match?.delivery || NOTIFICATION_DELIVERY.EMAIL
}

export function notificationDeliveryForCategory(category) {
    return notificationDeliveryForType(notificationTypeForCategory(category))
}

/**
 * Whether an admin can turn a type off for their own inbox.
 *
 * Only an admin-addressed email is *their* alert: a domain-addressed one is
 * routed by a domain setting, and a panel-only one sends nothing, so neither has
 * a per-admin preference to set. An unknown type reports false, which keeps the
 * panel from offering a switch that could not mean anything.
 */
export function isPerAdminNotificationType(value) {
    const id = String(value || '').trim()
    const match = NOTIFICATION_TYPES.find((type) => type.id === id)
    if (!match) return false

    return match.delivery === NOTIFICATION_DELIVERY.EMAIL && match.audience === NOTIFICATION_AUDIENCE.ADMINS
}

export function isNotificationTypeId(value) {
    return NOTIFICATION_TYPE_IDS.includes(String(value || '').trim())
}

/**
 * Coerce a stored preferences value into the full id -> boolean map. Anything
 * the admin never set falls back to their domain's default.
 */
export function normalizeNotificationPreferences(value, domain = null) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    const defaults = notificationDefaultsForDomain(domain)
    const preferences = {}

    for (const { id } of NOTIFICATION_TYPES) {
        const legacyId = LEGACY_NOTIFICATION_TYPE_IDS[id]
        const stored = source[id] === undefined && legacyId ? source[legacyId] : source[id]
        preferences[id] = typeof stored === 'boolean' ? stored : defaults[id] === true
    }

    return preferences
}

/**
 * Reduce a preferences map to the entries that differ from the domain's
 * defaults, so a stored row stays small and untouched types keep tracking the
 * defaults as they change.
 */
export function toStoredNotificationPreferences(value, domain = null) {
    const normalized = normalizeNotificationPreferences(value, domain)
    const defaults = notificationDefaultsForDomain(domain)
    const stored = {}

    for (const [id, enabled] of Object.entries(normalized)) {
        if (enabled !== defaults[id]) stored[id] = enabled
    }

    return stored
}

export function isNotificationEnabled(preferences, typeId, domain = null) {
    const normalizedTypeId = String(typeId || '').trim()
    if (!normalizedTypeId) return true

    return normalizeNotificationPreferences(preferences, domain)[normalizedTypeId] !== false
}

/**
 * Trim a recipient list to the non-empty strings it contains.
 */
export function normalizeNotificationRecipients(recipients) {
    return (Array.isArray(recipients) ? recipients : [recipients])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
}

/**
 * Pull the bare address out of a `Name <email>` style recipient while leaving
 * plain addresses untouched, so matching works for both shapes.
 */
export function extractEmailAddress(value) {
    const raw = String(value || '').trim()
    const angleMatch = raw.match(/<([^>]+)>/)
    return String(angleMatch ? angleMatch[1] : raw).trim().toLowerCase()
}

/**
 * Decide what a recipient list looks like once opted-out addresses are removed.
 *
 * `allSuppressed` means every recipient was opted out. The caller decides what
 * to do with a message that has nobody left to email - for contact form alerts
 * that means recording it in the notification feed instead of sending.
 */
export function applyNotificationRecipientFilter({ recipients = [], suppressedAddresses = [] } = {}) {
    const list = normalizeNotificationRecipients(recipients)
    if (list.length === 0) {
        return { recipients: [], suppressed: [], allSuppressed: false }
    }

    const listAddresses = list.map(extractEmailAddress)
    const suppressed = (Array.isArray(suppressedAddresses) ? suppressedAddresses : [])
        .map((address) => String(address || '').trim().toLowerCase())
        .filter((address) => address && listAddresses.includes(address))

    if (suppressed.length === 0) {
        return { recipients: list, suppressed: [], allSuppressed: false }
    }

    const allowed = list.filter((value) => !suppressed.includes(extractEmailAddress(value)))
    if (allowed.length === 0) {
        return { recipients: [], suppressed, allSuppressed: true }
    }

    return { recipients: allowed, suppressed, allSuppressed: false }
}
import { getPrivateDomainModesWithFlag } from './domainExtension.js'

