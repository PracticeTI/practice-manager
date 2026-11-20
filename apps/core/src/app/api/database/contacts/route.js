import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { ensureContactsTable, linkContactToPatient } from '@/lib/contactsTable'
import { patientsTableExists, patientsBelongToDomain } from '@/lib/patientsTable'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import {
    buildContactPatientExistsClause,
    buildContactPatientSearchClause,
    buildContactSelect,
    cleanString,
    contactOrderExpression,
    isEmptyContact,
    normalizeContactRow,
    resolveContactFields,
    validateId,
} from '@/lib/contacts'

function parseLimit(rawValue, defaultValue = 500, maxValue = 1000) {
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

        const search = cleanString(searchParams.get('search')).toLowerCase()
        const limit = parseLimit(searchParams.get('limit'))
        const patientId = validateId(searchParams.get('patientId'))

        await ensureContactsTable()
        connection = await getDomainBoundConnection(domain)

        // The patient name is only joined when the table exists, so a domain that
        // has no patients still lists its contacts.
        const includePatient = await patientsTableExists(connection)

        const params = [domain]
        const whereParts = ['c.domain = $1']

        if (patientId) {
            params.push(patientId)
            whereParts.push(buildContactPatientExistsClause(`$${params.length}`))
        }

        if (search) {
            params.push(`%${search}%`)
            whereParts.push(`(
                LOWER(COALESCE(c.name, '')) LIKE $${params.length}
                OR LOWER(COALESCE(c.email, '')) LIKE $${params.length}
                OR LOWER(COALESCE(c.phone, '')) LIKE $${params.length}
                OR LOWER(COALESCE(c.association, '')) LIKE $${params.length}
                OR LOWER(COALESCE(c.role, '')) LIKE $${params.length}
                ${includePatient ? `OR ${buildContactPatientSearchClause(`$${params.length}`)}` : ''}
            )`)
        }

        const result = await connection.query(
            `${buildContactSelect({ includePatient })} WHERE ${whereParts.join(' AND ')}
             ORDER BY ${contactOrderExpression()} LIMIT ${limit}`,
            params
        )

        return NextResponse.json({ success: true, data: (result.rows || []).map(normalizeContactRow) })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load contacts' }, { status: 500 })
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

        const { updates, errors } = resolveContactFields(payload || {})
        if (errors.length > 0) {
            return NextResponse.json({ success: false, error: errors[0] }, { status: 400 })
        }

        const fields = Object.fromEntries(
            updates.filter((update) => update.key !== 'patient_ids').map((update) => [update.key, update.value])
        )
        if (isEmptyContact(fields)) {
            return NextResponse.json({ success: false, error: 'A contact needs a name or an email address' }, { status: 400 })
        }

        const patientIds = updates.find((update) => update.key === 'patient_ids')?.value || []

        await ensureContactsTable()
        connection = await getDomainBoundConnection(domain)

        if (!(await patientsBelongToDomain(connection, patientIds, domain))) {
            return NextResponse.json({ success: false, error: 'The selected patient was not found' }, { status: 400 })
        }

        const keys = ['domain', ...Object.keys(fields)]
        const values = [
            domain,
            ...Object.values(fields).map((value) => (
                value && typeof value === 'object' ? JSON.stringify(value) : value
            )),
        ]
        const placeholders = keys.map((_key, index) => `$${index + 1}`)

        const result = await connection.query(
            `INSERT INTO contacts (${keys.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`,
            values
        )
        const contactId = result.rows?.[0]?.id ?? null

        if (contactId) {
            for (const patientId of patientIds) {
                await linkContactToPatient(connection, { domain, contactId, patientId })
            }
        }

        return NextResponse.json({ success: true, id: contactId }, { status: 201 })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to create contact' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
