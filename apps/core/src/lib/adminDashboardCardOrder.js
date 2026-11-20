/**
 * Shared helpers for the Admin dashboard card order.
 *
 * The same order shape is used in three places:
 *   - the domain default in the `adminDashboardCardOrder` domain setting, edited
 *     by the up/down list on /admin/settings/domains (and written whole by the
 *     PATCH handler for /api/settings/domains)
 *   - one admin's personal override, saved from the drag-and-drop layout editor
 *     on /admin through /api/admin/dashboard-layout
 *   - the normalizer used by both read paths
 *
 * Keeping the canonical key list and the normalizer in one place stops those
 * copies from drifting apart (a drifting copy previously dropped 'analysis').
 */

/**
 * The hard-coded dashboard layout: what a domain starts from when neither the
 * domain setting nor the admin's personal override says otherwise.
 *
 * Precedence (highest first):
 *   1. the admin's personal layout, saved from the /admin layout editor
 *   2. the domain default in `adminDashboardCardOrder`, edited on /domains
 *   3. this list
 */
export const DEFAULT_ADMIN_DASHBOARD_CARD_ORDER = [
    'tasks',
    'patients',
    'reports',
    'docs',
    // Files is the practice's own upload library, which sits beside the Docs card
    // because both are places a stored document can be opened from.
    'files',
    'notes',
    'appointments',
    'sourcing',
    // The Tools card links to /admin/tools, which holds the Content, Funders,
    // Recycling and Activities cards (see src/lib/adminToolsCards.js). There is
    // no order for those: the Tools page lists them alphabetically by title.
    'tools',
    'contacts',
    'cases',
    'providers',
    'equipment',
    'forms',
    'analysis',
    'billing',
    'chat',
    'assistant',
    'messages',
    'ai-usage',
]

/**
 * Re-insert keys that are absent from `order` at their default relative
 * position instead of appending them to the end. New cards therefore land
 * next to their neighbours rather than jumping to the bottom of the layout.
 */
function mergeMissingCardKeys(order) {
    const result = [...order]

    for (const cardKey of DEFAULT_ADMIN_DASHBOARD_CARD_ORDER) {
        if (result.includes(cardKey)) continue

        const defaultIndex = DEFAULT_ADMIN_DASHBOARD_CARD_ORDER.indexOf(cardKey)
        let insertAt = -1

        for (let index = defaultIndex - 1; index >= 0; index -= 1) {
            const anchorIndex = result.indexOf(DEFAULT_ADMIN_DASHBOARD_CARD_ORDER[index])
            if (anchorIndex !== -1) {
                insertAt = anchorIndex + 1
                break
            }
        }

        if (insertAt === -1) {
            for (let index = defaultIndex + 1; index < DEFAULT_ADMIN_DASHBOARD_CARD_ORDER.length; index += 1) {
                const successorIndex = result.indexOf(DEFAULT_ADMIN_DASHBOARD_CARD_ORDER[index])
                if (successorIndex !== -1) {
                    insertAt = successorIndex
                    break
                }
            }
        }

        result.splice(insertAt === -1 ? result.length : insertAt, 0, cardKey)
    }

    return result
}

/**
 * Drop unknown/duplicate keys, then make sure every known card key is present.
 */
export function normalizeAdminDashboardCardOrder(value) {
    const allowedCardKeys = new Set(DEFAULT_ADMIN_DASHBOARD_CARD_ORDER)
    const safeOrder = Array.isArray(value)
        ? value
            .map((item) => String(item || '').trim())
            .filter((cardKey) => allowedCardKeys.has(cardKey))
        : []

    const dedupedOrder = []
    for (const cardKey of safeOrder) {
        if (!dedupedOrder.includes(cardKey)) {
            dedupedOrder.push(cardKey)
        }
    }

    return mergeMissingCardKeys(dedupedOrder)
}

/**
 * True when two orders put the same cards in the same sequence once `isVisible`
 * filters out the cards an admin cannot see.
 *
 * The layout editor carries the disabled cards along in the draft, so a plain
 * list comparison reports a difference that has no visible effect — which would
 * store a redundant personal override instead of leaving the admin on the domain
 * default.
 */
export function isSameVisibleCardOrder(left, right, isVisible = () => true) {
    const visibleKeys = (order) => (Array.isArray(order) ? order : [])
        .map((cardKey) => String(cardKey || '').trim())
        .filter((cardKey) => cardKey && isVisible(cardKey))

    const leftKeys = visibleKeys(left)
    const rightKeys = visibleKeys(right)

    return leftKeys.length === rightKeys.length
        && leftKeys.every((cardKey, index) => cardKey === rightKeys[index])
}
