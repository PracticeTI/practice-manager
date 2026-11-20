// Tests for the Tasks ledger.
//
// The behaviour that matters: a task is raised from the record, and only a person
// takes it off the list. So an entry has to survive the record moving on, has to
// re-open when more work lands behind the same key, and has to age out of view only
// after the practice has had it for the ledger window.
//
// Run with: node --test test/taskEntries.test.js

import test from 'node:test'
import assert from 'node:assert/strict'

import {
    TASK_ENTRY_WINDOW_DAYS,
    buildTaskBoard,
    ensureTaskEntriesTable,
    normalizeTaskEntry,
    taskItemFingerprint,
} from '../src/lib/taskEntries.js'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = new Date('2026-11-11T05:00:00.000Z').getTime()

const quoteItem = (overrides = {}) => ({
    key: '9:quotes',
    kind: 'quotes',
    tab: 'quotes',
    count: 2,
    title: '2 quotes need review',
    detail: 'Drafted by the Quote Writer.',
    actionLabel: 'Review quote',
    workerLabel: 'Quote Writer',
    oldestCreatedAt: '2026-10-13T04:08:10.000Z',
    recordIds: [11, 12],
    patientId: '9',
    patientName: 'Ada Lovelace',
    href: '/admin/patients?patientId=9&tab=quotes',
    ...overrides,
})

const quoteGroup = (items, overrides = {}) => ({
    patientId: '9',
    patientName: 'Ada Lovelace',
    items,
    total: items.reduce((sum, item) => sum + item.count, 0),
    oldestCreatedAt: '2026-10-13T04:08:10.000Z',
    ...overrides,
})

const entryFor = (item, overrides = {}) => ({
    itemKey: item.key,
    fingerprint: taskItemFingerprint(item),
    groupKey: String(item.patientId || ''),
    groupName: item.patientName,
    kind: item.kind,
    patientId: item.patientId,
    patientName: item.patientName,
    workerLabel: item.workerLabel,
    title: item.title,
    detail: item.detail,
    actionLabel: item.actionLabel,
    href: item.href,
    count: item.count,
    oldestCreatedAt: item.oldestCreatedAt,
    firstSeenAt: '2026-11-09T00:00:00.000Z',
    dismissedAt: null,
    dismissedBy: null,
    ...overrides,
})

test('the fingerprint is the identity of the work, not of the row', () => {
    const item = quoteItem()

    assert.equal(taskItemFingerprint(item), taskItemFingerprint({ ...item }))
    assert.equal(
        taskItemFingerprint(item),
        taskItemFingerprint({ ...item, recordIds: [12, 11] }),
        'record order must not change the identity',
    )
    assert.notEqual(
        taskItemFingerprint(item),
        taskItemFingerprint({ ...item, recordIds: [11, 12, 13], count: 3 }),
        'another drafted quote is more work',
    )
})

test('work still waiting on the record is listed', () => {
    const item = quoteItem()

    const board = buildTaskBoard({
        groups: [quoteGroup([item])],
        entries: [entryFor(item)],
        now: NOW,
    })

    assert.equal(board.groups.length, 1)
    assert.deepEqual(board.groups[0].items.map((row) => row.key), ['9:quotes'])
    assert.equal(board.groups[0].items[0].isActioned, undefined)
    assert.deepEqual(board.dismissedItems, [])
})

test('an entry the record has moved past stays until somebody clears it', () => {
    const item = quoteItem()

    const board = buildTaskBoard({
        groups: [],
        entries: [entryFor(item)],
        now: NOW,
    })

    assert.equal(board.groups.length, 1)
    assert.equal(board.groups[0].patientName, 'Ada Lovelace')
    assert.equal(board.groups[0].items[0].title, '2 quotes need review')
    assert.equal(board.groups[0].items[0].isActioned, true, 'the row says why it is still here')
})

