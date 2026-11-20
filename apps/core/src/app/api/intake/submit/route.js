import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { ensureFormsTable } from '@/lib/formsTable'
import { clientIp, consumeRateLimit } from '@/lib/rateLimits'
import {
    extractIntakeContact,
    intakeFormsForMode,
    validateIntakeSubmission,
} from '@/lib/nativeIntake'
import {
    readIntakeSettings,
    readNativeIntakeForm,
    resolvePublicIntakeDomain,
    saveNativeIntakeSubmission,
    sendIntakeNotification,
} from '@/lib/nativeIntakeStore'

function jsonError(message, status = 400) {
    return NextResponse.json({ success: false, error: message }, { status })
}

/**
 * POST /api/intake/submit
 *
 * Stores a native intake submission. Answers are validated against the form the
 * domain currently publishes, so a stale tab cannot post questions that no
 * longer exist.
 */
export async function POST(request) {
    if (detectDatabaseType() !== 'postgresql') {
        return jsonError('Relational database required')
    }

    let connection = null
    try {
        const payload = await request.json().catch(() => ({}))
        const domain = resolvePublicIntakeDomain(request, payload?.domain)

        const settings = await readIntakeSettings(domain)
        if (!intakeFormsForMode(settings.mode).includes('native')) {
            return jsonError('The native intake form is not enabled for this practice', 403)
        }

        const definition = await readNativeIntakeForm(domain)
        const { errors, answers, form } = validateIntakeSubmission(definition, payload)
        if (errors.length > 0) {
            return jsonError(errors[0], 400)
        }

        if (payload?.consent === false) {
            return jsonError('Please agree to the consent statement to continue', 400)
        }

        await ensureFormsTable()
        connection = await getDatabaseConnection()

        const limited = await consumeRateLimit(connection, {
            bucketKey: `intake:${domain}:${clientIp(request)}`,
            limit: 6,
            windowSeconds: 3600,
        })
        if (!limited.allowed) {
            return jsonError('Too many submissions. Please call the practice instead.', 429)
        }

        const contact = extractIntakeContact(form, answers)
        const submission = await saveNativeIntakeSubmission(connection, {
            domain,
            definition: form,
            answers,
            contact,
            meta: {
                ip: clientIp(request),
                userAgent: String(request.headers.get('user-agent') || '').slice(0, 300),
                formTitle: form.title,
                consent: true,
            },
        })

        await sendIntakeNotification(connection, {
            domain,
            settings,
            submission,
            patientName: contact.name,
        })

        return NextResponse.json({
            success: true,
            data: {
                reference: submission.reference,
                submitted_at: submission.submittedAt,
                thank_you: settings.thankYouText,
                filled_fields: submission.filledFields.length,
            },
        }, { status: 201 })
    } catch (error) {
        return jsonError(error?.message || 'Failed to submit the intake form', 500)
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
    }
}
