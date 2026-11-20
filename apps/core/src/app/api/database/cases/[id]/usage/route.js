import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { ensurePatientCasesTables } from '@/lib/patientCasesTable'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { activityActorFromAdminUser, loadActivityPatientName, recordActivity } from '@/lib/activities'
import {
    buildCaseTotalsSelect,
    cleanNullableString,
    normalizeCaseRow,
    normalizeUsageRow,
    parseDateOnly,
    resolveRouteParams,
    toFinite,
    validateId,
} from '@/lib/patientCases'

function parseLimit(rawValue, defaultValue = 500, maxValue = 1000) {
    const parsed = Number.parseInt(String(rawValue || ''), 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue
    return Math.min(parsed, maxValue)
}

async function loadCaseWithTotals(connection, dbType, caseId, domain) {
    const totals = buildCaseTotalsSelect(dbType)
    const date = totals.dateExpr

    const result = await connection.query(
        `SELECT
            pc.id, pc.domain, pc.patient_id, pc.case_number, pc.status, pc.case_type,
            pc.total_allocation, pc.disable_exceeding,
            ${date('pc.expiry_date')} AS expiry_date,
            ${totals.usedExpr},
            ${totals.expiredExpr}
         FROM patient_cases pc
         WHERE pc.id = $1 AND pc.domain = $2
         LIMIT 1`,
        [caseId, domain]
    )
    return normalizeCaseRow(result.rows?.[0] || null)
}

export async function GET(request, { params }) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    const routeParams = await resolveRouteParams(params)
    const caseId = validateId(routeParams?.id)
    if (!caseId) {
        return NextResponse.json({ success: false, error: 'Invalid case id' }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const context = await resolveAdminDomainScope(request, searchParams.get('domain'))
    if (context?.error) {
        return NextResponse.json({ success: false, error: context.error }, { status: context.status })
    }
    const domain = context.domain
    const limit = parseLimit(searchParams.get('limit'))

    let connection = null
    try {
        await ensurePatientCasesTables()
        connection = await getDomainBoundConnection(domain)

        const result = await connection.query(
            `SELECT id, domain, case_id, patient_id,
                    to_char(entry_date, 'YYYY-MM-DD') AS entry_date,
                    description, quantity, metadata, created_at, updated_at
             FROM case_usage
             WHERE case_id = $1 AND domain = $2
             ORDER BY entry_date DESC, id DESC
             LIMIT $3`,
            [caseId, domain, limit]
        )
        return NextResponse.json({ success: true, data: (result.rows || []).map(normalizeUsageRow) })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load usage' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}

export async function POST(request, { params }) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    const routeParams = await resolveRouteParams(params)
    const caseId = validateId(routeParams?.id)
    if (!caseId) {
        return NextResponse.json({ success: false, error: 'Invalid case id' }, { status: 400 })
    }

    let connection = null
    try {
        const payload = await request.json().catch(() => ({}))
        const context = await resolveAdminDomainScope(request, payload?.domain)
        if (context?.error) {
            return NextResponse.json({ success: false, error: context.error }, { status: context.status })
        }
        const domain = context.domain

        const entryDate = parseDateOnly(payload?.entry_date)
        if (!entryDate) {
            return NextResponse.json({ success: false, error: 'entry_date (YYYY-MM-DD) is required' }, { status: 400 })
        }

        const quantity = toFinite(payload?.quantity)
        if (!Number.isFinite(Number(payload?.quantity)) || quantity <= 0) {
            return NextResponse.json({ success: false, error: 'quantity must be greater than zero' }, { status: 400 })
        }

        const description = cleanNullableString(payload?.description, 255)
        const metadata = payload?.metadata === undefined ? null : payload?.metadata
        if (metadata !== null && typeof metadata !== 'object') {
            return NextResponse.json({ success: false, error: 'metadata must be an object or null' }, { status: 400 })
        }

        await ensurePatientCasesTables()
        connection = await getDomainBoundConnection(domain)

        const record = await loadCaseWithTotals(connection, dbType, caseId, domain)
        if (!record) {
            return NextResponse.json({ success: false, error: 'Case not found' }, { status: 404 })
        }
        if (record.status === 'closed') {
            return NextResponse.json({ success: false, error: 'This case is closed. Reopen it before logging usage.' }, { status: 409 })
        }
        if (record.is_expired) {
            return NextResponse.json({ success: false, error: 'This case has expired. Extend the expiry date before logging usage.' }, { status: 409 })
        }

        const patientId = record.patient_id
        const used = toFinite(record.used_quantity)
        if (record.disable_exceeding) {
            const remaining = toFinite(record.total_allocation) - used
            if (quantity > remaining + 0.000001) {
                return NextResponse.json({
                    success: false,
                    error: `This would exceed the remaining allocation (${Math.max(remaining, 0).toFixed(2)} remaining).`,
                }, { status: 409 })
            }
        }

        const serializedMetadata = metadata === null ? null : JSON.stringify(metadata)
        const result = await connection.query(
            `INSERT INTO case_usage (domain, case_id, patient_id, entry_date, description, quantity, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
             RETURNING id`,
            [domain, caseId, patientId, entryDate, description, quantity, serializedMetadata]
        )
        const usageId = result.rows?.[0]?.id || null

        if (!usageId) {
            return NextResponse.json({ success: false, error: 'Failed to save usage' }, { status: 500 })
        }

        const usageResult = await connection.query(
            `SELECT id, domain, case_id, patient_id,
                    to_char(entry_date, 'YYYY-MM-DD') AS entry_date,
                    description, quantity, metadata, created_at, updated_at
             FROM case_usage WHERE id = $1 AND domain = $2 LIMIT 1`,
            [usageId, domain]
        )
        const usageRow = normalizeUsageRow(usageResult.rows?.[0] || null)

        await recordActivity({
            domain,
            action: 'create',
            entityType: 'case_usage',
            entityId: usageId,
            entityLabel: usageRow?.description || `Case ${record.case_number || caseId}`,
            patientId,
            patientName: await loadActivityPatientName(connection, patientId, domain),
            metadata: { case_id: caseId, entry_date: entryDate, quantity },
            actor: activityActorFromAdminUser(context.adminUser),
        }, { connection })

        const remaining = toFinite(record.total_allocation) - (used + quantity)
        return NextResponse.json({
            success: true,
            usage: usageRow,
            remaining: remaining < 0 ? 0 : remaining,
            totalAllocation: toFinite(record.total_allocation),
        })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to save usage' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
