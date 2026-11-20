import test from 'node:test'
import assert from 'node:assert/strict'
import { filterRecentContentUpdates } from '../src/lib/adminDashboardUtils.js'

test('removes pending-delete items from recent content', () => {
    const items = [
        { id: 1, status: 'published' },
        { id: 2, status: 'updated', contentStatus: ' Pending Delete ' },
        { id: 3 },
    ]

    const filtered = filterRecentContentUpdates(items)

    assert.deepEqual(filtered.map((item) => item.id), [1, 3])
})

test('returns an empty list for invalid recent content payloads', () => {
    assert.deepEqual(filterRecentContentUpdates(null), [])
})