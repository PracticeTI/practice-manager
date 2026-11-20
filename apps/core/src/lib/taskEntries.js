/**
 * The Tasks list itself: the practice's own record of what is on it.
 *
 * A task is *raised* from the record — a worker draft, an unsourced equipment
 * suggestion, a published report nobody has read, a website enquiry nobody has
 * opened (see `patientTasks.js` and `workerReviewQueue.js`). It leaves the list only
 * when a person marks it done, which is this module's one job.
 *
 * That means the list cannot be derived afresh on every load: actioning the record
 * (sending the quote, sourcing the equipment, opening the report, opening the
 * enquiry in Messages) removes it from the derivation, and a purely derived list
 * would silently drop it from under whoever was still working through it. So the
 * first time an entry is seen it is written down here, with a snapshot of how it
 * read, and from then on the stored entry is what keeps it on the list. The snapshot
 * is also what the row renders from once the record has moved on, so a cleared list
 * never rewrites its own history.
 *
 * Two things end an entry:
 *   - somebody marks it done (kept for `TASK_ENTRY_WINDOW_DAYS` as the Done history);
 *   - it has not been waiting on a record for `TASK_ENTRY_WINDOW_DAYS`, which is the
 *     bound on how long the practice remembers work it has already dealt with.
 * Work that is *still* waiting is always listed, however old it is.
 *
 * An entry carries a fingerprint of the work it was raised for (kind, how many
 * records, which ones). More work behind the same key — a second quote drafted for
 * the same patient — changes that fingerprint, which re-opens an entry somebody had
 * already cleared rather than letting an older decision hide the new work.
 *
 * Server-only: the page reads this through the Tasks API.
 */

import { runOptionalDdl, whenTablesMissing } from './pgOptionalDdl.js'
import { oldestOf } from './patientTasks.js'
import { DEFAULT_POLICY_ROLE, tenantPolicyStatements } from './rlsPolicies.js'

export const TASK_ENTRIES_TABLE = 'task_entries'

/** How long a cleared or no-longer-waiting entry stays in view. */
export const TASK_ENTRY_WINDOW_DAYS = 30

/** The queue's own order, so the ledger sorts rows the way the derivation does. */
const KIND_ORDER = ['quotes', 'equipment', 'report', 'enquiries']

const ENTRY_COLUMNS = `id, domain, item_key, fingerprint, group_key, group_name, kind,
    patient_id, patient_name, worker_label, title, detail, action_label, href, item_count,
    oldest_created_at, first_seen_at, dismissed_at, dismissed_by`

function isMissingTableError(error) {
    if (String(error?.code || '') === '42P01') return true
    return String(error?.message || '').toLowerCase().includes('does not exist')
}

