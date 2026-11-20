import test from 'node:test'
import assert from 'node:assert/strict'
import {
    DEFAULT_ADMIN_DASHBOARD_CARD_ORDER,
    normalizeAdminDashboardCardOrder,
} from '../src/lib/adminDashboardCardOrder.js'
import {
    TOOLS_PAGE_FEATURE_FLAG_KEY,
    getDefaultDomainFeatureSettings,
    getDefaultDomainFeatureFlags,
    isToolsPageFeatureEnabled,
    normalizeDomainFeatureFlags,
} from '../src/lib/domainFeatureFlags.js'
import { TOOLS_DASHBOARD_SHORTCUTS, buildAdminToolsCards } from '../src/lib/adminToolsCards.js'
import { TOOL_CARD_ACCENTS, TOOL_CARD_ICONS } from '../src/admin-ui/components/toolCardTheme.js'

// The order the cards had before Recycling, Funders, Content and Activities were
// moved to the Tools page.
const LEGACY_DASHBOARD_CARD_ORDER = [
    'content',
    'equipment',
    'providers',
    'funders',
    'contacts',
    'sourcing',
    'patients',
    'reports',
    'cases',
    'appointments',
    'forms',
    'notes',
    'docs',
    'analysis',
    'billing',
    'chat',
    'assistant',
    'messages',
    'recycling',
    'activities',
    'ai-usage',
]

test('the Tools dashboard defaults on for every domain', () => {
    for (const domainKey of ['default', 'example-domain', '', undefined]) {
        assert.equal(getDefaultDomainFeatureFlags(domainKey)[TOOLS_PAGE_FEATURE_FLAG_KEY], true)
    }
})

test('new domains and the unconfigured default domain use the default feature settings', () => {
    assert.deepEqual(getDefaultDomainFeatureSettings(), {
        homePageBlockEditorEnabled: false,
        recentUpdatesEnabled: false,
        suppliersEnabled: true,
        providersEnabled: true,
        practiceSearchEnabled: true,
        quickActionsEnabled: false,
        maintenanceModeEnabled: false,
        toolsEnabled: true,
        tasksEnabled: true,
        filesEnabled: false,
        fileStorageBackend: 'database',
        websiteEnabled: true,
        patientsEnabled: true,
        adminFloatingLinkEnabled: true,
        assistantEnabled: true,
        allowPublicFrontend: true,
        requireAdminDomainMatch: true,
        enableLocalCaching: true,
        localCacheTtlHours: 24,
        reportsCardEnabled: true,
        casesCardEnabled: false,
        appointmentsCardEnabled: true,
        formsCardEnabled: false,
        notesCardEnabled: true,
        docsCardEnabled: true,
        analysisCardEnabled: false,
        patientBillingEnabled: true,
        aiUsageEnabled: true,
        recyclingEnabled: true,
        workerVisibility: {
            reporting: true,
            equipmentSourcer: true,
            hsrCreator: true,
            hsrSummariser: true,
            billing: true,
            quoteWriter: true,
            analyst: true,
            scribe: true,
        },
        homepagePalette: { enabled: false, editMode: false },
    })
})

test('the Tools flag normalises stored truthy values and falls back to the default', () => {
    assert.equal(normalizeDomainFeatureFlags({ toolsEnabled: true }, 'domain-a').toolsEnabled, true)
    assert.equal(normalizeDomainFeatureFlags({ toolsEnabled: 'true' }, 'domain-a').toolsEnabled, true)
    assert.equal(normalizeDomainFeatureFlags({ toolsEnabled: 'false' }, 'domain-a').toolsEnabled, false)
    assert.equal(normalizeDomainFeatureFlags({ patientsEnabled: true }, 'domain-a').toolsEnabled, true)
})

test('isToolsPageFeatureEnabled reads the flag off the stored record', () => {
    assert.equal(isToolsPageFeatureEnabled({ toolsEnabled: true }, 'domain-a'), true)
    assert.equal(isToolsPageFeatureEnabled({ toolsEnabled: false }, 'domain-a'), false)
    assert.equal(isToolsPageFeatureEnabled({}, 'domain-a'), true)
})

test('the dashboard Tools card shortcuts to the destination pages, not the Tools dashboard', () => {
    assert.deepEqual(TOOLS_DASHBOARD_SHORTCUTS.map((item) => item.key), ['content', 'funders', 'recycling', 'activities'])
    assert.deepEqual(TOOLS_DASHBOARD_SHORTCUTS.map((item) => item.href), [
        '/admin/content',
        '/admin/funders',
        '/admin/recycling',
        '/admin/activities',
    ])

    // The whole point of the list is that a shortcut skips the Tools dashboard, so
    // every row must resolve to its own end page with a label and a description.
    for (const item of TOOLS_DASHBOARD_SHORTCUTS) {
        assert.notEqual(item.href, '/admin/tools')
        assert.equal(item.href.startsWith('/admin/'), true)
        assert.ok(item.primary)
        assert.ok(item.secondary)
    }
})

test('every Tools shortcut carries the glyph and colours its Tools dashboard card shows', () => {
    // The Admin dashboard's Tools card tints each shortcut row like the card it opens,
    // so a shortcut missing from either map would render an unstyled row.
    for (const item of TOOLS_DASHBOARD_SHORTCUTS) {
        assert.ok(TOOL_CARD_ICONS[item.key], `no icon mapped for the ${item.key} shortcut`)

        const accent = TOOL_CARD_ACCENTS[item.key]
        assert.ok(accent, `no accent mapped for the ${item.key} shortcut`)
        for (const token of ['rail', 'band', 'tile', 'eyebrow', 'arrow']) {
            assert.equal(typeof accent[token], 'string', `${item.key} is missing its ${token} accent`)
        }
    }
})

