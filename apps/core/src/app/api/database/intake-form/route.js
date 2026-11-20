import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { QUESTION_TYPES, validateNativeIntakeForm } from '@/lib/nativeIntake'
import {
    readNativeIntakeForm,
    resetNativeIntakeForm,
    saveNativeIntakeForm,
} from '@/lib/nativeIntakeStore'

function jsonError(message, status = 400) {
    return NextResponse.json({ success: false, error: message }, { status })
}

/** GET /api/database/intake-form — the published native definition plus the supported types. */
export async function GET(request) {
    if (detectDatabaseType() !== 'postgresql') {
        return jsonError('Relational database required')
    }

    try {
        const { searchParams } = new URL(request.url)
        const context = await resolveAdminDomainScope(request, searchParams.get('domain'))
        if (context?.error) return jsonError(context.error, context.status)

        const definition = await readNativeIntakeForm(context.domain)
        return NextResponse.json({ success: true, data: definition, questionTypes: QUESTION_TYPES })
    } catch (error) {
        return jsonError(error?.message || 'Failed to load the intake form', 500)
    }
}

/** PUT /api/database/intake-form — publish an edited definition. */
export async function PUT(request) {
    if (detectDatabaseType() !== 'postgresql') {
        return jsonError('Relational database required')
    }

    try {
        const payload = await request.json().catch(() => ({}))
        const context = await resolveAdminDomainScope(request, payload?.domain)
        if (context?.error) return jsonError(context.error, context.status)

        const { errors, form } = validateNativeIntakeForm(payload?.definition || payload)
        if (errors.length > 0) return jsonError(errors[0], 400)

        const saved = await saveNativeIntakeForm(context.domain, form)
        return NextResponse.json({ success: true, data: saved })
    } catch (error) {
        return jsonError(error?.message || 'Failed to save the intake form', 500)
    }
}

/** DELETE /api/database/intake-form — drop edits and go back to the shipped default. */
export async function DELETE(request) {
    if (detectDatabaseType() !== 'postgresql') {
        return jsonError('Relational database required')
    }

    try {
        const { searchParams } = new URL(request.url)
        const context = await resolveAdminDomainScope(request, searchParams.get('domain'))
        if (context?.error) return jsonError(context.error, context.status)

        const definition = await resetNativeIntakeForm(context.domain)
        return NextResponse.json({ success: true, data: definition })
    } catch (error) {
        return jsonError(error?.message || 'Failed to reset the intake form', 500)
    }
}
