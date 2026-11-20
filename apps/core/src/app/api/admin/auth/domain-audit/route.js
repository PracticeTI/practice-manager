import { NextResponse } from 'next/server'
import { isSuperAdmin, verifyAdminToken } from '@/lib/auth'
import { getDatabaseConnection } from '@/lib/database'

const DEFAULT_DOMAIN_AUDIT_TABLES = [
    'billing',
    'patient_analysis',
    'patient_analysis_jobs',
    'patient_billing_jobs',
    'patient_cases',
    'patient_quote_jobs',
    'patient_quotes',
    'patient_service_agreements',
    'patient_reports',
    'patient_transcriptions',
    'case_usage',
    'quote_items',
    'service_agreement_items',
    'chats',
    'outbound_messages',
]

const TABLE_DOMAIN_POLICY = {
    billing: 'tenant-scoped',
    patient_analysis: 'tenant-scoped',
    patient_analysis_jobs: 'tenant-scoped',
    patient_billing_jobs: 'tenant-scoped',
    patient_cases: 'tenant-scoped',
    patient_quote_jobs: 'tenant-scoped',
    patient_quotes: 'tenant-scoped',
    patient_service_agreements: 'tenant-scoped',
    patient_reports: 'tenant-scoped',
    patient_transcriptions: 'tenant-scoped',
    case_usage: 'tenant-scoped',
    quote_items: 'tenant-scoped',
    service_agreement_items: 'tenant-scoped',
    chats: 'tenant-scoped',
    outbound_messages: 'tenant-scoped',
    messages: 'not-used',
    recycling_items: 'not-used',
}

function normalizeDomain(value) {
    if (typeof value !== 'string') return ''
    return value.trim().toLowerCase()
}

function normalizeTables(value) {
    if (Array.isArray(value)) {
        return value
            .map((item) => String(item || '').trim())
            .filter((item) => item && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(item))
    }

    return [...DEFAULT_DOMAIN_AUDIT_TABLES]
}

async function readTableDomainMeta(client, tableName) {
    const schemaCheck = await client.query(
        `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = 'domain'
      ) AS has_domain_column,
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = $1
      ) AS table_exists
      , COALESCE((
          SELECT c.relrowsecurity
          FROM pg_class c
          INNER JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = $1
          LIMIT 1
      ), false) AS rls_enabled
      , COALESCE((
          SELECT c.relforcerowsecurity
          FROM pg_class c
          INNER JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = $1
          LIMIT 1
      ), false) AS rls_forced
      , COALESCE((
          SELECT pg_get_userbyid(c.relowner) = current_user
          FROM pg_class c
          INNER JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = $1
          LIMIT 1
      ), false) AS is_table_owner
      , COALESCE((
          SELECT r.rolsuper
          FROM pg_roles r
          WHERE r.rolname = current_user
      ), false) AS role_is_superuser
      , COALESCE((
          SELECT r.rolbypassrls
          FROM pg_roles r
          WHERE r.rolname = current_user
      ), false) AS role_bypasses_rls
    `,
        [tableName]
    )

    const row = schemaCheck.rows?.[0] || {}
    const rlsEnabled = row.rls_enabled === true
    const rlsForced = row.rls_forced === true
    const isTableOwner = row.is_table_owner === true
    const roleIsSuperuser = row.role_is_superuser === true
    const roleBypassesRls = row.role_bypasses_rls === true

    return {
        hasDomainColumn: row.has_domain_column === true,
        tableExists: row.table_exists === true,
        rlsEnabled,
        rlsForced,
        isTableOwner,
        roleIsSuperuser,
        roleBypassesRls,
        rlsAppliesToConnection: rlsEnabled
            && !roleIsSuperuser
            && !roleBypassesRls
            && (!isTableOwner || rlsForced),
    }
}

