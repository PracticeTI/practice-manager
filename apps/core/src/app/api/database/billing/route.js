import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { ensureBillingTable } from '@/lib/billingTable'
import { normalizeBillingMetadata } from '@/lib/billingMetadata'
import { getBillingSelectExpressions, resolveBillingColumns } from '@/lib/billingSchema'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'

function parseLimit(rawValue, defaultValue = 100, maxValue = 500) {
    const parsed = Number.parseInt(String(rawValue || ''), 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue
    return Math.min(parsed, maxValue)
}

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

function validateMetadata(metadata) {
    if (metadata === null || metadata === undefined) return null
    if (typeof metadata !== 'object' || Array.isArray(metadata)) {
        return 'metadata must be an object or null'
    }
    return null
}

export async function GET(request) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    let connection = null
    try {
        await ensureBillingTable()

        const { searchParams } = new URL(request.url)
        const context = await resolveAdminDomainScope(request, searchParams.get('domain'))
        if (context?.error) {
            return NextResponse.json({ success: false, error: context.error }, { status: context.status })
        }
        const domain = context.domain
        const billingAccountId = String(searchParams.get('account_id') || '').trim() || null
        const limit = parseLimit(searchParams.get('limit'))

        connection = await getDomainBoundConnection(domain)
        const billingColumns = await resolveBillingColumns(connection, dbType)
        const { accountIdExpr, accountNameExpr, metadataExpr } = getBillingSelectExpressions(billingColumns)

        const baseSelect = `SELECT id, domain, ${accountIdExpr}, ${accountNameExpr}, ${metadataExpr}
                 FROM billing`

        if (billingAccountId) {
            const result = await connection.query(
                `${baseSelect}
                 WHERE domain = $1 AND ${billingColumns.accountIdColumn} = $2
                 ORDER BY id DESC
                 LIMIT $3`,
                [domain, billingAccountId, limit]
            )
            return NextResponse.json({ success: true, data: (result.rows || []).map(normalizeBillingRow) })
        }

        const result = await connection.query(
            `${baseSelect}
             WHERE domain = $1
             ORDER BY id DESC
             LIMIT $2`,
            [domain, limit]
        )
        return NextResponse.json({ success: true, data: (result.rows || []).map(normalizeBillingRow) })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load billing records' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}

export async function POST(request) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    let connection = null
    try {
        await ensureBillingTable()

        const payload = await request.json().catch(() => ({}))
        const billingAccountId = String(payload?.account_id || '').trim()
        const billingAccountName = String(payload?.account_name || '').trim() || null
        const context = await resolveAdminDomainScope(request, payload?.domain)
        if (context?.error) {
            return NextResponse.json({ success: false, error: context.error }, { status: context.status })
        }
        const domain = context.domain
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
        const insertColumns = ['domain', billingColumns.accountIdColumn]
        const insertValues = [domain, billingAccountId]
        insertColumns.push(billingColumns.accountNameColumn)
        insertValues.push(billingAccountName)
        insertColumns.push(billingColumns.metadataColumn)
        insertValues.push(serializedMetadata)

        const placeholders = insertColumns.map((columnName, index) => {
            const base = `$${index + 1}`
            if (columnName === billingColumns.metadataColumn && billingColumns.metadataColumn) {
                return `${base}::jsonb`
            }
            return base
        })

        const { accountIdExpr, accountNameExpr, metadataExpr } = getBillingSelectExpressions(billingColumns)
        const result = await connection.query(
            `INSERT INTO billing (${insertColumns.join(', ')})
             VALUES (${placeholders.join(', ')})
             RETURNING id, domain, ${accountIdExpr}, ${accountNameExpr}, ${metadataExpr}`,
            insertValues
        )
        return NextResponse.json({ success: true, record: normalizeBillingRow(result.rows?.[0] || null) })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to create billing record' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}