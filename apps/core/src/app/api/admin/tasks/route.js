import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { getDomainSetting } from '@/lib/appSettings'
import { normalizeDomainFeatureFlags } from '@/lib/domainFeatureFlags'
import { isEquipmentSourcerEnabled } from '@/lib/patientEquipmentQueue'
import { resolveSourcingResultsTable } from '@/lib/equipmentSourcing'
import { buildQuoteSelect } from '@/lib/patientQuotes'
import { ensurePatientQuotesTables } from '@/lib/patientQuotesTable'
import {
    buildPatientTaskGroups,
    flattenPatientTaskItems,
    summarizePatientTasks,
} from '@/lib/patientTasks'
import {
    buildTaskBoard,
    dismissTaskEntry,
    restoreTaskEntry,
    syncTaskEntries,
} from '@/lib/taskEntries'
import { isUnreviewedReportJob } from '@/lib/workerProvenance'
import {
    ensureReportReviewColumns,
    loadLatestReportJobs,
    resolveReportQueueTableName,
} from '@/lib/patientReportReview'
import {
    ensureContactEnquiryReviewColumns,
    loadUnreviewedContactEnquiries,
} from '@/lib/contactEnquiryReview'

export const runtime = 'nodejs'


/** The dashboard card holds three rows; the page asks for everything. */
const DEFAULT_PREVIEW_LIMIT = 3
const MAX_PREVIEW_LIMIT = 50

function parseLimit(rawValue) {
    const parsed = Number.parseInt(String(rawValue || ''), 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return null
    return Math.min(parsed, MAX_PREVIEW_LIMIT)
}

function isMissingTableError(error) {
    const message = String(error?.message || '').toLowerCase()
    return message.includes('does not exist')
}

function parseJsonArray(value) {
    if (Array.isArray(value)) return value
    try {
        const parsed = JSON.parse(String(value || '[]'))
        return Array.isArray(parsed) ? parsed : []
    } catch {
        return []
    }
}

/**
 * Every patient in the practice, with the one per-patient fact the worker records
 * cannot supply: whether their Equipment Sourcer is switched on (its tab only
 * exists while it is — see the patient Overview).
 */
async function loadPatients(connection, domain) {
    try {
        const result = await connection.query(
            `SELECT id, patient_name, metadata FROM patients WHERE domain = $1 ORDER BY id`,
            [domain]
        )

        return (result.rows || []).map((row) => ({
            id: row.id,
            patientName: row.patient_name || '',
            equipmentSourcerEnabled: isEquipmentSourcerEnabled(row.metadata),
        }))
    } catch (error) {
        // A practice that has not turned Patients on has no table yet, which is an
        // empty queue rather than a failure.
        if (isMissingTableError(error)) return []
        throw error
    }
}

/**
 * The worker's draft quotes, in the same shape the Quotes tab reads (so the queue
 * rules see the columns they expect). Only a `draft` quote can be awaiting review,
 * but which drafts are the worker's is left to `isUnreviewedWorkerQuote` in the
 * queue builder rather than restated here.
 */
async function loadQuoteRows(connection, domain) {
    await ensurePatientQuotesTables()

    const result = await connection.query(
        `${buildQuoteSelect()} WHERE pq.domain = $1 AND pq.status = 'draft' ORDER BY pq.id DESC`,
        [domain]
    )

    return result.rows || []
}

async function loadEquipmentRows(connection, domain) {
    const resultsTable = resolveSourcingResultsTable()

    try {
        const result = await connection.query(
            `SELECT patient_id, patient_name, suggestions_json, updated_at FROM ${resultsTable} WHERE domain = $1`,
            [domain]
        )

        return (result.rows || []).map((row) => ({
            patientId: row.patient_id,
            patientName: row.patient_name || '',
            suggestions: parseJsonArray(row.suggestions_json),
            updatedAt: row.updated_at || null,
        }))
    } catch (error) {
        if (isMissingTableError(error)) return []
        throw error
    }
}

/**
 * The published reports nobody has opened, one row per patient: the newest job each
 * of them has, kept only when that job completed and still carries no `reviewed_at`
 * (see `patientReportReview.js` for where that marker is written).
 */
async function loadReportJobRows(connection, domain) {
    const table = resolveReportQueueTableName()

    try {
        await ensureReportReviewColumns(connection, table)
    } catch {
        // A queue table that predates the review columns is still readable — the
        // missing column simply reads as "nobody has opened this report yet".
    }

    try {
        const rows = await loadLatestReportJobs(connection, { domain, table })
        return rows.filter(isUnreviewedReportJob)
    } catch (error) {
        if (isMissingTableError(error)) return []
        throw error
    }
}

/**
 * The website enquiries nobody has opened yet. The queue table predates the review
 * marker, so its columns are added on first use; a table that still lacks them
 * reports every enquiry as waiting rather than failing the page (see
 * `contactEnquiryReview.js`).
 */
async function loadEnquiryRows(connection, domain) {
    try {
        await ensureContactEnquiryReviewColumns(connection)
    } catch (error) {
        // A practice whose queue table has not been created yet has no enquiries,
        // which is an empty list rather than a failure.
        if (isMissingTableError(error)) return []
        throw error
    }

    try {
        return await loadUnreviewedContactEnquiries(connection, { domain })
    } catch (error) {
        if (isMissingTableError(error)) return []
        throw error
    }
}

/** Close a connection opened by one of the two handlers below. */
async function closeConnection(connection) {
    if (connection?.end) await connection.end().catch(() => { })
    else if (connection?.close) await connection.close().catch(() => { })
}

/**
 * The derived queue for one practice, before dismissals are applied — the raw
 * "what is outstanding" list both handlers start from.
 */
async function loadTaskGroups(connection, domain) {
    const [patients, quotes, equipment, reportJobs, enquiries] = await Promise.all([
        loadPatients(connection, domain),
        loadQuoteRows(connection, domain),
        loadEquipmentRows(connection, domain),
        loadReportJobRows(connection, domain),
        loadEnquiryRows(connection, domain),
    ])

    return buildPatientTaskGroups({ patients, quotes, equipment, reportJobs, enquiries })
}

/** The domain's Tasks flag, answering "is the queue on at all?". */
async function isTasksEnabledForDomain(domain) {
    const domainSettings = (await getDomainSetting(domain, 'management')) || {}
    return normalizeDomainFeatureFlags(domainSettings, domain).tasksEnabled === true
}

/**
 * GET /api/admin/tasks
 *
 * The practice-wide roll-up of every patient's "Waiting on review" queue, plus the
 * website enquiries waiting for a reply. Gated by the domain's `tasksEnabled` flag,
 * so a domain that has not turned Tasks on is answered with an empty queue rather
 * than with data it does not surface.
 *
 * The list a practice works from is the ledger rather than the derivation alone (see
 * `taskEntries.js`): an entry stays on it until somebody marks it done, even after
 * the underlying record is actioned. `groups` is what is still on the list and
 * `dismissedItems` is the Done history; `?limit=` also returns `previewItems` — the
 * flattened first rows, which is what the dashboard card shows without carrying the
 * whole list to the browser.
 */
export async function GET(request) {
    const { searchParams } = new URL(request.url)
    const context = await resolveAdminDomainScope(request, searchParams.get('domain'))
    if (context?.error) {
        return NextResponse.json({ success: false, error: context.error }, { status: context.status || 401 })
    }

    const domain = String(context.domain || '').trim().toLowerCase()
    const previewLimit = parseLimit(searchParams.get('limit')) ?? DEFAULT_PREVIEW_LIMIT

    try {
        if (!(await isTasksEnabledForDomain(domain))) {
            return NextResponse.json({
                success: true,
                enabled: false,
                domain,
                groups: [],
                dismissedItems: [],
                summary: summarizePatientTasks([]),
                previewItems: [],
            })
        }

        const dbType = detectDatabaseType()
        if (dbType !== 'postgresql') {
            return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 503 })
        }

        let connection = null
        try {
            connection = await getDomainBoundConnection(domain)

            const derivedGroups = await loadTaskGroups(connection, domain)
            const entries = await syncTaskEntries(connection, { domain, groups: derivedGroups })
            const { groups, dismissedItems } = buildTaskBoard({ groups: derivedGroups, entries })

            return NextResponse.json({
                success: true,
                enabled: true,
                domain,
                groups,
                dismissedItems,
                summary: summarizePatientTasks(groups),
                previewItems: flattenPatientTaskItems(groups, previewLimit),
            })
        } finally {
            await closeConnection(connection)
        }
    } catch (error) {
        return NextResponse.json(
            { success: false, error: error?.message || 'Failed to load tasks' },
            { status: 500 }
        )
    }
}

