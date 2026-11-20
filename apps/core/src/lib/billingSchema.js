function normalizeColumnRows(rows) {
    if (!Array.isArray(rows)) return []
    return rows
        .map((row) => String(row?.column_name || row?.COLUMN_NAME || '').trim())
        .filter(Boolean)
}

export async function resolveBillingColumns(connection, dbType) {
    if (!connection) {
        throw new Error('Database connection is required')
    }

    const result = await connection.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'billing'`
    )
    const columns = normalizeColumnRows(result?.rows)

    const hasAccountId = columns.includes('account_id')
    const hasAccountName = columns.includes('account_name')
    const hasMetadata = columns.includes('metadata')

    if (!hasAccountId) {
        throw new Error('billing table is missing required account_id column')
    }

    if (!hasAccountName) {
        throw new Error('billing table is missing required account_name column')
    }

    if (!hasMetadata) {
        throw new Error('billing table is missing required metadata column')
    }

    return {
        accountIdColumn: 'account_id',
        accountNameColumn: 'account_name',
        metadataColumn: 'metadata',
    }
}

export function getBillingSelectExpressions(columns) {
    return {
        accountIdExpr: `${columns.accountIdColumn} AS account_id`,
        accountNameExpr: `${columns.accountNameColumn} AS account_name`,
        metadataExpr: `${columns.metadataColumn} AS metadata`,
    }
}
