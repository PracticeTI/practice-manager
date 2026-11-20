import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import {
    deleteContactPatientLinks,
    ensureContactsTable,
    replaceContactPatients,
} from '@/lib/contactsTable'
import { patientsTableExists, patientsBelongToDomain } from '@/lib/patientsTable'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import {
    buildContactSelect,
    isEmptyContact,
    normalizeContactRow,
    resolveContactFields,
    validateId,
} from '@/lib/contacts'

async function loadContactById(connection, id, domain, { includePatient = false } = {}) {
    const result = await connection.query(
        `${buildContactSelect({ includePatient })} WHERE c.id = $1 AND c.domain = $2 LIMIT 1`,
        [id, domain]
    )
    return normalizeContactRow(result.rows?.[0] || null)
}

async function resolveId(params) {
    const resolved = await params
    return validateId(resolved?.id)
}

export async function GET(request, { params }) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    const id = await resolveId(params)
    if (!id) {
        return NextResponse.json({ success: false, error: 'Invalid contact id' }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const context = await resolveAdminDomainScope(request, searchParams.get('domain'))
    if (context?.error) {
        return NextResponse.json({ success: false, error: context.error }, { status: context.status })
    }
    const domain = context.domain

    let connection = null
    try {
        await ensureContactsTable()
        connection = await getDomainBoundConnection(domain)

        const includePatient = await patientsTableExists(connection)
        const record = await loadContactById(connection, id, domain, { includePatient })
        if (!record) {
            return NextResponse.json({ success: false, error: 'Contact not found' }, { status: 404 })
        }
        return NextResponse.json({ success: true, contact: record })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load contact' }, { status: 500 })
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

    const id = await resolveId(params)
    if (!id) {
        return NextResponse.json({ success: false, error: 'Invalid contact id' }, { status: 400 })
    }

    let connection = null
    try {
        const payload = await request.json().catch(() => ({}))
        const { searchParams } = new URL(request.url)
        const context = await resolveAdminDomainScope(request, searchParams.get('domain') || payload?.domain)
        if (context?.error) {
            return NextResponse.json({ success: false, error: context.error }, { status: context.status })
        }
        const domain = context.domain

        const { updates, errors } = resolveContactFields(payload || {})
        if (errors.length > 0) {
            return NextResponse.json({ success: false, error: errors[0] }, { status: 400 })
        }
        if (updates.length === 0) {
            return NextResponse.json({ success: false, error: 'No updatable fields provided' }, { status: 400 })
        }

        // `patient_ids` describes the join table, not a column, so it is applied
        // separately from the contact's own fields.
        const patientLink = updates.find((update) => update.key === 'patient_ids')
        const columnUpdates = updates.filter((update) => update.key !== 'patient_ids')

        await ensureContactsTable()
        connection = await getDomainBoundConnection(domain)

        // Pre-existing check so a missing contact is reported as 404, not a no-op.
        const existing = await loadContactById(connection, id, domain)
        if (!existing) {
            return NextResponse.json({ success: false, error: 'Contact not found' }, { status: 404 })
        }

        // A patch that clears every identifier would leave an unnameable row, so
        // validate the merged result rather than the payload alone.
        const merged = { ...existing, ...Object.fromEntries(columnUpdates.map((update) => [update.key, update.value])) }
        if (isEmptyContact(merged)) {
            return NextResponse.json({ success: false, error: 'A contact needs a name or an email address' }, { status: 400 })
        }

        if (patientLink && !(await patientsBelongToDomain(connection, patientLink.value, domain))) {
            return NextResponse.json({ success: false, error: 'The selected patient was not found' }, { status: 400 })
        }

        if (columnUpdates.length > 0) {
            const values = columnUpdates.map((update) => (
                update.value && typeof update.value === 'object' ? JSON.stringify(update.value) : update.value
            ))
            const setClauses = columnUpdates.map((update, index) => `${update.key} = $${index + 1}`)

            await connection.query(
                `UPDATE contacts SET ${setClauses.join(', ')}, updated_at = NOW()
                 WHERE id = $${values.length + 1} AND domain = $${values.length + 2}`,
                [...values, id, domain]
            )
        } else if (patientLink) {
            // Only the links changed, but the row was still edited.
            await connection.query(
                'UPDATE contacts SET updated_at = NOW() WHERE id = $1 AND domain = $2',
                [id, domain]
            )
        }

        if (patientLink) {
            await replaceContactPatients(connection, { domain, contactId: id, patientIds: patientLink.value })
        }

        const includePatient = await patientsTableExists(connection)
        const updated = await loadContactById(connection, id, domain, { includePatient })
        return NextResponse.json({ success: true, contact: updated })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to update contact' }, { status: 500 })
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

    const id = await resolveId(params)
    if (!id) {
        return NextResponse.json({ success: false, error: 'Invalid contact id' }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const context = await resolveAdminDomainScope(request, searchParams.get('domain'))
    if (context?.error) {
        return NextResponse.json({ success: false, error: context.error }, { status: context.status })
    }
    const domain = context.domain

    let connection = null
    try {
        await ensureContactsTable()
        connection = await getDomainBoundConnection(domain)

        const existing = await loadContactById(connection, id, domain)
        if (!existing) {
            return NextResponse.json({ success: false, error: 'Contact not found' }, { status: 404 })
        }

        await connection.query('DELETE FROM contacts WHERE id = $1 AND domain = $2', [id, domain])
        await deleteContactPatientLinks(connection, { domain, contactId: id })

        return NextResponse.json({ success: true })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to delete contact' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
