import { NextResponse } from 'next/server'
import { verifyAdminToken } from '@/lib/auth'
import { getDomainSetting } from '@/lib/appSettings'
import { resolveFormAlertReplyTo, resolveFormAlertSender } from '@/lib/formAlertSender'
import { getDomainDisplayLabel } from '@/lib/assistantConfig'
import { enqueueOutboundEmail } from '@/lib/serviceClient'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { ensureOutboundMessageQueueTable } from '@/lib/outboundMessageQueue'
import { normalizeRecentEmailRows } from '@/lib/recentEmailRows'

const DEFAULT_EMAIL_QUEUE_TABLE = 'outbound_messages'

function getAdminTokenFromRequest(request, payload = null) {
    const authHeader = request.headers.get('authorization') || ''
    const fromHeader = authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : ''

    if (fromHeader) return fromHeader
    if (typeof payload?.adminToken === 'string') return payload.adminToken.trim()
    return ''
}

function normalizeEmail(value) {
    const normalized = String(value || '').trim().toLowerCase()
    if (!normalized) return ''
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : ''
}

function normalizeDomainValue(value) {
    const normalized = String(value || '').trim().toLowerCase()
    if (!normalized) return null
    return normalized.slice(0, 100)
}

function normalizeTestMessage(value) {
    const text = String(value || '').trim()
    if (!text) return 'This is a test message queued from Domain Settings.'
    return text.slice(0, 4000)
}

function formatUpstreamFailure(result, fallbackMessage) {
    const status = Number.isFinite(Number(result?.status)) ? Number(result.status) : null
    const error = String(result?.error || '').trim()

    let message = fallbackMessage
    if (status) message += ` (upstream status ${status}`
    if (status && error) message += `: ${error})`
    else if (status) message += ')'
    else if (error) message += ` (${error})`

    return {
        message,
        status,
        error: error || null
    }
}

function isSafeSqlIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ''))
}

function resolveQueueTableName() {
    const table = String(process.env.EMAIL_QUEUE_TABLE || DEFAULT_EMAIL_QUEUE_TABLE).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error('EMAIL_QUEUE_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
    }
    return table
}

async function loadRecentEmailsForDomain(domainKey, recipient) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return []
    }

    const table = resolveQueueTableName()
    let connection = null

    try {
        connection = await getDatabaseConnection()

        const result = await connection.query(
            `
                SELECT id, status, to_email, category, domain, subject, payload_json, created_at
                FROM ${table}
                ORDER BY created_at DESC
                LIMIT 30
            `
        )
        return normalizeRecentEmailRows(result?.rows || [], domainKey, recipient)
    } catch {
        // Treat missing table/connection failures as no recent emails for dashboard display.
        return []
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        } else if (connection?.close) {
            await connection.close().catch(() => { })
        }
    }
}

async function insertLocalQueueMessage(message) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return {
            success: false,
            error: `Local queue fallback requires postgresql (detected: ${dbType || 'none'})`
        }
    }

    const table = resolveQueueTableName()
    let connection = null

    try {
        connection = await getDatabaseConnection()
        await ensureOutboundMessageQueueTable(connection, table)
        const domain = normalizeDomainValue(message?.payload?.domain)

        const result = await connection.query(
            `
                INSERT INTO ${table} (
                    status,
                    to_email,
                    category,
                    domain,
                    subject,
                    text_body,
                    html_body,
                    payload_json,
                    attempts,
                    max_attempts,
                    created_at,
                    updated_at
                ) VALUES (
                    'queued',
                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    $6,
                    $7,
                    0,
                    NULL,
                    NOW(),
                    NOW()
                )
                RETURNING id
            `,
            [
                message.toEmail,
                message.category,
                domain,
                message.subject || null,
                message.text || null,
                message.html || null,
                JSON.stringify(message.payload || {})
            ]
        )

        return {
            success: true,
            id: result?.rows?.[0]?.id || null,
            table,
            dbType,
            localFallback: true
        }
    } catch (error) {
        return {
            success: false,
            error: error?.message || 'Local queue insert failed'
        }
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        } else if (connection?.close) {
            await connection.close().catch(() => { })
        }
    }
}

async function getDomainRecipient(domainKey) {
    const domain = (await getDomainSetting(domainKey, 'management')) || {}
    const deliveryConfig = domain?.contactEmailDelivery || {}
    const enabled = deliveryConfig.enabled !== false
    const recipient = normalizeEmail(deliveryConfig?.recipient || domain?.emailContact)

    return {
        domainKey,
        enabled,
        recipient,
        hasRecipient: Boolean(recipient),
        displayName: getDomainDisplayLabel(domainKey, domain?.displayName)
    }
}

