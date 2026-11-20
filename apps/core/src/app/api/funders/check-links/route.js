import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminAuth } from '@/lib/auth'
import { applyFunderLinkResults, listFunders } from '@/lib/fundersStore'
import {
    DEFAULT_LINK_CHECK_CONCURRENCY,
    DEFAULT_LINK_CHECK_TIMEOUT_MS,
    checkFunderLinks,
    describeLinkCheckSummary,
    summarizeLinkCheck,
} from '@/lib/funderLinkCheck'

export const runtime = 'nodejs'
// The check issues one outbound request per document; give it room to finish.
export const maxDuration = 60

/**
 * Run the funder link check on demand.
 *
 * This is the button on `/admin/settings` → Dev Tools, and it mirrors
 * `scripts/check-funder-links.mjs`. It is deliberately **local-only**: it fans out
 * dozens of outbound requests to ndis.gov.au, which has no business happening from
 * a production deployment on behalf of an admin. Superadmin is required on top of
 * that, matching every other Dev Tools action.
 *
 * Body: `{ apply?: boolean, only?: string, limit?: number }`
 */
export async function POST(request) {
    const adminUser = await verifyAdminAuth(request)
    if (!adminUser) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }
    if (!isSuperAdmin(adminUser)) {
        return NextResponse.json({ success: false, error: 'Superadmin access required' }, { status: 403 })
    }
    if (process.env.NODE_ENV === 'production') {
        return NextResponse.json(
            { success: false, error: 'The funder link check only runs in local development' },
            { status: 403 }
        )
    }

    try {
        const body = await request.json().catch(() => ({}))
        const apply = body?.apply === true
        const only = String(body?.only || '').trim().toLowerCase()
        const limit = Number.parseInt(String(body?.limit ?? ''), 10)

        let funders = await listFunders({ includeUnpublished: true })
        if (only) {
            funders = funders.filter((funder) => funder.key === only)
        }

        let targets = funders
        if (Number.isFinite(limit) && limit > 0) {
            let remaining = limit
            targets = []
            for (const funder of funders) {
                if (remaining <= 0) break
                const documents = funder.documents.slice(0, remaining)
                remaining -= documents.length
                targets.push({ ...funder, documents })
            }
        }

        const results = await checkFunderLinks({
            funders: targets,
            concurrency: DEFAULT_LINK_CHECK_CONCURRENCY,
            timeoutMs: DEFAULT_LINK_CHECK_TIMEOUT_MS,
        })
        const summary = summarizeLinkCheck(results)

        let updated = 0
        if (apply) {
            const applied = await applyFunderLinkResults(results)
            updated = applied.updated
        }

        return NextResponse.json({
            success: true,
            summary,
            summaryText: describeLinkCheckSummary(summary),
            updated,
            // Only the ones worth acting on — a clean report should not ship 25 rows.
            problems: results.filter((result) => result.status !== 'ok' && result.status !== 'skipped'),
            checkedAt: new Date().toISOString(),
        })
    } catch (error) {
        return NextResponse.json(
            { success: false, error: error?.message || 'Failed to check funder links' },
            { status: 500 }
        )
    }
}