test('a lingering entry ages out of view after the ledger window', () => {
    const item = quoteItem()
    const firstSeenAt = new Date(NOW - (TASK_ENTRY_WINDOW_DAYS + 1) * DAY_MS).toISOString()

    const board = buildTaskBoard({
        groups: [],
        entries: [entryFor(item, { firstSeenAt })],
        now: NOW,
    })

    assert.deepEqual(board.groups, [])
    assert.deepEqual(board.dismissedItems, [])
})

test('work still waiting is listed however long it has been there', () => {
    const item = quoteItem()
    const firstSeenAt = new Date(NOW - (TASK_ENTRY_WINDOW_DAYS + 30) * DAY_MS).toISOString()

    const board = buildTaskBoard({
        groups: [quoteGroup([item])],
        entries: [entryFor(item, { firstSeenAt })],
        now: NOW,
    })

    assert.equal(board.groups.length, 1)
    assert.equal(board.groups[0].items.length, 1)
})

test('a cleared entry moves to the Done list and leaves the list', () => {
    const item = quoteItem()

    const board = buildTaskBoard({
        groups: [quoteGroup([item])],
        entries: [entryFor(item, { dismissedAt: '2026-11-09T01:00:00.000Z', dismissedBy: 'admin' })],
        now: NOW,
    })

    assert.deepEqual(board.groups, [])
    assert.equal(board.dismissedItems.length, 1)
    assert.equal(board.dismissedItems[0].title, '2 quotes need review')
    assert.equal(board.dismissedItems[0].dismissedAt, '2026-11-09T01:00:00.000Z')
    assert.equal(board.dismissedItems[0].dismissedBy, 'admin')
})

test('a cleared entry older than the window leaves the Done history too', () => {
    const item = quoteItem()
    const firstSeenAt = new Date(NOW - (TASK_ENTRY_WINDOW_DAYS + 1) * DAY_MS).toISOString()

    const board = buildTaskBoard({
        groups: [],
        entries: [entryFor(item, { firstSeenAt, dismissedAt: '2026-11-09T01:00:00.000Z' })],
        now: NOW,
    })

    assert.deepEqual(board.dismissedItems, [])
})

test('done rows are listed newest decision first', () => {
    const older = quoteItem()
    const newer = quoteItem({ key: '10:quotes', patientId: '10', patientName: 'Grace Hopper' })

    const board = buildTaskBoard({
        groups: [],
        entries: [
            entryFor(older, { dismissedAt: '2026-11-01T00:00:00.000Z' }),
            entryFor(newer, {
                groupKey: '10',
                dismissedAt: '2026-11-09T00:00:00.000Z',
            }),
        ],
        now: NOW,
    })

    assert.deepEqual(board.dismissedItems.map((item) => item.key), ['10:quotes', '9:quotes'])
})

test('the practice enquiry group keeps its identity when its row lingers', () => {
    const enquiry = quoteItem({
        key: 'website-enquiries:44',
        kind: 'enquiries',
        count: 1,
        title: 'Website Enquiry',
        workerLabel: 'Website contact form',
        patientId: null,
        patientName: 'Mary Mary',
        recordIds: [44],
    })

    const board = buildTaskBoard({
        groups: [],
        entries: [entryFor(enquiry, { groupKey: 'website-enquiries', groupName: 'Website enquiries' })],
        now: NOW,
    })

    assert.equal(board.groups.length, 1)
    assert.equal(board.groups[0].groupKey, 'website-enquiries')
    assert.equal(board.groups[0].patientName, 'Website enquiries')
    assert.equal(board.groups[0].patientId, null)
    assert.equal(board.groups[0].items[0].patientName, 'Mary Mary', 'the row still names who wrote in')
})