/**
 * POST /api/admin/tasks
 *
 * Mark one entry done (`{ action: 'dismiss', itemKey }`) or put it back
 * (`{ action: 'restore', itemKey }`). Nothing else takes an entry off the list, and
 * the underlying quote/equipment/report/enquiry record is never modified — which is
 * what makes restore exact.
 *
 * A dismissal names an entry the practice was already shown: the ledger is synced
 * from the record first, so a stale browser tab can neither clear work that is not
 * on the list nor invent a row that never existed.
 */
export async function POST(request) {
    const { searchParams } = new URL(request.url)
    const context = await resolveAdminDomainScope(request, searchParams.get('domain'))
    if (context?.error) {
        return NextResponse.json({ success: false, error: context.error }, { status: context.status || 401 })
    }

    const domain = String(context.domain || '').trim().toLowerCase()
    const body = await request.json().catch(() => ({}))
    const action = String(body?.action || '').trim().toLowerCase()
    const itemKey = String(body?.itemKey || '').trim()

    if (!itemKey) {
        return NextResponse.json({ success: false, error: 'itemKey is required' }, { status: 400 })
    }

    if (action !== 'dismiss' && action !== 'restore') {
        return NextResponse.json({ success: false, error: 'Unsupported action' }, { status: 400 })
    }

    try {
        if (!(await isTasksEnabledForDomain(domain))) {
            return NextResponse.json(
                { success: false, error: 'Tasks are not enabled for this domain' },
                { status: 403 }
            )
        }

        const dbType = detectDatabaseType()
        if (dbType !== 'postgresql') {
            return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 503 })
        }

        let connection = null
        try {
            connection = await getDomainBoundConnection(domain)

            if (action === 'restore') {
                const restored = await restoreTaskEntry(connection, { domain, itemKey })
                return NextResponse.json({ success: true, action, itemKey, restored })
            }

            const derivedGroups = await loadTaskGroups(connection, domain)
            const entries = await syncTaskEntries(connection, { domain, groups: derivedGroups })

            if (!entries.some((entry) => entry.itemKey === itemKey)) {
                return NextResponse.json(
                    { success: false, error: 'That task is not on the list' },
                    { status: 404 }
                )
            }

            const dismissedBy = String(
                context.adminUser?.username || context.adminUser?.email || ''
            ).trim() || null

            const dismissed = await dismissTaskEntry(connection, { domain, itemKey, dismissedBy })
            return NextResponse.json({ success: true, action, itemKey, dismissed })
        } finally {
            await closeConnection(connection)
        }
    } catch (error) {
        return NextResponse.json(
            { success: false, error: error?.message || 'Failed to update the task' },
            { status: 500 }
        )
    }
}
