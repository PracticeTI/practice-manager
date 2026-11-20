import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { getSuperAdminConnection } from '@/lib/domainScopedConnection'
import { ensureSchedulingTables } from '@/lib/schedulingTables'
import { phoneMatchKey, resolvePatientContact } from '@/lib/appointmentMessaging'
import { cancelPendingReminders } from '@/lib/appointmentReminders'

function cleanText(value) {
    return String(value === undefined || value === null ? '' : value).trim()
}

function escapeXml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
}

function twiml(message = '', status = 200) {
    const body = message ? `<Message>${escapeXml(message)}</Message>` : ''
    return new NextResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`,
        {
            status,
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'Cache-Control': 'no-store',
            },
        }
    )
}

function verifyWebhookAuth(request) {
    const secret = String(
        process.env.SMS_WEBHOOK_SECRET
        || process.env.CORE_BACKEND_SECRET
        || ''
    ).trim()
    if (!secret) return true

    const authorization = request.headers.get('authorization') || ''
    if (authorization.startsWith('Bearer ')
        && authorization.slice('Bearer '.length).trim() === secret) {
        return true
    }
    if (request.headers.get('x-webhook-secret') === secret) return true

    const url = new URL(request.url)
    return url.searchParams.get('secret') === secret
}

async function readPayload(request) {
    const contentType = String(request.headers.get('content-type') || '').toLowerCase()
    if (contentType.includes('application/json')) {
        const body = await request.json().catch(() => ({}))
        return {
            from: cleanText(body?.From || body?.from),
            body: cleanText(body?.Body || body?.body || body?.message),
        }
    }

    const form = await request.formData().catch(() => null)
    return {
        from: cleanText(form?.get('From') || form?.get('from')),
        body: cleanText(form?.get('Body') || form?.get('body')),
    }
}

function classifyReply(value) {
    const text = cleanText(value).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
    if (!text) return null
    if (['C', 'CONFIRM', 'CONFIRMED', 'YES', 'Y', 'OK', '1'].includes(text)) return 'confirm'
    if (['N', 'NO', 'X', 'CANCEL', 'CANCELLED', 'DECLINE'].includes(text)) return 'decline'
    if (['R', 'RESCHEDULE', 'CHANGE', 'MOVE'].includes(text)) return 'reschedule'
    return null
}

export async function POST(request) {
    if (!verifyWebhookAuth(request)) {
        return twiml('Unauthorized', 401)
    }
    if (detectDatabaseType() !== 'postgresql') {
        return twiml('Service unavailable', 503)
    }

    const payload = await readPayload(request)
    const action = classifyReply(payload.body)
    if (!payload.from || !action) {
        // Unrecognised or empty replies are acknowledged without a response so
        // the provider does not retry them.
        return twiml('', 200)
    }

    const senderKey = phoneMatchKey(payload.from)
    if (!senderKey) return twiml('We could not match this phone number.')

    let connection = null
    try {
        await ensureSchedulingTables()
        // The sender's phone number is matched against every tenant's upcoming
        // appointments, so the read is cross-domain; the update is then keyed by
        // the matched row's own domain.
        connection = await getSuperAdminConnection()

        const result = await connection.query(
            `SELECT a.id, a.domain, a.patient_id, a.starts_at, a.confirmation_status,
                    p.metadata AS patient_metadata
             FROM appointments a
             JOIN patients p ON p.id = a.patient_id AND p.domain = a.domain
             WHERE a.starts_at > NOW()
               AND a.starts_at <= NOW() + INTERVAL '30 days'
               AND a.appointment_status IN ('tentative', 'confirmed')
               AND COALESCE(a.archived, FALSE) = FALSE
             ORDER BY a.starts_at
             LIMIT 500`
        )

        let match = null
        for (const row of result.rows || []) {
            const contact = resolvePatientContact(row.patient_metadata)
            if (contact.phone && phoneMatchKey(contact.phone) === senderKey) {
                match = row
                break
            }
        }

        if (!match) {
            return twiml('We could not find an upcoming appointment for this number. Please contact the practice.')
        }

        if (action === 'confirm') {
            await connection.query(
                `UPDATE appointments
                 SET confirmation_status = 'confirmed',
                     confirmed_at = NOW(),
                     confirmation_channel = 'sms',
                     updated_at = NOW()
                 WHERE id = $1 AND domain = $2`,
                [match.id, match.domain]
            )
            return twiml('Thanks — your appointment is confirmed.')
        }

        if (action === 'decline') {
            await connection.query(
                `UPDATE appointments
                 SET confirmation_status = 'declined',
                     appointment_status = 'cancelled',
                     cancelled_at = NOW(),
                     cancellation_reason = 'Declined by patient SMS',
                     confirmation_channel = 'sms',
                     updated_at = NOW()
                 WHERE id = $1 AND domain = $2`,
                [match.id, match.domain]
            )
            await cancelPendingReminders(connection, {
                domain: match.domain,
                appointmentId: match.id,
                reason: 'declined_by_patient',
            })
            return twiml('Your appointment has been cancelled. The practice has been notified.')
        }

        await connection.query(
            `UPDATE appointments
             SET confirmation_status = 'reschedule_requested',
                 confirmation_channel = 'sms',
                 updated_at = NOW()
             WHERE id = $1 AND domain = $2`,
            [match.id, match.domain]
        )
        await cancelPendingReminders(connection, {
            domain: match.domain,
            appointmentId: match.id,
            reason: 'reschedule_requested',
        })
        return twiml('Thanks — the practice will contact you to arrange another time.')
    } catch (error) {
        return twiml('Something went wrong. Please contact the practice.', 500)
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
    }
}