test('groups are ordered by how long their oldest entry has waited', () => {
    const older = quoteItem({ key: '7:quotes', patientId: '7', patientName: 'Sarah Chen' })
    const newer = quoteItem()

    const board = buildTaskBoard({
        groups: [],
        entries: [
            entryFor(newer),
            entryFor(older, { groupKey: '7', oldestCreatedAt: '2026-09-01T00:00:00.000Z' }),
        ],
        now: NOW,
    })

    assert.deepEqual(board.groups.map((group) => group.patientName), ['Sarah Chen', 'Ada Lovelace'])
})

test('a stored entry normalizes back into the shape the board reads', () => {
    const row = normalizeTaskEntry({
        id: 3,
        domain: 'domain-a',
        item_key: 'website-enquiries:44',
        fingerprint: 'enquiries|1|2026-11-11T04:35:28.724Z|44',
        group_key: 'website-enquiries',
        group_name: 'Website enquiries',
        kind: 'enquiries',
        patient_id: null,
        patient_name: 'Mary Mary',
        worker_label: 'Website contact form',
        title: 'Website Enquiry',
        detail: 'From Mary Mary.',
        action_label: 'Open enquiry',
        href: '/admin/messages/44?direction=outbound',
        item_count: 1,
        oldest_created_at: '2026-11-11T04:35:28.724Z',
        first_seen_at: '2026-11-11T04:40:00.000Z',
        dismissed_at: '2026-11-11T05:00:00.000Z',
        dismissed_by: 'admin',
    })

    assert.equal(row.itemKey, 'website-enquiries:44')
    assert.equal(row.groupKey, 'website-enquiries')
    assert.equal(row.groupName, 'Website enquiries')
    assert.equal(row.patientId, null)
    assert.equal(row.count, 1)
    assert.equal(row.oldestCreatedAt, '2026-11-11T04:35:28.724Z')
    assert.equal(row.firstSeenAt, '2026-11-11T04:40:00.000Z')
    assert.equal(row.dismissedAt, '2026-11-11T05:00:00.000Z')
    assert.equal(normalizeTaskEntry({ domain: 'no key' }), null)
})

// The ledger is created on first use, and `lib/supabaseRls.js` turns RLS on for
// every table it sees created. A ledger born without a policy is therefore an
// RLS-enabled table nobody but its owner can read, which the database RLS check
// reports as "N tables have no policies".
const fakeConnection = ({ missing = true, policies = true } = {}) => {
    const statements = []
    return {
        statements,
        async query(sql, params) {
            statements.push(sql)
            if (/to_regclass/.test(sql)) {
                return { rows: missing ? [{ name: 'task_entries' }] : [] }
            }
            if (/FROM pg_roles/.test(sql)) {
                return { rows: policies ? [{ '?column?': 1 }] : [] }
            }
            return { rows: [] }
        },
    }
}

test('creating the ledger installs its domain policy with it', async () => {
    const connection = fakeConnection()

    await ensureTaskEntriesTable(connection)

    assert.ok(
        connection.statements.some((sql) => /CREATE TABLE IF NOT EXISTS task_entries/.test(sql)),
        'the ledger is created',
    )
    assert.ok(
        connection.statements.some((sql) => /ENABLE ROW LEVEL SECURITY/.test(sql)),
        'row-level security is enabled on it',
    )
    assert.ok(
        connection.statements.some((sql) => /CREATE POLICY "task_entries_domain_policy"/.test(sql)),
        'a policy grants the runtime role access to it',
    )
})

test('a database that already has the ledger issues no schema DDL', async () => {
    const connection = fakeConnection({ missing: false })

    await ensureTaskEntriesTable(connection)

    assert.equal(connection.statements.length, 1, 'only the existence probe runs')
})

test('a database with no runtime role is left without a policy rather than failing', async () => {
    const connection = fakeConnection({ policies: false })

    await ensureTaskEntriesTable(connection)

    assert.ok(connection.statements.some((sql) => /CREATE TABLE IF NOT EXISTS task_entries/.test(sql)))
    assert.ok(
        !connection.statements.some((sql) => /CREATE POLICY/.test(sql)),
        'a policy naming a missing role would be an error',
    )
})
