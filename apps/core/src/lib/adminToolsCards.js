/**
 * Card definitions for the Tools dashboard (`/admin/tools`).
 *
 * The Tools page is a deliberately separate surface from /admin. The Recycling,
 * Funders, Content and Activities cards live here rather than on the main
 * dashboard, and `/admin/tools/page.jsx` renders them in their own card style so
 * they are not mistaken for the main Admin dashboard cards.
 *
 * The card *shapes* live here (keys, titles, hrefs, row mapping) while the
 * React bits — icons and the card chrome — stay in the page. That keeps this
 * module pure so it can be unit tested without a browser or JSX runtime.
 *
 * The cards are returned alphabetically by title: the Tools page has no manual
 * ordering, so there is nothing to persist or configure.
 */

import { BUILT_IN_FUNDER_SEEDS } from './funderRegistry.js'
import {
    activityActionLabel,
    activityEntityLabel,
    buildActivityDeepLink,
} from './activityDisplay.js'

/**
 * The four destinations the Tools page collects, as the Admin dashboard's Tools
 * card presents them.
 *
 * The card shortcuts straight to these end pages rather than to `/admin/tools`,
 * so the compact (row 2) and mini (row 3+) layouts share one list: the compact
 * card prints it and the mini card opens it from the icon. Keeping it here means
 * the two layouts cannot drift apart.
 */
export const TOOLS_DASHBOARD_SHORTCUTS = [
    { key: 'content', href: '/admin/content', primary: 'Content', secondary: 'Manage website content' },
    { key: 'funders', href: '/admin/funders', primary: 'Funders', secondary: 'Funding bodies and their documentation' },
    { key: 'recycling', href: '/admin/recycling', primary: 'Recycling', secondary: 'Review items pending delete' },
    { key: 'activities', href: '/admin/activities', primary: 'Activities', secondary: 'Who changed what, and when' },
]

// The Funders card lists the funding bodies that ship with the platform. Their
// canonical list lives in `src/lib/funderRegistry.js` (the same list the
// `funders` table is seeded from), so the card is built from the registry rather
// than a request — there is nothing user-specific to load.
const FUNDER_CARD_ITEMS = BUILT_IN_FUNDER_SEEDS.map((funder) => {
    const documentCount = (funder.documents || []).length
    const detail = funder.full_name || funder.jurisdiction || ''
    return {
        key: funder.key,
        href: `/admin/funders?funder=${encodeURIComponent(funder.key)}`,
        primary: funder.name,
        secondary: `${documentCount} document${documentCount === 1 ? '' : 's'}${detail ? ` · ${detail}` : ''}`,
    }
})

function buildRecyclingItems(recentRecyclingItems, formatRelativeTime) {
    return recentRecyclingItems.map((item) => ({
        key: item.id,
        href: item.href || `/admin/recycling?item=${encodeURIComponent(String(item.id || ''))}`,
        primary: item.title || 'Untitled item',
        secondary: `${item.itemLabel || item.itemType || 'Item'}${item.subtitle ? ` • ${item.subtitle}` : ''}${item.updatedAt ? ` • Updated ${formatRelativeTime(item.updatedAt)}` : ''}`,
    }))
}

function buildActivityItems(recentAuditActivities, formatRelativeTime) {
    return recentAuditActivities.map((activity) => {
        const actorName = String(activity?.actor_name || '').trim()
        const patientName = String(activity?.patient_name || '').trim()

        return {
            key: activity.id,
            href: activity.deep_link
                || buildActivityDeepLink(activity.entity_type, activity.entity_id, { patientId: activity.patient_id })
                || '/admin/activities',
            primary: activity.entity_label || activityEntityLabel(activity.entity_type) || 'Activity recorded',
            secondary: [
                activityActionLabel(activity.action) || 'Changed',
                actorName ? `by ${actorName}` : null,
                patientName,
                formatRelativeTime(activity.created_at),
            ].filter(Boolean).join(' • '),
        }
    })
}

/**
 * Build the Tools page cards from the data the page has loaded.
 *
 * Every card is returned (with its `enabled` flag) so the caller can show or
 * hide it; the page renders the enabled ones in order. Recycling is the only
 * card still gated by a domain flag — the other three are always available.
 *
 * `formatRelativeTime` is injected so the relative timestamps stay in step with
 * the page's own refresh ticker.
 */
export function buildAdminToolsCards({
    recentContentUpdates = [],
    recentRecyclingItems = [],
    recentAuditActivities = [],
    recyclingEnabled = false,
    formatRelativeTime = () => 'Unknown time',
} = {}) {
    const contentItems = Array.isArray(recentContentUpdates) ? recentContentUpdates : []
    const recyclingItems = Array.isArray(recentRecyclingItems) ? recentRecyclingItems : []
    const activityItems = Array.isArray(recentAuditActivities) ? recentAuditActivities : []

    const cardsByKey = {
        content: {
            key: 'content',
            enabled: true,
            title: 'Content',
            description: 'Manage the website content for this domain.',
            recentLabel: 'Recent Content',
            emptyLabel: 'No recent content updates yet.',
            actionHref: '/admin/content',
            items: contentItems.map((item) => ({
                key: item.id,
                href: '/admin/content',
                primary: item.title || 'Untitled content',
                secondary: item.timestamp ? `Updated ${formatRelativeTime(item.timestamp)}` : 'No update timestamp',
            })),
        },
        funders: {
            key: 'funders',
            enabled: true,
            title: 'Funders',
            description: 'The funding bodies the platform reports against and the documentation each one relies on.',
            recentLabel: 'Funders',
            emptyLabel: 'No funders configured yet.',
            actionHref: '/admin/funders',
            items: FUNDER_CARD_ITEMS,
        },
        recycling: {
            key: 'recycling',
            enabled: recyclingEnabled === true,
            title: 'Recycling',
            description: 'Review items marked as pending delete before they are purged or restored.',
            recentLabel: 'Recently Deleted',
            emptyLabel: 'No recently deleted items found.',
            actionHref: '/admin/recycling',
            items: buildRecyclingItems(recyclingItems, formatRelativeTime),
        },
        activities: {
            key: 'activities',
            enabled: true,
            title: 'Activities',
            description: 'Audit trail of who created, changed or deleted patient records.',
            recentLabel: 'Recent Activity',
            emptyLabel: 'No recorded activity yet.',
            actionHref: '/admin/activities',
            items: buildActivityItems(activityItems, formatRelativeTime),
        },
    }

    return Object.values(cardsByKey).sort((a, b) => a.title.localeCompare(b.title))
}
