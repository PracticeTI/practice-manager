import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import {
    parseResendInboundPayload,
    insertInboundMessage,
    resolveInboundMessagesTableName
} from '@/lib/inboundMessages'
import { notifyEquipmentQuoteReplies } from '@/lib/adminNotifications'
import { resolveDomainSourcing, SOURCING_RESPONSE_CATEGORIES } from '@/lib/equipmentSourcing'

function resolveRequestOrigin(request) {
    try {
        return new URL(request.url).origin
    } catch {
        return ''
    }
}

function verifyWebhookAuth(request) {
    const secret = process.env.RESEND_WEBHOOK_SECRET || process.env.INBOUND_WEBHOOK_SECRET || process.env.CORE_BACKEND_SECRET
    if (!secret) {
        // No secret configured, allow open ingestion
        return true
    }

    // Check Bearer token
    const authHeader = request.headers.get('authorization') || ''
    if (authHeader.startsWith('Bearer ')) {
        const token = authHeader.replace('Bearer ', '').trim()
        if (token === secret) return true
    }

    // Check x-resend-signature or svix signature headers if present
    const signature = request.headers.get('resend-signature') || request.headers.get('svix-signature') || request.headers.get('x-webhook-secret')
    if (signature && signature === secret) {
        return true
    }

    // Check URL query parameter ?secret=...
    const url = new URL(request.url)
    const querySecret = url.searchParams.get('secret')
    if (querySecret && querySecret === secret) {
        return true
    }

    return false
}

export async function POST(request) {
    if (!verifyWebhookAuth(request)) {
        return NextResponse.json({ success: false, error: 'Unauthorized webhook request' }, { status: 401 })
    }

    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql' && dbType !== 'mysql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    let connection = null
    try {
        const body = await request.json().catch(() => null)
        if (!body) {
            return NextResponse.json({ success: false, error: 'Invalid or empty JSON body' }, { status: 400 })
        }

        // Handle batch or single
        const payloadItems = Array.isArray(body) ? body : [body]
        const results = []

        connection = await getDatabaseConnection()
        const table = resolveInboundMessagesTableName()

        for (const item of payloadItems) {
            // If it's a test event or ping from webhook dashboard
            if (item?.type === 'ping' || item?.event === 'ping') {
                results.push({ ping: 'pong', status: 'acknowledged' })
                continue
            }

            const parsedMessage = parseResendInboundPayload(item)
            const inserted = await insertInboundMessage(connection, dbType, parsedMessage, table)

            // A supplier answering a quote request moves that equipment item on
            // to `quote_received`. Never let this break email ingestion.
            if (parsedMessage.domain && SOURCING_RESPONSE_CATEGORIES.has(parsedMessage.category)) {
                let sourcingItems = []
                try {
                    const sourcing = await resolveDomainSourcing(connection, parsedMessage.domain, { persist: true })
                    sourcingItems = sourcing?.items || []
                } catch (error) {
                    console.warn('Failed to reconcile equipment sourcing status:', error?.message || error)
                }

                // The admin alert rides on the same match, and must not break
                // ingestion either.
                try {
                    await notifyEquipmentQuoteReplies({
                        connection,
                        domain: parsedMessage.domain,
                        sourcingItems,
                        inboundMessageId: inserted?.id ?? null,
                        origin: resolveRequestOrigin(request),
                    })
                } catch (error) {
                    console.warn('Failed to alert admins about a supplier quote reply:', error?.message || error)
                }
            }

            results.push({
                id: inserted?.id,
                from: parsedMessage.fromEmail,
                to: parsedMessage.toEmail,
                domain: parsedMessage.domain,
                category: parsedMessage.category,
                status: 'received'
            })
        }

        return NextResponse.json({
            success: true,
            count: results.length,
            data: results.length === 1 ? results[0] : results
        })
    } catch (error) {
        console.error('Error handling Resend inbound webhook:', error)
        return NextResponse.json(
            { success: false, error: error?.message || 'Failed to process inbound message' },
            { status: 500 }
        )
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        } else if (connection?.close) {
            await connection.close().catch(() => { })
        }
    }
}

export async function GET() {
    return NextResponse.json({
        success: true,
        service: 'Resend Inbound Webhook Receiver',
        status: 'active',
        timestamp: new Date().toISOString()
    })
}

export async function OPTIONS() {
    return NextResponse.json({ ok: true })
}
