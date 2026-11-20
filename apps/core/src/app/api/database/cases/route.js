import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { ensurePatientCasesTables } from '@/lib/patientCasesTable'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { activityActorFromAdminUser, recordActivity } from '@/lib/activities'
import {
    buildCaseTotalsSelect,
    cleanNullableString,
    normalizeCaseRow,
    parseCaseFields,
    patientExists,
} from '@/lib/patientCases'

const CASE_COLUMNS = `
    pc.id, pc.domain, pc.patient_id, pt.patient_name, pc.case_number, pc.status, pc.case_type,
    pc.total_allocation, pc.practitioner, pc.issue_date, pc.expiry_date,
    pc.disable_exceeding, pc.referral_contact, pc.referral_issue_date,
    pc.referral_period, pc.notes, pc.metadata, pc.created_at, pc.updated_at,
    pc.external_id, pc.external_source, pc.external_patient_id
`

function buildCaseSelect(dbType) {
    const totals = buildCaseTotalsSelect(dbType)
    const date = totals.dateExpr
    const replacedColumns = CASE_COLUMNS
        .replaceAll('pc.issue_date', `${date('pc.issue_date')} AS issue_date`)
        .replaceAll('pc.expiry_date', `${date('pc.expiry_date')} AS expiry_date`)
        .replaceAll('pc.referral_issue_date', `${date('pc.referral_issue_date')} AS referral_issue_date`)

    return `
        SELECT ${replacedColumns},
               ${totals.usedExpr},
               ${totals.expiredExpr}
        FROM patient_cases pc
        LEFT JOIN patients pt ON pt.id = pc.patient_id AND pt.domain = pc.domain
    `
}

function parseLimit(rawValue, defaultValue = 200, maxValue = 500) {
    const parsed = Number.parseInt(String(rawValue || ''), 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue
    return Math.min(parsed, maxValue)
}

async function nextCaseNumber(connection, domain) {
    const result = await connection.query(
        'SELECT case_number FROM patient_cases WHERE domain = $1',
        [domain]
    )
    const caseNumbers = (result.rows || []).map((row) => row?.case_number)

    const existing = new Set(
        caseNumbers
            .map((value) => cleanNullableString(value, 120))
            .filter(Boolean)
    )

    let maxSeq = 0
    existing.forEach((value) => {
        const match = /^CASE-(\d+)$/i.exec(value)
        if (match) {
            maxSeq = Math.max(maxSeq, Number.parseInt(match[1], 10))
        }
    })

    let seq = maxSeq > 0 ? maxSeq + 1 : existing.size + 1
    let candidate = `CASE-${String(seq).padStart(4, '0')}`
    while (existing.has(candidate)) {
        seq += 1
        candidate = `CASE-${String(seq).padStart(4, '0')}`
    }
    return candidate
}

async function loadCaseById(connection, dbType, id, domain) {
    const select = buildCaseSelect(dbType)
    const result = await connection.query(
        `${select} WHERE pc.id = $1 AND pc.domain = $2 LIMIT 1`,
        [id, domain]
    )
    return normalizeCaseRow(result.rows?.[0] || null)
}

export async function GET(request) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    let connection = null
    try {
        const { searchParams } = new URL(request.url)
        const context = await resolveAdminDomainScope(request, searchParams.get('domain'))
        if (context?.error) {
            return NextResponse.json({ success: false, error: context.error }, { status: context.status })
        }
        const domain = context.domain
        const rawPatientId = searchParams.get('patient_id')
        const parsedPatientId = Number.parseInt(String(rawPatientId || ''), 10)
        const hasPatientFilter = Number.isFinite(parsedPatientId) && parsedPatientId > 0
        const status = String(searchParams.get('status') || '').trim().toLowerCase()
        const limit = parseLimit(searchParams.get('limit'))

        await ensurePatientCasesTables()
        connection = await getDomainBoundConnection(domain)
        const select = buildCaseSelect(dbType)

        let rows = []
        let query = `${select} WHERE pc.domain = $1`
        const params = [domain]
        let index = 2
        if (hasPatientFilter) {
            query += ` AND pc.patient_id = $${index}`
            params.push(parsedPatientId)
            index += 1
        }
        if (status === 'open' || status === 'closed') {
            query += ` AND pc.status = $${index}`
            params.push(status)
        } else if (status === 'expired') {
            query += ` AND pc.status <> 'closed' AND pc.expiry_date IS NOT NULL AND pc.expiry_date < CURRENT_DATE`
        }
        query += ` ORDER BY pc.id DESC LIMIT $${index}`
        params.push(limit)
        const result = await connection.query(query, params)
        rows = result.rows || []

        return NextResponse.json({ success: true, data: (rows || []).map(normalizeCaseRow) })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load cases' }, { status: 500 })
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
        const payload = await request.json().catch(() => ({}))
        const context = await resolveAdminDomainScope(request, payload?.domain)
        if (context?.error) {
            return NextResponse.json({ success: false, error: context.error }, { status: context.status })
        }
        const domain = context.domain
        const patientId = Number.parseInt(String(payload?.patient_id || ''), 10)
        if (!Number.isFinite(patientId) || patientId <= 0) {
            return NextResponse.json({ success: false, error: 'patient_id is required' }, { status: 400 })
        }

        const parsed = parseCaseFields(payload)
        if (parsed.error) {
            return NextResponse.json({ success: false, error: parsed.error }, { status: 400 })
        }
        const fields = parsed.value
        if (fields.metadata !== null && typeof fields.metadata !== 'object') {
            return NextResponse.json({ success: false, error: 'metadata must be an object or null' }, { status: 400 })
        }

        await ensurePatientCasesTables()
        connection = await getDomainBoundConnection(domain)

        const exists = await patientExists(connection, dbType, patientId, domain)
        if (!exists) {
            return NextResponse.json({ success: false, error: 'Patient not found' }, { status: 404 })
        }

        const caseNumber = fields.case_number || await nextCaseNumber(connection, domain)
        const serializedMetadata = fields.metadata === null ? null : JSON.stringify(fields.metadata)

        const result = await connection.query(
            `INSERT INTO patient_cases (
                domain, patient_id, case_number, status, case_type, total_allocation,
                practitioner, issue_date, expiry_date, disable_exceeding,
                referral_contact, referral_issue_date, referral_period, notes, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)
            RETURNING id`,
            [
                domain, patientId, caseNumber, fields.status, fields.case_type,
                fields.total_allocation, fields.practitioner, fields.issue_date,
                fields.expiry_date, fields.disable_exceeding, fields.referral_contact,
                fields.referral_issue_date, fields.referral_period, fields.notes,
                serializedMetadata,
            ]
        )
        const caseId = result.rows?.[0]?.id || null

        if (!caseId) {
            return NextResponse.json({ success: false, error: 'Failed to create case' }, { status: 500 })
        }

        const createdCase = await loadCaseById(connection, dbType, caseId, domain)
        await recordActivity({
            domain,
            action: 'create',
            entityType: 'case',
            entityId: caseId,
            entityLabel: createdCase?.case_number || caseNumber,
            patientId: patientId,
            patientName: createdCase?.patient_name,
            actor: activityActorFromAdminUser(context.adminUser),
        }, { connection })
        return NextResponse.json({ success: true, case: createdCase })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to create case' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
