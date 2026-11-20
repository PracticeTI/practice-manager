import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { ensureSchedulingTables } from '@/lib/schedulingTables'
import { readDomainPracticeName } from '@/lib/domainPracticeName'
import { verifyAppointmentActionToken } from '@/lib/appointmentMessaging'
import {
    cancelPendingReminders,
    loadAppointmentForMessaging,
    resolveSchedulingSecret,
} from '@/lib/appointmentReminders'

const ACTIONS = {
    confirm: {
        title: 'Confirm your appointment',
        submit: 'Confirm appointment',
        success: 'Your appointment is confirmed. See you then.',
    },
    decline: {
        title: 'Cancel your appointment',
        submit: 'Yes, cancel my appointment',
        success: 'Your appointment has been cancelled. The practice has been notified.',
    },
    reschedule: {
        title: 'Request another time',
        submit: 'Request another time',
        success: 'Your request has been sent. The practice will contact you to arrange another time.',
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
    :root { color-scheme: light; }
    body { margin: 0; padding: 24px; background: #f8fafc; color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .card { max-width: 560px; margin: 48px auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 28px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06); }
    .brand { margin: 0 0 20px; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #64748b; }
    h1 { margin: 0 0 12px; font-size: 24px; }
    p { line-height: 1.55; }
    dl { display: grid; grid-template-columns: 120px 1fr; gap: 6px 12px; margin: 20px 0; font-size: 14px; }
    dt { color: #64748b; }
    dd { margin: 0; font-weight: 600; }
    button { margin-top: 8px; border: 0; border-radius: 8px; background: #0f172a; color: #fff; padding: 12px 18px; font-size: 15px; font-weight: 600; cursor: pointer; }
    .warning { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 10px 12px; color: #9a3412; font-size: 14px; }
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
            appointmentId: url.searchParams.get('appointment_id') || '',
            action: url.searchParams.get('action') || '',
            token: url.searchParams.get('token') || '',
        }
    }

    const contentType = String(request.headers.get('content-type') || '').toLowerCase()
    if (contentType.includes('application/json')) {
        const body = await request.json().catch(() => ({}))
        return {
            domain: String(body?.domain || ''),
            appointmentId: String(body?.appointment_id || ''),
            action: String(body?.action || ''),
            token: String(body?.token || ''),
        }
    }

    const form = await request.formData().catch(() => null)
    return {
        domain: String(form?.get('domain') || ''),
        appointmentId: String(form?.get('appointment_id') || ''),
        action: String(form?.get('action') || ''),
        token: String(form?.get('token') || ''),
    }
}

function appointmentDetails(appointment) {
    const timezone = appointment?.timezone || 'Australia/Sydney'
    const start = new Date(appointment?.starts_at)
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
        ['Service', appointment?.service],
        ['Practitioner', appointment?.practitioner],
        ['Location', appointment?.location],
    ].filter(([, value]) => value)
}

async function handle(request) {
    if (detectDatabaseType() !== 'postgresql') {
        return renderPage({
            title: 'Unavailable',
            message: 'This confirmation service is temporarily unavailable.',
            status: 503,
        })
    }

    const params = await readParams(request)
    const domain = String(params.domain || '').trim().toLowerCase()
    const appointmentId = Number.parseInt(params.appointmentId, 10)
    const action = String(params.action || '').trim().toLowerCase()

    if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(domain) || !Number.isFinite(appointmentId) || !ACTIONS[action]) {
        return renderPage({
            title: 'Invalid link',
            message: 'This link is incomplete or malformed. Please contact the practice.',
            status: 400,
        })
    }

    const secret = resolveSchedulingSecret()
    if (!secret) {
        return renderPage({
            title: 'Unavailable',
            message: 'This confirmation service is not configured yet.',
            status: 503,
        })
    }

    if (!verifyAppointmentActionToken({
        token: params.token,
        domain,
        appointmentId,
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

        const appointment = await loadAppointmentForMessaging(connection, { domain, appointmentId })
        if (!appointment) {
            return renderPage({
                title: 'Appointment not found',
                message: 'This appointment no longer exists. Please contact the practice.',
                status: 404,
            })
        }

        const practiceName = await readDomainPracticeName(domain).catch(() => 'Practice')
        const details = appointmentDetails(appointment)

        if (request.method !== 'POST') {
            const form = `<dl>${details.map(([label, value]) => (
                `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`
            )).join('')}</dl>
            ${action === 'decline' ? '<p class="warning">This will cancel your appointment.</p>' : ''}
            <form method="post" action="/api/scheduling/confirm">
              <input type="hidden" name="domain" value="${escapeHtml(domain)}">
              <input type="hidden" name="appointment_id" value="${appointmentId}">
              <input type="hidden" name="action" value="${escapeHtml(action)}">
              <input type="hidden" name="token" value="${escapeHtml(params.token)}">
              <button type="submit">${escapeHtml(ACTIONS[action].submit)}</button>
            </form>`

            return renderPage({
                title: ACTIONS[action].title,
                message: 'Please review the details below.',
                practiceName,
                form,
            })
        }

        if (appointment.appointment_status === 'cancelled' || appointment.appointment_status === 'completed') {
            return renderPage({
                title: 'Appointment already closed',
                message: 'This appointment has already been cancelled or completed. Please contact the practice if you need help.',
                practiceName,
                status: 409,
            })
        }

        if (action === 'confirm') {
            await connection.query(
                `UPDATE appointments
                 SET confirmation_status = 'confirmed',
                     confirmed_at = NOW(),
                     confirmation_channel = 'link',
                     updated_at = NOW()
                 WHERE id = $1 AND domain = $2`,
                [appointmentId, domain]
            )
        } else if (action === 'decline') {
            await connection.query(
                `UPDATE appointments
                 SET confirmation_status = 'declined',
                     appointment_status = 'cancelled',
                     cancelled_at = NOW(),
                     cancellation_reason = 'Declined by patient',
                     confirmation_channel = 'link',
                     updated_at = NOW()
                 WHERE id = $1 AND domain = $2`,
                [appointmentId, domain]
            )
            await cancelPendingReminders(connection, {
                domain,
                appointmentId,
                reason: 'declined_by_patient',
            })
        } else {
            await connection.query(
                `UPDATE appointments
                 SET confirmation_status = 'reschedule_requested',
                     confirmation_channel = 'link',
                     updated_at = NOW()
                 WHERE id = $1 AND domain = $2`,
                [appointmentId, domain]
            )
            await cancelPendingReminders(connection, {
                domain,
                appointmentId,
                reason: 'reschedule_requested',
            })
        }

        return renderPage({
            title: action === 'confirm' ? 'Appointment confirmed' : 'Request received',
            message: ACTIONS[action].success,
            practiceName,
        })
    } catch (error) {
        return renderPage({
            title: 'Something went wrong',
            message: 'We could not update this appointment. Please contact the practice.',
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
