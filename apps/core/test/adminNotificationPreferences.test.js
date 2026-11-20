import test from 'node:test'
import assert from 'node:assert/strict'
import {
    NOTIFICATION_AUDIENCE,
    NOTIFICATION_DELIVERY,
    NOTIFICATION_TYPES,
    applyNotificationRecipientFilter,
    extractEmailAddress,
    isNotificationEnabled,
    isPerAdminNotificationType,
    normalizeNotificationPreferences,
    notificationAudienceForCategory,
    notificationAudienceForType,
    notificationDefaultsForDomain,
    notificationDeliveryForCategory,
    notificationDeliveryForType,
    notificationTypeForCategory,
    toStoredNotificationPreferences,
    resolveNotificationSettingsScope,
} from '../src/lib/notificationTypes.js'

test('nothing is on by default without a domain opt-in', () => {
    for (const domain of ['example-domain', 'default', null, '']) {
        const preferences = normalizeNotificationPreferences(null, domain)

        for (const { id } of NOTIFICATION_TYPES) {
            assert.equal(preferences[id], false, `${domain || 'no domain'} should default ${id} off`)
        }
    }
})

// The contact form's destination is a domain setting, so an admin's preference
// starts empty rather than claiming a subscription they never had.
test('contact form alerts start unsubscribed like every other type', () => {
    assert.equal(normalizeNotificationPreferences(null, 'domain-a').contact_form, false)
    assert.equal(normalizeNotificationPreferences(null, null).contact_form, false)
})

test('matches the domain regardless of case or padding', () => {
    assert.equal(notificationDefaultsForDomain('  Example-Domain ').chat_session, false)
})

test('only an explicit stored value beats the default', () => {
    const preferences = normalizeNotificationPreferences(
        { contact_form: false, inbound_email: 'no', chat_session: true },
        'example-domain'
    )

    assert.equal(preferences.contact_form, false)
    assert.equal(preferences.inbound_email, false)
    assert.equal(preferences.chat_session, true)
    assert.equal(preferences.equipment_quote_reply, false)
})

test('persists only the values that differ from the defaults', () => {
    assert.deepEqual(toStoredNotificationPreferences({ equipment_quote_reply: true, chat_session: false }, 'example-domain'), {
        equipment_quote_reply: true,
    })
})

test('maps queue categories onto notification types', () => {
    assert.equal(notificationTypeForCategory('contact_form'), 'contact_form')
    assert.equal(notificationTypeForCategory('chatbot_logs'), 'chat_session')
    assert.equal(notificationTypeForCategory('equipment_quote_reply'), 'equipment_quote_reply')
    assert.equal(notificationTypeForCategory('generic'), null)
    assert.equal(notificationTypeForCategory(null), null)
})

// The quote alert used to be raised when a request went out. An admin who had
// turned it off must stay opted out now that it covers the supplier's reply.
test('carries an opt-out over from the renamed quote alert type', () => {
    const preferences = normalizeNotificationPreferences({ equipment_quote_request: false }, 'example-domain')

    assert.equal(preferences.equipment_quote_reply, false)
})

test('isNotificationEnabled follows the domain defaults', () => {
    assert.equal(isNotificationEnabled({ contact_form: false }, 'contact_form', 'example-domain'), false)
    assert.equal(isNotificationEnabled({}, 'chat_session', 'example-domain'), false)
    assert.equal(isNotificationEnabled({ chat_session: true }, 'chat_session', 'example-domain'), true)
    assert.equal(isNotificationEnabled({}, null), true)
})

// Who a type is addressed to decides how it is delivered, so every type has to
// declare one rather than falling through to a default nobody chose.
test('every type declares a known audience', () => {
    for (const type of NOTIFICATION_TYPES) {
        assert.ok(
            [NOTIFICATION_AUDIENCE.DOMAIN, NOTIFICATION_AUDIENCE.ADMINS].includes(type.audience),
            `${type.id} must declare an audience`
        )
    }
})

test('site-wide alerts are domain-addressed and only the quote reply reaches admins', () => {
    assert.equal(notificationAudienceForType('contact_form'), NOTIFICATION_AUDIENCE.DOMAIN)
    assert.equal(notificationAudienceForType('equipment_quote_reply'), NOTIFICATION_AUDIENCE.ADMINS)

    const adminAddressed = NOTIFICATION_TYPES
        .filter((type) => type.audience === NOTIFICATION_AUDIENCE.ADMINS)
        .map((type) => type.id)

    assert.deepEqual(adminAddressed, ['equipment_quote_reply'])
})

// An opt-out only means something for a type that sends an email, so each one has
// to declare its delivery rather than leaving the panel to guess.
test('every type declares how it is delivered', () => {
    for (const type of NOTIFICATION_TYPES) {
        assert.ok(
            [NOTIFICATION_DELIVERY.EMAIL, NOTIFICATION_DELIVERY.PANEL].includes(type.delivery),
            `${type.id} must declare a delivery`
        )
    }
})

test('only the alert types email; the rest are panel-only', () => {
    assert.equal(notificationDeliveryForType('contact_form'), NOTIFICATION_DELIVERY.EMAIL)
    assert.equal(notificationDeliveryForType('equipment_quote_reply'), NOTIFICATION_DELIVERY.EMAIL)

    // Derived from activity the app already records: an inbound reply, a logged
    // chat, and a failed outbound message have no alert email to opt out of.
    assert.equal(notificationDeliveryForType('inbound_email'), NOTIFICATION_DELIVERY.PANEL)
    assert.equal(notificationDeliveryForType('chat_session'), NOTIFICATION_DELIVERY.PANEL)
    assert.equal(notificationDeliveryForType('email_failure'), NOTIFICATION_DELIVERY.PANEL)

    assert.equal(notificationDeliveryForCategory('chatbot_logs'), NOTIFICATION_DELIVERY.PANEL)
})