async function readBigPictureDomainAudit(client, tableName, domain) {
    const tableMeta = await readTableDomainMeta(client, tableName)
    const policy = TABLE_DOMAIN_POLICY[tableName] || 'tenant-scoped'

    if (!tableMeta.tableExists) {
        return {
            status: 'warn',
            tableName,
            hasDomainColumn: false,
            policy,
            message: `Table ${tableName} does not exist in public schema; it is not part of the current app schema.`,
        }
    }

    if (!tableMeta.hasDomainColumn) {
        return {
            status: 'warn',
            tableName,
            hasDomainColumn: false,
            policy,
            message: 'No domain column detected; cannot confirm cross-domain isolation automatically.',
        }
    }

    const rowsForDomain = await client.query(
        `SELECT COUNT(*)::int AS count FROM public.${tableName} WHERE domain = $1`,
        [domain]
    )

    const crossDomainRows = await client.query(
        `SELECT COUNT(*)::int AS count FROM public.${tableName} WHERE domain IS NOT NULL AND domain <> $1`,
        [domain]
    )

    const crossCount = Number(crossDomainRows.rows?.[0]?.count || 0)
    const domainCount = Number(rowsForDomain.rows?.[0]?.count || 0)
    const rlsDetails = {
        rlsEnabled: tableMeta.rlsEnabled,
        rlsForced: tableMeta.rlsForced,
        connectionOwnsTable: tableMeta.isTableOwner,
        connectionBypassesRls: tableMeta.roleIsSuperuser || tableMeta.roleBypassesRls,
        rlsAppliesToConnection: tableMeta.rlsAppliesToConnection,
    }

    if (policy === 'not-used') {
        return {
            status: 'warn',
            tableName,
            hasDomainColumn: true,
            policy,
            expectedDomain: domain,
            rowsForDomain: domainCount,
            crossDomainRows: crossCount,
            ...rlsDetails,
            message: `Table ${tableName} is not used in the current app schema; this warning does not indicate a security violation.`,
        }
    }

    if (!tableMeta.rlsAppliesToConnection) {
        return {
            status: 'warn',
            tableName,
            hasDomainColumn: true,
            policy,
            expectedDomain: domain,
            rowsForDomain: domainCount,
            crossDomainRows: null,
            storedCrossDomainRows: crossCount,
            auditMode: 'inventory-only',
            ...rlsDetails,
            message: `The database connection bypasses RLS for ${tableName}; ${crossCount} stored row(s) outside ${domain} do not prove tenant visibility.`,
        }
    }

    return {
        status: crossCount === 0 ? 'pass' : 'fail',
        tableName,
        hasDomainColumn: true,
        policy,
        expectedDomain: domain,
        rowsForDomain: domainCount,
        crossDomainRows: crossCount,
        auditMode: 'rls-enforced',
        ...rlsDetails,
        message: crossCount === 0
            ? `Only rows for ${domain} are visible to the simulated admin.`
            : `Found ${crossCount} row(s) outside ${domain}.`,
    }
}

export async function POST(request) {
    try {
        const body = await request.json().catch(() => ({}))
        const authHeader = request.headers.get('authorization') || ''
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : ''
        const adminUser = await verifyAdminToken(token)

        if (!adminUser) {
            return NextResponse.json({ error: 'Unauthorized: valid admin token required' }, { status: 401 })
        }

        const requestedDomain = normalizeDomain(body?.domain || adminUser?.domain || '')
        if (!requestedDomain) {
            return NextResponse.json({ error: 'A domain value is required to run a domain-scoped audit.' }, { status: 400 })
        }

        const adminDomain = normalizeDomain(adminUser?.domain || '')
        if (!isSuperAdmin(adminUser) && (!adminDomain || requestedDomain !== adminDomain)) {
            return NextResponse.json({ error: 'Forbidden: domain scope mismatch' }, { status: 403 })
        }

        const candidateTables = normalizeTables(body?.tables)
        const client = await getDatabaseConnection()

        try {
            await client.query('BEGIN')
            await client.query(
                `SELECT set_config('request.jwt.claims', $1::text, true)`,
                [JSON.stringify({ role: 'admin', domain: requestedDomain, username: `sim-admin-${requestedDomain}` })]
            )

            const tableResults = []
            for (const tableName of candidateTables) {
                try {
                    const result = await readBigPictureDomainAudit(client, tableName, requestedDomain)
                    tableResults.push(result)
                } catch (error) {
                    tableResults.push({
                        status: 'warn',
                        tableName,
                        hasDomainColumn: false,
                        message: error?.message || 'Unable to inspect table.',
                    })
                }
            }

            const failedTables = tableResults.filter((row) => row.status === 'fail')
            const warnTables = tableResults.filter((row) => row.status === 'warn')

            return NextResponse.json({
                ok: failedTables.length === 0,
                auditedDomain: requestedDomain,
                tokenRole: adminUser?.role || 'admin',
                tableResults,
                summary: {
                    total: tableResults.length,
                    pass: tableResults.filter((row) => row.status === 'pass').length,
                    warn: warnTables.length,
                    fail: failedTables.length,
                },
            })
        } finally {
            await client.query('ROLLBACK').catch(() => { })
            await client.end().catch(() => { })
        }
    } catch (error) {
        return NextResponse.json({
            ok: false,
            error: error?.message || 'Domain audit could not be completed.',
        }, { status: 500 })
    }
}