function toIsoString(value) {
    if (!value) return null
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function kindRank(item) {
    const index = KIND_ORDER.indexOf(item?.kind)
    return index === -1 ? KIND_ORDER.length : index
}

/**
 * What a queue entry is made of, so the ledger can tell "still the same work" from
 * "more work landed since". Sorted record ids keep the value stable across loads
 * that happen to return rows in a different order.
 */
export function taskItemFingerprint(item) {
    const recordIds = Array.isArray(item?.recordIds)
        ? item.recordIds.map((id) => String(id ?? '').trim()).filter(Boolean).sort()
        : []
    const count = Number(item?.count)

    return [
        String(item?.kind || ''),
        Number.isFinite(count) && count > 0 ? String(Math.floor(count)) : '0',
        String(item?.oldestCreatedAt || ''),
        recordIds.join(','),
    ].join('|')
}

/** One stored entry in the shape the board and the API read. */
export function normalizeTaskEntry(row) {
    if (!row || typeof row !== 'object') return null

    const itemKey = String(row.item_key ?? row.itemKey ?? '').trim()
    if (!itemKey) return null

    return {
        itemKey,
        fingerprint: String(row.fingerprint || ''),
        groupKey: String(row.group_key ?? row.groupKey ?? ''),
        groupName: String(row.group_name ?? row.groupName ?? ''),
        kind: String(row.kind || ''),
        patientId: row.patient_id ?? row.patientId ?? null,
        patientName: String(row.patient_name ?? row.patientName ?? '').trim(),
        workerLabel: String(row.worker_label ?? row.workerLabel ?? '').trim(),
        title: String(row.title || ''),
        detail: String(row.detail || ''),
        actionLabel: String(row.action_label ?? row.actionLabel ?? '').trim(),
        href: String(row.href || ''),
        count: Number(row.item_count ?? row.count) || 0,
        oldestCreatedAt: toIsoString(row.oldest_created_at ?? row.oldestCreatedAt),
        firstSeenAt: toIsoString(row.first_seen_at ?? row.firstSeenAt),
        dismissedAt: toIsoString(row.dismissed_at ?? row.dismissedAt),
        dismissedBy: String(row.dismissed_by ?? row.dismissedBy ?? '').trim() || null,
    }
}

/**
 * A stored entry as a row the page renders. Used for entries the record no longer
 * derives (they stay on the list until cleared) and for the Done history.
 */
export function taskEntryItem(entry, { isActioned = false } = {}) {
    return {
        key: entry.itemKey,
        kind: entry.kind,
        tab: null,
        count: entry.count,
        title: entry.title,
        detail: entry.detail,
        actionLabel: entry.actionLabel || 'Open',
        workerLabel: entry.workerLabel,
        oldestCreatedAt: entry.oldestCreatedAt,
        recordIds: [],
        patientId: entry.patientId,
        patientName: entry.patientName,
        href: entry.href,
        ...(isActioned ? { isActioned: true } : {}),
    }
}

/** The store rows one derivation raises, carrying the group each row belongs to. */
function collectRaisedEntries(groups) {
    const raised = []

    for (const group of Array.isArray(groups) ? groups : []) {
        if (!group || !Array.isArray(group.items)) continue

        const groupKey = String(group.groupKey || group.patientId || '').trim()
        const groupName = String(group.patientName || '').trim()

        for (const item of group.items) {
            if (!item?.key) continue

            raised.push({
                item,
                entry: {
                    itemKey: item.key,
                    fingerprint: taskItemFingerprint(item),
                    groupKey,
                    groupName,
                    kind: String(item.kind || ''),
                    // The row's own owner label: a patient entry names the patient, a
                    // website enquiry names the person who wrote in.
                    patientId: item.patientId ?? group.patientId ?? null,
                    patientName: String(item.patientName || groupName),
                    workerLabel: String(item.workerLabel || ''),
                    title: String(item.title || ''),
                    detail: String(item.detail || ''),
                    actionLabel: String(item.actionLabel || ''),
                    href: String(item.href || ''),
                    count: Number(item.count) || 0,
                    oldestCreatedAt: toIsoString(item.oldestCreatedAt),
                },
            })
        }
    }

    return raised
}

/**
 * The two lists the Tasks surfaces read: what is still on the list, and what this
 * practice has marked done.
 *
 * A derived row is preferred over the stored snapshot while the record still raises
 * it (its wording and link follow the record). An entry the record has moved past is
 * rendered from the snapshot and flagged `isActioned`, so the page can say why a
 * quote that has already been sent is still sitting there.
 */
export function buildTaskBoard({
    groups = [],
    entries = [],
    now = Date.now(),
    windowDays = TASK_ENTRY_WINDOW_DAYS,
} = {}) {
    const cutoff = now - (Number(windowDays) || TASK_ENTRY_WINDOW_DAYS) * 24 * 60 * 60 * 1000

    const derivedByKey = new Map()
    for (const group of Array.isArray(groups) ? groups : []) {
        for (const item of Array.isArray(group?.items) ? group.items : []) {
            if (item?.key) derivedByKey.set(item.key, { item, group })
        }
    }

    const openGroups = new Map()
    const dismissedItems = []

    const addItem = (entry, group, item) => {
        const groupKey = String(entry.groupKey || entry.patientId || 'tasks')
        const bucket = openGroups.get(groupKey) || {
            groupKey: entry.groupKey || group?.groupKey || undefined,
            patientId: entry.patientId ?? group?.patientId ?? null,
            patientName: entry.groupName || String(group?.patientName || ''),
            items: [],
            total: 0,
        }

        bucket.items.push(item)
        bucket.total += Number(item.count) || 0
        openGroups.set(groupKey, bucket)
    }

    for (const entry of Array.isArray(entries) ? entries : []) {
        if (!entry?.itemKey) continue

        const derived = derivedByKey.get(entry.itemKey)
        const firstSeen = entry.firstSeenAt ? new Date(entry.firstSeenAt).getTime() : NaN
        const withinWindow = Number.isFinite(firstSeen) ? firstSeen >= cutoff : true

        if (entry.dismissedAt) {
            if (!withinWindow) continue
            const item = derived ? derived.item : taskEntryItem(entry, { isActioned: true })
            dismissedItems.push({ ...item, dismissedAt: entry.dismissedAt, dismissedBy: entry.dismissedBy })
            continue
        }

        // Work nobody has cleared is always listed; only work the record has moved
        // past ages out of view.
        if (!derived && !withinWindow) continue

        addItem(entry, derived?.group, derived ? derived.item : taskEntryItem(entry, { isActioned: true }))
    }

    const groupsOut = [...openGroups.values()]
        .map((group) => ({
            ...group,
            items: [...group.items].sort((left, right) => (
                kindRank(left) - kindRank(right)
                || String(left.title).localeCompare(String(right.title))
            )),
            oldestCreatedAt: oldestOf(group.items.map((item) => item?.oldestCreatedAt)),
        }))
        .sort((left, right) => {
            const leftTime = left.oldestCreatedAt ? new Date(left.oldestCreatedAt).getTime() : Number.POSITIVE_INFINITY
            const rightTime = right.oldestCreatedAt ? new Date(right.oldestCreatedAt).getTime() : Number.POSITIVE_INFINITY
            if (leftTime !== rightTime) return leftTime - rightTime
            return String(left.patientName).localeCompare(String(right.patientName))
        })

    // Most recently cleared first: the Done list answers "what did I just clear?",
    // which is the opposite order to the queue's oldest-first.
    dismissedItems.sort((left, right) => {
        const leftTime = new Date(left.dismissedAt || 0).getTime()
        const rightTime = new Date(right.dismissedAt || 0).getTime()
        return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0)
    })

    return { groups: groupsOut, dismissedItems }
}

