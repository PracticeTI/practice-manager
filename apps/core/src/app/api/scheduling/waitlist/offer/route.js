import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { ensureSchedulingTables } from '@/lib/schedulingTables'
import { readDomainPracticeName } from '@/lib/domainPracticeName'
import { verifyWaitlistActionToken } from '@/lib/appointmentMessaging'
import { resolveSchedulingSecret } from '@/lib/appointmentReminders'
import { isScheduleConflictError } from '@/lib/schedulingConstraint'

const ACTIONS = {
    accept: {
        title: 'Accept this appointment',
        submit: 'Accept this slot',
        success: 'Your appointment is booked. The practice will be in touch.',
    },
    decline: {
        title: 'Decline this offer',
        submit: 'No thanks',
        success: 'Thanks for letting us know. You remain on the waitlist.',
    },
}

function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function renderPage({ title, message, practiceName = 'Practice', form = '', status = 200 }) {
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; padding: 24px; background: #f8fafc; color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .card { max-width: 560px; margin: 48px auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 28px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06); }
    .brand { margin: 0 0 20px; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #64748b; }
    h1 { margin: 0 0 12px; font-size: 24px; }
    p { line-height: 1.55; }
    dl { display: grid; grid-template-columns: 120px 1fr; gap: 6px 12px; margin: 20px 0; font-size: 14px; }
    dt { color: #64748b; }
    dd { margin: 0; font-weight: 600; }
    button { margin-top: 8px; border: 0; border-radius: 8px; background: #0f172a; color: #fff; padding: 12px 18px; font-size: 15px; font-weight: 600; cursor: pointer; }
  </style>
</head>
<body>
  <main class="card">
    <p class="brand">${escapeHtml(practiceName)}</p>
    <h1>${escapeHtml(title)}</h1>
    <p>${message}</p>
    ${form}
  </main>
</body>
</html>`

    return new NextResponse(html, {
        status,
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Robots-Tag': 'noindex',
            'X-Content-Type-Options': 'nosniff',
        },
    })
}

async function readParams(request) {
    const url = new URL(request.url)
    if (request.method !== 'POST') {
        return {
            domain: url.searchParams.get('domain') || '',
            offerId: url.searchParams.get('offer_id') || '',
            action: url.searchParams.get('action') || '',
            token: url.searchParams.get('token') || '',
        }
    }

    const contentType = String(request.headers.get('content-type') || '').toLowerCase()
    if (contentType.includes('application/json')) {
        const body = await request.json().catch(() => ({}))
        return {
            domain: String(body?.domain || ''),
            offerId: String(body?.offer_id || ''),
            action: String(body?.action || ''),
            token: String(body?.token || ''),
        }
    }

    const form = await request.formData().catch(() => null)
    return {
        domain: String(form?.get('domain') || ''),
        offerId: String(form?.get('offer_id') || ''),
        action: String(form?.get('action') || ''),
        token: String(form?.get('token') || ''),
    }
}

function slotDetails(offer) {
    const metadata = offer?.metadata || {}
    const timezone = metadata.timezone || 'Australia/Sydney'
    const start = new Date(offer?.starts_at)
    const label = Number.isNaN(start.getTime())
        ? ''
        : new Intl.DateTimeFormat('en-AU', {
            timeZone: timezone,
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).format(start)

    return [
        ['When', label],
        ['Service', metadata.service],
        ['Practitioner', metadata.practitioner],
        ['Location', metadata.location],
    ].filter(([, value]) => value)
}

async function loadOffer(connection, domain, offerId) {
    const result = await connection.query(
        `SELECT o.*, w.patient_id AS waitlist_patient_id, w.patient_name AS waitlist_patient_name,
                w.status AS waitlist_status
         FROM waitlist_offers o
         JOIN waitlist_entries w ON w.id = o.waitlist_entry_id AND w.domain = o.domain
         WHERE o.id = $1 AND o.domain = $2
         LIMIT 1`,
        [offerId, domain]
    )
    return result.rows?.[0] || null
}

async function handle(request) {
    if (detectDatabaseType() !== 'postgresql') {
        return renderPage({ title: 'Unavailable', message: 'This service is temporarily unavailable.', status: 503 })
    }

    const params = await readParams(request)
    const domain = String(params.domain || '').trim().toLowerCase()
    const offerId = Number.parseInt(params.offerId, 10)
    const action = String(params.action || '').trim().toLowerCase()

    if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(domain) || !Number.isFinite(offerId) || !ACTIONS[action]) {
        return renderPage({
            title: 'Invalid link',
            message: 'This link is incomplete or malformed. Please contact the practice.',
            status: 400,
        })
    }

    const secret = resolveSchedulingSecret()
    if (!secret) {
        return renderPage({ title: 'Unavailable', message: 'This service is not configured yet.', status: 503 })
    }
    if (!verifyWaitlistActionToken({
        token: params.token,
        domain,
        offerId,
        action,
        secret,
    })) {
        return renderPage({
            title: 'Link expired',
            message: 'This link is invalid or has expired. Please contact the practice.',
            status: 401,
        })
    }

    let connection = null
    try {
        await ensureSchedulingTables()
        connection = await getDomainBoundConnection(domain)
        const offer = await loadOffer(connection, domain, offerId)
        if (!offer) {
            return renderPage({
                title: 'Offer not found',
                message: 'This offer no longer exists. Please contact the practice.',
                status: 404,
            })
        }

        const practiceName = await readDomainPracticeName(domain).catch(() => 'Practice')
        const details = slotDetails(offer)

        if (request.method !== 'POST') {
            if (!['offered', 'sent'].includes(offer.status)) {
                return renderPage({
                    title: 'Offer already handled',
                    message: `This offer is ${escapeHtml(offer.status)}. Please contact the practice if you need help.`,
                    practiceName,
                    status: 409,
                })
            }
            if (new Date(offer.expires_at) <= new Date()) {
                await connection.query(
                    "UPDATE waitlist_offers SET status = 'expired', updated_at = NOW() WHERE id = $1",
                    [offer.id]
                )
                return renderPage({
                    title: 'Offer expired',
                    message: 'This offer has expired. Please contact the practice to check for other openings.',
                    practiceName,
                    status: 410,
                })
            }

            const form = `<dl>${details.map(([label, value]) => (
                `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`
            )).join('')}</dl>
            <form method="post" action="/api/scheduling/waitlist/offer">
              <input type="hidden" name="domain" value="${escapeHtml(domain)}">
              <input type="hidden" name="offer_id" value="${offerId}">
              <input type="hidden" name="action" value="${escapeHtml(action)}">
              <input type="hidden" name="token" value="${escapeHtml(params.token)}">
              <button type="submit">${escapeHtml(ACTIONS[action].submit)}</button>
            </form>`

            return renderPage({
                title: ACTIONS[action].title,
                message: 'Please review the details below. This offer expires two hours after it was sent.',
                practiceName,
                form,
            })
        }

        if (!['offered', 'sent'].includes(offer.status)) {
            return renderPage({
                title: 'Offer already handled',
                message: `This offer is ${escapeHtml(offer.status)}.`,
                practiceName,
                status: 409,
            })
        }
        if (new Date(offer.expires_at) <= new Date()) {
            await connection.query(
                "UPDATE waitlist_offers SET status = 'expired', updated_at = NOW() WHERE id = $1",
                [offer.id]
            )
            return renderPage({
                title: 'Offer expired',
                message: 'This offer has expired.',
                practiceName,
                status: 410,
            })
        }

        if (action === 'decline') {
            await connection.query(
                `UPDATE waitlist_offers
                 SET status = 'declined', responded_at = NOW(), updated_at = NOW()
                 WHERE id = $1`,
                [offer.id]
            )
            if (offer.waitlist_status === 'offered') {
                await connection.query(
                    "UPDATE waitlist_entries SET status = 'waiting', updated_at = NOW() WHERE id = $1",
                    [offer.waitlist_entry_id]
                )
            }
            return renderPage({
                title: 'Offer declined',
                message: ACTIONS.decline.success,
                practiceName,
            })
        }

        const conflict = await connection.query(
            `SELECT id FROM appointments
             WHERE domain = $1
               AND practitioner_id = $2
               AND starts_at < $4
               AND ends_at > $3
               AND appointment_status IN ('tentative', 'confirmed', 'arrived')
               AND COALESCE(unavailable_block, FALSE) = FALSE
               AND COALESCE(archived, FALSE) = FALSE
             LIMIT 1`,
            [domain, offer.practitioner_id, offer.starts_at, offer.ends_at]
        )
        if (conflict.rows?.length) {
            await connection.query(
                "UPDATE waitlist_offers SET status = 'expired', updated_at = NOW() WHERE id = $1",
                [offer.id]
            )
            return renderPage({
                title: 'Slot no longer available',
                message: 'Another booking took this slot. Please contact the practice to check for other openings.',
                practiceName,
                status: 409,
            })
        }

        const metadata = offer.metadata || {}
        let inserted = null
        try {
            inserted = await connection.query(
                `INSERT INTO appointments
                    (domain, patient_id, patient_name, practitioner_id, location_id, service_id,
                     practitioner, service, location, starts_at, ends_at, appointment_status,
                     booking_source, timezone, confirmation_status, confirmed_at, patient_status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                         'confirmed', 'waitlist', $12, 'confirmed', NOW(), 'Booked')
                 RETURNING id`,
                [
                    domain,
                    offer.waitlist_patient_id,
                    offer.waitlist_patient_name,
                    offer.practitioner_id,
                    offer.location_id,
                    offer.service_id,
                    metadata.practitioner || null,
                    metadata.service || null,
                    metadata.location || null,
                    offer.starts_at,
                    offer.ends_at,
                    metadata.timezone || 'Australia/Sydney',
                ]
            )
        } catch (error) {
            if (!isScheduleConflictError(error)) throw error
            await connection.query(
                "UPDATE waitlist_offers SET status = 'expired', updated_at = NOW() WHERE id = $1",
                [offer.id]
            )
            return renderPage({
                title: 'Slot no longer available',
                message: 'Another booking took this slot. Please contact the practice.',
                practiceName,
                status: 409,
            })
        }

        await connection.query(
            `UPDATE waitlist_offers
             SET status = 'accepted', responded_at = NOW(), updated_at = NOW()
             WHERE id = $1`,
            [offer.id]
        )
        await connection.query(
            `UPDATE waitlist_entries
             SET status = 'booked', updated_at = NOW()
             WHERE id = $1 AND domain = $2`,
            [offer.waitlist_entry_id, domain]
        )
        await connection.query(
            `UPDATE waitlist_offers
             SET status = 'expired', updated_at = NOW()
             WHERE domain = $1
               AND id <> $2
               AND status IN ('offered', 'sent')
               AND starts_at = $3
               AND ends_at = $4
               AND practitioner_id IS NOT DISTINCT FROM $5`,
            [domain, offer.id, offer.starts_at, offer.ends_at, offer.practitioner_id]
        )

        return renderPage({
            title: 'Appointment booked',
            message: `Your appointment is confirmed${inserted?.rows?.[0]?.id ? ` (reference #${inserted.rows[0].id})` : ''}. ${ACTIONS.accept.success}`,
            practiceName,
        })
    } catch (error) {
        return renderPage({
            title: 'Something went wrong',
            message: 'We could not process this offer. Please contact the practice.',
            status: 500,
        })
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
    }
}

export async function GET(request) {
    return handle(request)
}

export async function POST(request) {
    return handle(request)
}
