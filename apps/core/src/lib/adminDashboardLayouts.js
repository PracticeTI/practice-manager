/**
 * Per-admin Admin dashboard layout.
 *
 * The domain setting `adminDashboardCardOrder` is the default layout every admin
 * on that domain starts from; a superadmin edits it on /domains. When an admin
 * rearranges their own panels on /admin the result is stored as a `user_settings`
 * row instead, so one admin's drag-and-drop never changes what their colleagues
 * see.
 *
 * The row is keyed by (domain, username, key): a layout belongs to one admin *in
 * one domain*, because the cards available differ per domain. A missing row means
 * "no override" — the caller falls back to the domain default.
 *
 * Only keys that survive `normalizeAdminDashboardCardOrder` are stored, so a
 * retired card key drops out rather than resurrecting later.
 */

import { deleteUserSetting, getUserSetting, setUserSetting } from '@/lib/appSettings.js'
import { normalizeAdminDashboardCardOrder } from './adminDashboardCardOrder.js'

const DASHBOARD_CARD_ORDER_SETTING_KEY = 'adminDashboardCardOrder'

/**
 * One admin's saved layout in `domain`, or `null` when they have never
 * personalised it and should follow the domain default.
 */
export async function getAdminDashboardCardOrder(domain, username) {
    const stored = await getUserSetting(domain, username, DASHBOARD_CARD_ORDER_SETTING_KEY)
    return Array.isArray(stored) ? normalizeAdminDashboardCardOrder(stored) : null
}

/**
 * Save `order` for one admin in one domain. `null` (or an empty list) clears the
 * override so the admin follows the domain default again. Returns the stored
 * order, or null.
 */
export async function saveAdminDashboardCardOrder(domain, username, order) {
    const isClearing = order === null || (Array.isArray(order) && order.length === 0)

    if (isClearing) {
        await deleteUserSetting(domain, username, DASHBOARD_CARD_ORDER_SETTING_KEY)
        return null
    }

    const normalizedOrder = normalizeAdminDashboardCardOrder(order)
    const saved = await setUserSetting(domain, username, DASHBOARD_CARD_ORDER_SETTING_KEY, normalizedOrder)
    if (!saved) {
        throw new Error('Failed to persist the dashboard layout')
    }
    return normalizedOrder
}