test('the moved cards are gone from the main dashboard and Tools replaced them', () => {
    for (const movedKey of ['content', 'funders', 'recycling', 'activities']) {
        assert.equal(DEFAULT_ADMIN_DASHBOARD_CARD_ORDER.includes(movedKey), false, `${movedKey} should have moved`)
    }

    assert.equal(DEFAULT_ADMIN_DASHBOARD_CARD_ORDER.includes('tools'), true)
})

test('a stored dashboard order drops the moved cards and keeps Tools', () => {
    const result = normalizeAdminDashboardCardOrder(LEGACY_DASHBOARD_CARD_ORDER)

    for (const movedKey of ['content', 'funders', 'recycling', 'activities']) {
        assert.equal(result.includes(movedKey), false, `${movedKey} should have moved`)
    }

    assert.equal(result.includes('tools'), true)
    // Same cards as the canonical default, and the stored relative order survives.
    assert.deepEqual([...result].sort(), [...DEFAULT_ADMIN_DASHBOARD_CARD_ORDER].sort())
    assert.deepEqual(
        result.filter((cardKey) => LEGACY_DASHBOARD_CARD_ORDER.includes(cardKey)),
        LEGACY_DASHBOARD_CARD_ORDER.filter((cardKey) => result.includes(cardKey))
    )
})

test('the Tools cards are listed alphabetically by title, with no manual order', () => {
    const cards = buildAdminToolsCards({ recyclingEnabled: true })

    assert.deepEqual(cards.map((card) => card.title), ['Activities', 'Content', 'Funders', 'Recycling'])
    assert.deepEqual(cards.map((card) => card.key), ['activities', 'content', 'funders', 'recycling'])

    // Sorting must not depend on the order the caller loaded the data in.
    const shuffled = buildAdminToolsCards({
        recyclingEnabled: true,
        recentAuditActivities: [{ id: 'a1' }],
        recentRecyclingItems: [{ id: 'r1' }],
        recentContentUpdates: [{ id: 'c1' }],
    })

    assert.deepEqual(shuffled.map((card) => card.title), ['Activities', 'Content', 'Funders', 'Recycling'])
})

test('Recycling is the only Tools card gated by a domain flag', () => {
    const enabled = Object.fromEntries(buildAdminToolsCards({ recyclingEnabled: true }).map((card) => [card.key, card.enabled]))
    const disabled = Object.fromEntries(buildAdminToolsCards({ recyclingEnabled: false }).map((card) => [card.key, card.enabled]))

    assert.deepEqual(enabled, { content: true, funders: true, recycling: true, activities: true })
    assert.deepEqual(disabled, { content: true, funders: true, recycling: false, activities: true })
})

test('the Tools cards carry the action link and a recent-items list', () => {
    const cards = buildAdminToolsCards({ recentContentUpdates: [{ id: 'c1', title: 'Home page', timestamp: '2026-01-01T00:00:00Z' }] })
    const content = cards.find((card) => card.key === 'content')

    assert.equal(content.actionHref, '/admin/content')
    assert.equal(content.items[0].primary, 'Home page')
    assert.equal(content.items[0].href, '/admin/content')
})

test('recycling rows deep-link to the item when the API supplies an href', () => {
    const [recycling] = buildAdminToolsCards({
        recyclingEnabled: true,
        recentRecyclingItems: [
            { id: 'r1', title: 'Quote 1', itemLabel: 'Quote' },
            { id: 'r2', title: 'Case 2', itemType: 'case', href: '/admin/cases?case=c2', subtitle: 'Archived' },
        ],
        formatRelativeTime: () => '2 hours ago',
    }).filter((card) => card.key === 'recycling')

    assert.equal(recycling.items[0].href, '/admin/recycling?item=r1')
    assert.equal(recycling.items[0].secondary, 'Quote')
    assert.equal(recycling.items[1].href, '/admin/cases?case=c2')
    assert.equal(recycling.items[1].secondary, 'case • Archived')
})

test('activity rows fall back to the entity deep link and describe the change', () => {
    const activities = buildAdminToolsCards({
        recentAuditActivities: [
            { id: 'a1', action: 'update', entity_type: 'note', entity_id: 'n1', actor_name: 'Sam', created_at: '2026-01-01T00:00:00Z' },
            { id: 'a2', action: 'delete', entity_type: 'note', entity_label: 'Care plan', deep_link: '/admin/notes?note=n9' },
        ],
        formatRelativeTime: () => '3 days ago',
    }).find((card) => card.key === 'activities')

    assert.equal(activities.items[0].primary, 'Note')
    assert.equal(activities.items[0].secondary, 'Updated • by Sam • 3 days ago')
    assert.equal(activities.items[1].primary, 'Care plan')
    assert.equal(activities.items[1].href, '/admin/notes?note=n9')
    assert.equal(activities.items[1].secondary, 'Deleted • 3 days ago')
})

test('an unreadable activity row still renders an Activities item', () => {
    const activities = buildAdminToolsCards({ recentAuditActivities: [{}] })
        .find((card) => card.key === 'activities')

    assert.equal(activities.items[0].primary, 'Activity recorded')
    assert.equal(activities.items[0].href, '/admin/activities')
})
