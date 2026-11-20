import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { ensurePatientServiceAgreementsTables } from '@/lib/patientServiceAgreementsTable'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { activityActorFromAdminUser, recordActivity } from '@/lib/activities'
import {
    buildServiceAgreementSelect,
    nextServiceAgreementNumber,
    normalizeServiceAgreementRow,
    parseServiceAgreementFields,
    patientExists,
} from '@/lib/patientServiceAgreements'

const FILTER_STATUSES = ['draft', 'sent', 'active', 'terminated', 'superseded']

function parseLimit(rawValue, defaultValue = 200, maxValue = 500) {
    const parsed = Number.parseInt(String(rawValue || ''), 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue
    return Math.min(parsed, maxValue)
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
        const parsedPatientId = Number.parseInt(String(searchParams.get('patient_id') || ''), 10)
        const hasPatientFilter = Number.isFinite(parsedPatientId) && parsedPatientId > 0
        const status = String(searchParams.get('status') || '').trim().toLowerCase()
        const limit = parseLimit(searchParams.get('limit'))

        await ensurePatientServiceAgreementsTables()
        connection = await getDomainBoundConnection(domain)

        let query = `${buildServiceAgreementSelect()} WHERE sa.domain = $1`
        const params = [domain]
        let index = 2

        if (hasPatientFilter) {
            query += ` AND sa.patient_id = $${index}`
            params.push(parsedPatientId)
            index += 1
        }
        if (status === 'expired') {
            // "Expired" is derived: the end date has passed and the agreement was
            // not terminated or superseded.
            query += ` AND sa.status NOT IN ('terminated', 'superseded') AND sa.end_date IS NOT NULL AND sa.end_date < CURRENT_DATE`
        } else if (status && FILTER_STATUSES.includes(status)) {
            query += ` AND sa.status = $${index}`
            params.push(status)
            index += 1
        }

        query += ` ORDER BY sa.id DESC LIMIT $${index}`
        params.push(limit)

        const result = await connection.query(query, params)
        return NextResponse.json({ success: true, data: (result.rows || []).map(normalizeServiceAgreementRow) })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load service agreements' }, { status: 500 })
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

        const parsed = parseServiceAgreementFields(payload)
        if (parsed.error) {
            return NextResponse.json({ success: false, error: parsed.error }, { status: 400 })
        }
        const fields = parsed.value
        if (fields.metadata !== null && typeof fields.metadata !== 'object') {
            return NextResponse.json({ success: false, error: 'metadata must be an object or null' }, { status: 400 })
        }

        await ensurePatientServiceAgreementsTables()
        connection = await getDomainBoundConnection(domain)

        const exists = await patientExists(connection, dbType, patientId, domain)
        if (!exists) {
            return NextResponse.json({ success: false, error: 'Patient not found' }, { status: 404 })
        }

        const agreementNumber = fields.agreement_number || await nextServiceAgreementNumber(connection, domain)
        const serializedMetadata = fields.metadata === null ? null : JSON.stringify(fields.metadata)

        const result = await connection.query(
            `INSERT INTO patient_service_agreements (
                domain, patient_id, agreement_number, status, funding_type, plan_management_type,
                plan_manager, ndis_number, plan_start, plan_end, start_date, end_date, review_date,
                prepared_by, cancellation_notice_days, cancellation_policy, telehealth_authorised,
                non_face_to_face_authorised, travel_claimable, terms, source_quote_id, version,
                supersedes_agreement_id, participant_signatory_name, participant_signed_at,
                representative_name, representative_relationship, representative_signed_at,
                provider_signatory_name, provider_signed_at, terminated_at, termination_reason,
                notes, metadata
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
                $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32,
                $33, $34::jsonb
            ) RETURNING id`,
            [
                domain, patientId, agreementNumber, fields.status, fields.funding_type,
                fields.plan_management_type, fields.plan_manager, fields.ndis_number,
                fields.plan_start, fields.plan_end, fields.start_date, fields.end_date,
                fields.review_date, fields.prepared_by, fields.cancellation_notice_days,
                fields.cancellation_policy, fields.telehealth_authorised,
                fields.non_face_to_face_authorised, fields.travel_claimable, fields.terms,
                fields.source_quote_id, fields.version, fields.supersedes_agreement_id,
                fields.participant_signatory_name, fields.participant_signed_at,
                fields.representative_name, fields.representative_relationship,
                fields.representative_signed_at, fields.provider_signatory_name,
                fields.provider_signed_at, fields.terminated_at, fields.termination_reason,
                fields.notes, serializedMetadata,
            ]
        )
        const agreementId = result.rows?.[0]?.id || null

        if (!agreementId) {
            return NextResponse.json({ success: false, error: 'Failed to create service agreement' }, { status: 500 })
        }

        const created = await connection.query(
            `${buildServiceAgreementSelect()} WHERE sa.id = $1 AND sa.domain = $2 LIMIT 1`,
            [agreementId, domain]
        )
        const createdAgreement = normalizeServiceAgreementRow(created.rows?.[0] || null)

        await recordActivity({
            domain,
            action: 'create',
            entityType: 'service_agreement',
            entityId: agreementId,
            entityLabel: createdAgreement?.agreement_number || agreementNumber,
            patientId,
            patientName: createdAgreement?.patient_name,
            actor: activityActorFromAdminUser(context.adminUser),
        }, { connection })

        return NextResponse.json({ success: true, agreement: createdAgreement })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to create service agreement' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
