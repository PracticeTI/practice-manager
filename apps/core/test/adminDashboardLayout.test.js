import test from 'node:test'
import assert from 'node:assert/strict'

import {
    DEFAULT_ADMIN_DASHBOARD_CARD_ORDER,
    isSameVisibleCardOrder,
} from '../src/lib/adminDashboardCardOrder.js'

// The layout editor keeps the disabled cards in the draft, so two orders can
// differ only in cards the admin cannot see.
const visible = new Set(['equipment', 'providers', 'contacts'])
const isVisible = (cardKey) => visible.has(cardKey)

test('ignores hidden cards when comparing a saved layout to the domain default', () => {
    const savedLayout = ['equipment', 'providers', 'contacts', 'tools', 'patients']
    const domainDefault = ['equipment', 'providers', 'contacts', 'patients', 'tools']

    assert.equal(isSameVisibleCardOrder(savedLayout, domainDefault, isVisible), true)
})

test('detects a visible reorder', () => {
    const savedLayout = ['providers', 'equipment', 'contacts']
    const domainDefault = ['equipment', 'providers', 'contacts']

    assert.equal(isSameVisibleCardOrder(savedLayout, domainDefault, isVisible), false)
})

test('treats a complete order as matching itself', () => {
    assert.equal(
        isSameVisibleCardOrder(DEFAULT_ADMIN_DASHBOARD_CARD_ORDER, DEFAULT_ADMIN_DASHBOARD_CARD_ORDER),
        true
    )
})

test('tolerates missing and malformed orders', () => {
    assert.equal(isSameVisibleCardOrder(null, null, isVisible), true)
    assert.equal(isSameVisibleCardOrder(undefined, ['equipment'], isVisible), false)
})