export async function GET(request) {
    try {
        const adminToken = getAdminTokenFromRequest(request)
        const adminUser = await verifyAdminToken(adminToken)
        if (!adminUser) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(request.url)
        const domainKey = String(url.searchParams.get('domainKey') || '').trim().toLowerCase()
        if (!domainKey) {
            return NextResponse.json({ error: 'domainKey is required' }, { status: 400 })
        }

        const scopedDomain = normalizeDomainValue(adminUser?.domain)
        const effectiveDomainKey = adminUser?.role !== 'superadmin' && scopedDomain
            ? scopedDomain
            : domainKey

        const recipientInfo = await getDomainRecipient(effectiveDomainKey)
        const recentEmails = await loadRecentEmailsForDomain(effectiveDomainKey, recipientInfo.recipient)
        if (!recipientInfo.enabled) {
            return NextResponse.json({
                success: true,
                configured: false,
                domainKey: effectiveDomainKey,
                recipient: recipientInfo.recipient || '',
                recentEmails,
                queue: {
                    reachable: false,
                    authorized: false,
                    message: 'Contact email delivery is disabled.'
                }
            })
        }

        if (!recipientInfo.hasRecipient) {
            return NextResponse.json({
                success: true,
                configured: false,
                domainKey: effectiveDomainKey,
                recipient: '',
                recentEmails,
                queue: {
                    reachable: false,
                    authorized: false,
                    message: 'Email Contact is not set.'
                }
            })
        }

        const probe = await enqueueOutboundEmail({
            dryRun: true,
            toEmail: recipientInfo.recipient,
            category: 'contact_form'
        })

        return NextResponse.json({
            success: true,
            configured: true,
            domainKey: effectiveDomainKey,
            recipient: recipientInfo.recipient,
            recentEmails,
            queue: {
                reachable: Boolean(probe?.success),
                authorized: Boolean(probe?.success),
                message: probe?.success
                    ? 'Queue endpoint reachable and authenticated.'
                    : formatUpstreamFailure(
                        probe,
                        'Could not reach queue endpoint or authorization failed. Check DOMAIN_BACKEND_URL and CORE_BACKEND_SECRET.'
                    ).message
            }
        })
    } catch (error) {
        return NextResponse.json(
            { error: error?.message || 'Failed to fetch email delivery status' },
            { status: 500 }
        )
    }
}

export async function POST(request) {
    try {
        const payload = await request.json().catch(() => ({}))
        const adminToken = getAdminTokenFromRequest(request, payload)
        const adminUser = await verifyAdminToken(adminToken)
        if (!adminUser) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const domainKey = String(payload?.domainKey || '').trim().toLowerCase()
        if (!domainKey) {
            return NextResponse.json({ error: 'domainKey is required' }, { status: 400 })
        }

        const scopedDomain = normalizeDomainValue(adminUser?.domain)
        const effectiveDomainKey = adminUser?.role !== 'superadmin' && scopedDomain
            ? scopedDomain
            : domainKey

        const recipientInfo = await getDomainRecipient(effectiveDomainKey)
        if (!recipientInfo.enabled) {
            return NextResponse.json({ error: 'Contact email delivery is disabled' }, { status: 400 })
        }

        if (!recipientInfo.hasRecipient) {
            return NextResponse.json({ error: 'Contact email recipient is not configured' }, { status: 400 })
        }

        const nowIso = new Date().toISOString()
        const testMessage = normalizeTestMessage(payload?.testMessage)
        // Mirrors a real submission: the simulated submitter is the recipient,
        // so Reply-To routes back to them exactly as a live form alert would.
        const testSubmitter = {
            name: 'Admin Test Submission',
            email: recipientInfo.recipient,
        }
        const outboundMessage = {
            toEmail: recipientInfo.recipient,
            category: 'contact_form',
            payload: {
                submitted_at: nowIso,
                name: testSubmitter.name,
                email: testSubmitter.email,
                subject: `[Test] Contact email routing (${domainKey})`,
                message: `${testMessage}\n\nQueued for domain ${domainKey} at ${nowIso}.`,
                source: 'one-admin-domain-settings-test',
                domain: effectiveDomainKey,
                senderEmail: resolveFormAlertSender(effectiveDomainKey, recipientInfo.displayName) || undefined,
                replyToEmail: resolveFormAlertReplyTo(testSubmitter.name, testSubmitter.email) || undefined,
            }
        }

        const result = await enqueueOutboundEmail(outboundMessage)

        if (!result?.success) {
            const localResult = await insertLocalQueueMessage(outboundMessage)
            if (localResult?.success) {
                const upstreamFailure = formatUpstreamFailure(result, 'Primary queue endpoint unavailable, used local queue fallback')
                return NextResponse.json({
                    success: true,
                    queued: true,
                    queuedViaFallback: true,
                    domainKey: effectiveDomainKey,
                    recipient: recipientInfo.recipient,
                    queueId: localResult?.id || null,
                    queueTable: localResult?.table || null,
                    queueDatabaseType: localResult?.dbType || null,
                    warning: upstreamFailure.message
                })
            }

            const upstreamFailure = formatUpstreamFailure(result, 'Failed to queue test email in domain backend')
            return NextResponse.json({
                error: upstreamFailure.message,
                upstreamStatus: upstreamFailure.status,
                upstreamError: upstreamFailure.error,
                fallbackError: localResult?.error || null
            }, { status: 502 })
        }

        return NextResponse.json({
            success: true,
            queued: true,
            domainKey: effectiveDomainKey,
            recipient: recipientInfo.recipient,
            queueId: result?.id || null
        })
    } catch (error) {
        return NextResponse.json(
            { error: error?.message || 'Failed to queue test email' },
            { status: 500 }
        )
    }
}