/**
 * The domain policy the ledger is created with, so a lazily created table never
 * lands in the "RLS enabled, no policy" state.
 *
 * `lib/supabaseRls.js` enables row-level security after every `CREATE TABLE` it
 * sees, and a table with RLS on and no policy is unreadable to every role but its
 * owner. Best-effort: only the owner may write a policy, and a database that has
 * never run `db:prepare` has no runtime role for the policy to name.
 */
async function installTaskEntriesPolicy(connection) {
    const role = String(process.env.POSTGRES_RLS_RUNTIME_ROLE || '').trim() || DEFAULT_POLICY_ROLE

    const { rows } = await connection.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])
    if ((rows || []).length === 0) return

    for (const statement of tenantPolicyStatements(TASK_ENTRIES_TABLE, { role })) {
        if (!(await runOptionalDdl(connection, statement))) return
    }
}

/** Create the ledger on first use; a provisioned database already has it. */
export async function ensureTaskEntriesTable(connection) {
    const missing = await whenTablesMissing(connection, [TASK_ENTRIES_TABLE], async () => {
        await connection.query(`
            CREATE TABLE IF NOT EXISTS task_entries (
                id SERIAL PRIMARY KEY,
                domain VARCHAR(100) NOT NULL,
                item_key VARCHAR(200) NOT NULL,
                fingerprint TEXT NOT NULL DEFAULT '',
                group_key VARCHAR(160) NOT NULL DEFAULT '',
                group_name VARCHAR(255) NOT NULL DEFAULT '',
                kind VARCHAR(32) NOT NULL DEFAULT '',
                patient_id VARCHAR(64),
                patient_name VARCHAR(255) NOT NULL DEFAULT '',
                worker_label VARCHAR(160) NOT NULL DEFAULT '',
                title TEXT NOT NULL DEFAULT '',
                detail TEXT NOT NULL DEFAULT '',
                action_label VARCHAR(120) NOT NULL DEFAULT '',
                href TEXT NOT NULL DEFAULT '',
                item_count INTEGER NOT NULL DEFAULT 0,
                oldest_created_at TIMESTAMPTZ NULL,
                first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                dismissed_at TIMESTAMPTZ NULL,
                dismissed_by VARCHAR(128)
            )
        `)
        await connection.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS task_entries_domain_item_idx
                ON task_entries(domain, item_key)
        `)
    })

    if (missing.length === 0) return
    await installTaskEntriesPolicy(connection)
}

/** Every entry this practice has raised, newest first. */
export async function loadTaskEntries(connection, { domain } = {}) {
    const normalizedDomain = String(domain || '').trim().toLowerCase()
    if (!normalizedDomain) return []

    try {
        const result = await connection.query(
            `SELECT ${ENTRY_COLUMNS} FROM ${TASK_ENTRIES_TABLE}
             WHERE domain = $1
             ORDER BY first_seen_at DESC, id DESC`,
            [normalizedDomain]
        )

        return (result?.rows || []).map(normalizeTaskEntry).filter(Boolean)
    } catch (error) {
        // A practice that has never opened Tasks has no ledger yet, which is an
        // empty list rather than a failure.
        if (isMissingTableError(error)) return []
        throw error
    }
}

async function saveTaskEntry(connection, { domain, entry }) {
    const result = await connection.query(
        `INSERT INTO ${TASK_ENTRIES_TABLE} (
            domain, item_key, fingerprint, group_key, group_name, kind, patient_id, patient_name,
            worker_label, title, detail, action_label, href, item_count, oldest_created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (domain, item_key) DO UPDATE SET
            fingerprint = EXCLUDED.fingerprint,
            group_key = EXCLUDED.group_key,
            group_name = EXCLUDED.group_name,
            kind = EXCLUDED.kind,
            patient_id = EXCLUDED.patient_id,
            patient_name = EXCLUDED.patient_name,
            worker_label = EXCLUDED.worker_label,
            title = EXCLUDED.title,
            detail = EXCLUDED.detail,
            action_label = EXCLUDED.action_label,
            href = EXCLUDED.href,
            item_count = EXCLUDED.item_count,
            oldest_created_at = EXCLUDED.oldest_created_at,
            -- The entry was raised when it was first seen; the window runs from then.
            first_seen_at = ${TASK_ENTRIES_TABLE}.first_seen_at,
            -- Only a changed fingerprint reaches this branch, which means new work
            -- landed behind the same key: the earlier decision no longer applies.
            dismissed_at = NULL,
            dismissed_by = NULL
         RETURNING ${ENTRY_COLUMNS}`,
        [
            domain,
            entry.itemKey,
            entry.fingerprint,
            entry.groupKey,
            entry.groupName,
            entry.kind,
            entry.patientId === undefined ? null : entry.patientId,
            entry.patientName,
            entry.workerLabel,
            entry.title,
            entry.detail,
            entry.actionLabel,
            entry.href,
            entry.count,
            entry.oldestCreatedAt,
        ]
    )

    return normalizeTaskEntry(result?.rows?.[0] || null)
}

/**
 * Raise an entry for everything the record is currently waiting on, and re-open an
 * entry whose work has grown. Entries that are unchanged are left alone, so a page
 * load that changes nothing writes nothing.
 *
 * Returns the whole ledger, which is what the board is built from.
 */
export async function syncTaskEntries(connection, { domain, groups } = {}) {
    const normalizedDomain = String(domain || '').trim().toLowerCase()
    if (!normalizedDomain) return []

    const entries = await loadTaskEntries(connection, { domain: normalizedDomain })
    const byKey = new Map(entries.map((entry) => [entry.itemKey, entry]))

    const pending = collectRaisedEntries(groups).filter(({ entry }) => (
        byKey.get(entry.itemKey)?.fingerprint !== entry.fingerprint
    ))

    if (pending.length === 0) return entries

    await ensureTaskEntriesTable(connection)

    for (const { entry } of pending) {
        const saved = await saveTaskEntry(connection, { domain: normalizedDomain, entry })
        if (saved) byKey.set(saved.itemKey, saved)
    }

    return [...byKey.values()]
}

/** Mark one entry done. Returns the dismissed entry, or null when there is none. */
export async function dismissTaskEntry(connection, { domain, itemKey, dismissedBy = null } = {}) {
    const normalizedDomain = String(domain || '').trim().toLowerCase()
    const key = String(itemKey || '').trim()
    if (!normalizedDomain || !key) return null

    try {
        const result = await connection.query(
            `UPDATE ${TASK_ENTRIES_TABLE}
             SET dismissed_at = NOW(), dismissed_by = $3
             WHERE domain = $1 AND item_key = $2 AND dismissed_at IS NULL
             RETURNING ${ENTRY_COLUMNS}`,
            [normalizedDomain, key, dismissedBy]
        )

        return normalizeTaskEntry(result?.rows?.[0] || null)
    } catch (error) {
        if (isMissingTableError(error)) return null
        throw error
    }
}

/**
 * Put a dismissed entry back on the list. Its clock restarts, because it is entering
 * the list now rather than when it was first raised.
 */
export async function restoreTaskEntry(connection, { domain, itemKey } = {}) {
    const normalizedDomain = String(domain || '').trim().toLowerCase()
    const key = String(itemKey || '').trim()
    if (!normalizedDomain || !key) return false

    try {
        const result = await connection.query(
            `UPDATE ${TASK_ENTRIES_TABLE}
             SET dismissed_at = NULL, dismissed_by = NULL, first_seen_at = NOW()
             WHERE domain = $1 AND item_key = $2 AND dismissed_at IS NOT NULL
             RETURNING id`,
            [normalizedDomain, key]
        )

        return (result?.rows || []).length > 0
    } catch (error) {
        if (isMissingTableError(error)) return false
        throw error
    }
}
