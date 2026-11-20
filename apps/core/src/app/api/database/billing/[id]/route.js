import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { ensureBillingTable } from '@/lib/billingTable'
import { normalizeBillingMetadata } from '@/lib/billingMetadata'
import { getBillingSelectExpressions, resolveBillingColumns } from '@/lib/billingSchema'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'

function parseMetadataValue(value) {
    if (value === null || value === undefined || value === '') return null
    if (typeof value === 'object') return value
    if (typeof value !== 'string') return null

    try {
        const parsed = JSON.parse(value)
        return parsed && typeof parsed === 'object' ? parsed : null
    } catch {
        return null
    }
}

function normalizeBillingRow(row) {
    if (!row || typeof row !== 'object') return row
    return {
        ...row,
        account_id: row.account_id ?? null,
        account_name: row.account_name ?? null,
        metadata: normalizeBillingMetadata(parseMetadataValue(row.metadata)),
    }
}

function validateId(rawId) {
    const id = Number.parseInt(String(rawId || ''), 10)
    return Number.isFinite(id) && id > 0 ? id : null
}

async function resolveRouteParams(params) {
    if (params && typeof params.then === 'function') {
        return await params
    }
    return params || {}
}

function getRequestedDomain(request) {
    const { searchParams } = new URL(request.url)
    return searchParams.get('domain')
}

function validateMetadata(metadata) {
    if (metadata === null || metadata === undefined) return null
    if (typeof metadata !== 'object' || Array.isArray(metadata)) {
        return 'metadata must be an object or null'
    }
    return null
}

export async function GET(request, { params }) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    const routeParams = await resolveRouteParams(params)
    const id = validateId(routeParams?.id)
    if (!id) {
        return NextResponse.json({ success: false, error: 'Invalid billing record id' }, { status: 400 })
    }

    const context = await resolveAdminDomainScope(request, getRequestedDomain(request))
    if (context?.error) {
        return NextResponse.json({ success: false, error: context.error }, { status: context.status })
    }
    const domain = context.domain

    let connection = null
    try {
        await ensureBillingTable()
        connection = await getDomainBoundConnection(domain)
        const billingColumns = await resolveBillingColumns(connection, dbType)
        const { accountIdExpr, accountNameExpr, metadataExpr } = getBillingSelectExpressions(billingColumns)

        const result = await connection.query(
            `SELECT id, domain, ${accountIdExpr}, ${accountNameExpr}, ${metadataExpr}
             FROM billing
             WHERE id = $1 AND domain = $2
             LIMIT 1`,
            [id, domain]
        )
        const record = normalizeBillingRow(result.rows?.[0] || null)
        if (!record) {
            return NextResponse.json({ success: false, error: 'Billing record not found' }, { status: 404 })
        }
        return NextResponse.json({ success: true, record })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load billing record' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}

export async function PATCH(request, { params }) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    const routeParams = await resolveRouteParams(params)
    const id = validateId(routeParams?.id)
    if (!id) {
        return NextResponse.json({ success: false, error: 'Invalid billing record id' }, { status: 400 })
    }

    const context = await resolveAdminDomainScope(request, getRequestedDomain(request))
    if (context?.error) {
        return NextResponse.json({ success: false, error: context.error }, { status: context.status })
    }
    const domain = context.domain

    let connection = null
    try {
        await ensureBillingTable()

        const payload = await request.json().catch(() => ({}))
        const billingAccountId = String(payload?.account_id || '').trim()
        const billingAccountName = String(payload?.account_name || '').trim() || null
        const metadata = payload?.metadata === undefined ? {} : payload?.metadata

        if (!billingAccountId) {
            return NextResponse.json({ success: false, error: 'account_id is required' }, { status: 400 })
        }

        const metadataError = validateMetadata(metadata)
        if (metadataError) {
            return NextResponse.json({ success: false, error: metadataError }, { status: 400 })
        }

        connection = await getDomainBoundConnection(domain)
        const billingColumns = await resolveBillingColumns(connection, dbType)
        const serializedMetadata = JSON.stringify(normalizeBillingMetadata(metadata))
        const setClauses = []
        const values = []

        setClauses.push(`${billingColumns.accountIdColumn} = $${values.length + 1}`)
        values.push(billingAccountId)

        if (billingColumns.accountNameColumn) {
            setClauses.push(`${billingColumns.accountNameColumn} = $${values.length + 1}`)
            values.push(billingAccountName)
        }

        if (billingColumns.metadataColumn) {
            setClauses.push(`${billingColumns.metadataColumn} = $${values.length + 1}::jsonb`)
            values.push(serializedMetadata)
        }

        const whereIdParam = `$${values.length + 1}`
        const whereDomainParam = `$${values.length + 2}`
        const { accountIdExpr, accountNameExpr, metadataExpr } = getBillingSelectExpressions(billingColumns)
        const result = await connection.query(
            `UPDATE billing
             SET ${setClauses.join(', ')}
             WHERE id = ${whereIdParam} AND domain = ${whereDomainParam}
             RETURNING id, domain, ${accountIdExpr}, ${accountNameExpr}, ${metadataExpr}`,
            [...values, id, domain]
        )
        const record = normalizeBillingRow(result.rows?.[0] || null)
        if (!record) {
            return NextResponse.json({ success: false, error: 'Billing record not found' }, { status: 404 })
        }
        return NextResponse.json({ success: true, record })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to update billing record' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}

export async function DELETE(request, { params }) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    const routeParams = await resolveRouteParams(params)
    const id = validateId(routeParams?.id)
    if (!id) {
        return NextResponse.json({ success: false, error: 'Invalid billing record id' }, { status: 400 })
    }

    const context = await resolveAdminDomainScope(request, getRequestedDomain(request))
    if (context?.error) {
        return NextResponse.json({ success: false, error: context.error }, { status: context.status })
    }
    const domain = context.domain

    let connection = null
    try {
        await ensureBillingTable()
        connection = await getDomainBoundConnection(domain)

        const result = await connection.query(
            'DELETE FROM billing WHERE id = $1 AND domain = $2 RETURNING id',
            [id, domain]
        )
        if (!result.rows?.length) {
            return NextResponse.json({ success: false, error: 'Billing record not found' }, { status: 404 })
        }
        return NextResponse.json({ success: true })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to delete billing record' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}