// Only an alert addressed to the admin is theirs to turn off. The contact form
// alert is routed by a domain setting, so a per-admin switch for it would claim a
// control the admin does not have - and defaulting it off used to suppress the
// site's own copy.
test('only an admin-addressed email gets a per-admin switch', () => {
    assert.equal(isPerAdminNotificationType('equipment_quote_reply'), true)

    assert.equal(isPerAdminNotificationType('contact_form'), false)
    assert.equal(isPerAdminNotificationType('inbound_email'), false)
    assert.equal(isPerAdminNotificationType('chat_session'), false)
    assert.equal(isPerAdminNotificationType('email_failure'), false)

    // An unknown type must not be offered a switch that could not mean anything.
    assert.equal(isPerAdminNotificationType('not_a_type'), false)
    assert.equal(isPerAdminNotificationType(null), false)

    const switchable = NOTIFICATION_TYPES
        .filter((type) => isPerAdminNotificationType(type.id))
        .map((type) => type.id)

    assert.deepEqual(switchable, ['equipment_quote_reply'])
})

// An uncategorised message is not one we can classify, so it keeps the behaviour
// it had before delivery was declared: reach the recipients, never be dropped.
test('an unknown category is treated as emailed', () => {
    assert.equal(notificationDeliveryForCategory('generic'), NOTIFICATION_DELIVERY.EMAIL)
    assert.equal(notificationDeliveryForType('not_a_type'), NOTIFICATION_DELIVERY.EMAIL)
    assert.equal(notificationDeliveryForType(null), NOTIFICATION_DELIVERY.EMAIL)
})

test('resolves the audience from a queue category and falls back to the domain', () => {
    assert.equal(notificationAudienceForCategory('contact_form'), NOTIFICATION_AUDIENCE.DOMAIN)
    assert.equal(notificationAudienceForCategory('equipment_quote_reply'), NOTIFICATION_AUDIENCE.ADMINS)
    assert.equal(notificationAudienceForCategory('chatbot_logs'), NOTIFICATION_AUDIENCE.DOMAIN)

    // An unknown type or uncategorised message must never fan out to admins.
    assert.equal(notificationAudienceForCategory('generic'), NOTIFICATION_AUDIENCE.DOMAIN)
    assert.equal(notificationAudienceForType('not_a_type'), NOTIFICATION_AUDIENCE.DOMAIN)
    assert.equal(notificationAudienceForType(null), NOTIFICATION_AUDIENCE.DOMAIN)
})

test('extracts the address from a display-name recipient', () => {
    assert.equal(extractEmailAddress('Front Desk <Reception@Example.com>'), 'reception@example.com')
    assert.equal(extractEmailAddress('reception@example.com'), 'reception@example.com')
})

test('removes suppressed recipients but keeps the rest', () => {
    const result = applyNotificationRecipientFilter({
        recipients: ['kate@example.com', 'frontdesk@example.com'],
        suppressedAddresses: ['kate@example.com'],
    })

    assert.deepEqual(result.recipients, ['frontdesk@example.com'])
    assert.deepEqual(result.suppressed, ['kate@example.com'])
    assert.equal(result.allSuppressed, false)
})

test('empties the recipient list when everything is suppressed', () => {
    const result = applyNotificationRecipientFilter({
        recipients: ['griffinmt@outlook.com'],
        suppressedAddresses: ['griffinmt@outlook.com'],
    })

    assert.deepEqual(result.recipients, [])
    assert.equal(result.allSuppressed, true)
})

// Multiple admins on one domain each keep their own preference, so suppression is
// decided per address: one admin opting out must not affect the other's delivery.
test('filters each recipient against its own preference independently', () => {
    const result = applyNotificationRecipientFilter({
        recipients: ['alice@clinic.com.au', 'bob@clinic.com.au', 'frontdesk@clinic.com.au'],
        suppressedAddresses: ['alice@clinic.com.au'],
    })

    assert.deepEqual(result.recipients, ['bob@clinic.com.au', 'frontdesk@clinic.com.au'])
    assert.deepEqual(result.suppressed, ['alice@clinic.com.au'])
    assert.equal(result.allSuppressed, false)
})

test('reports allSuppressed when every admin on the domain opted out', () => {
    const result = applyNotificationRecipientFilter({
        recipients: ['alice@clinic.com.au', 'bob@clinic.com.au'],
        suppressedAddresses: ['alice@clinic.com.au', 'bob@clinic.com.au'],
    })

    assert.deepEqual(result.recipients, [])
    assert.equal(result.allSuppressed, true)
})

test('ignores suppressed addresses that are not in the recipient list', () => {
    const result = applyNotificationRecipientFilter({
        recipients: ['frontdesk@example.com'],
        suppressedAddresses: ['kate@example.com'],
    })

    assert.deepEqual(result.recipients, ['frontdesk@example.com'])
    assert.deepEqual(result.suppressed, [])
    assert.equal(result.allSuppressed, false)
})

test('handles empty recipient lists', () => {
    assert.deepEqual(applyNotificationRecipientFilter({ recipients: [] }), {
        recipients: [],
        suppressed: [],
        allSuppressed: false,
    })
    assert.deepEqual(applyNotificationRecipientFilter({ recipients: ['  '] }).recipients, [])
})

test('scopes stored values to the domain, or the fleet-wide feed scope', () => {
    assert.equal(resolveNotificationSettingsScope(' BrandKey '), 'brandkey')
    assert.equal(resolveNotificationSettingsScope(null), '*')
    assert.equal(resolveNotificationSettingsScope(''), '*')
})
