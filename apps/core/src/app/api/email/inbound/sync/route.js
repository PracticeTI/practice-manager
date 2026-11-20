import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { verifyAdminToken } from '@/lib/auth'
import {
    parseResendInboundPayload,
    insertInboundMessage,
    resolveInboundMessagesTableName
} from '@/lib/inboundMessages'

function normalizeDomainKey(value) {
    return String(value || '').trim().toLowerCase()
}

async function resolveRequestContext(request) {
    const auth = request.headers.get('Authorization') || ''
    if (!auth.startsWith('Bearer ')) {
        return { error: 'Missing Authorization header', status: 401 }
    }

    const token = auth.replace('Bearer ', '').trim()
    if (!token) {
        return { error: 'Missing auth token', status: 401 }
    }

    const adminUser = await verifyAdminToken(token)
    if (!adminUser) {
        return { error: 'Invalid auth token', status: 401 }
    }

    const requestedDomain = normalizeDomainKey(new URL(request.url).searchParams.get('domain'))
    const scopedDomain = normalizeDomainKey(adminUser.domain)

    if (adminUser.role !== 'superadmin' && scopedDomain) {
        return { user: adminUser, domainScope: scopedDomain }
    }

    return { user: adminUser, domainScope: requestedDomain }
}

async function fetchResendInboundList(apiKey) {
    const endpoints = [
        'https://api.resend.com/emails/receiving',
        'https://api.resend.com/emails'
    ]

    for (const endpoint of endpoints) {
        try {
            const res = await fetch(endpoint, {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            })
            if (res.ok) {
                const data = await res.json()
                const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : [])
                if (list.length > 0) {
                    return list
                }
            }
        } catch (err) {
            console.warn(`[resend-sync] Fetch failed for ${endpoint}:`, err.message)
        }
    }
    return []
}

async function fetchResendEmailDetail(apiKey, emailId) {
    if (!emailId) return null
    const endpoints = [
        `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`,
        `https://api.resend.com/emails/${encodeURIComponent(emailId)}`
    ]

    for (const url of endpoints) {
        try {
            const res = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            })
            if (res.ok) {
                const data = await res.json()
                if (data && (data.id || data.email_id || data.subject || data.text || data.html)) {
                    return data
                }
            }
        } catch {
            // continue fallback
        }
    }
    return null
}

export async function POST(request) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    const context = await resolveRequestContext(request)
    if (context?.error) {
        return NextResponse.json({ success: false, error: context.error }, { status: context.status || 401 })
    }

    const apiKey = process.env.EMAIL_RESEND_API_KEY || process.env.RESEND_API_KEY
    if (!apiKey) {
        return NextResponse.json({
            success: false,
            error: 'EMAIL_RESEND_API_KEY is not configured in environment variables'
        }, { status: 400 })
    }

    let connection = null
    try {
        const rawEmails = await fetchResendInboundList(apiKey)
        if (!rawEmails || rawEmails.length === 0) {
            return NextResponse.json({
                success: true,
                syncedCount: 0,
                message: 'No emails returned from Resend receiving API'
            })
        }

        connection = await getDatabaseConnection()
        const table = resolveInboundMessagesTableName()
        let importedCount = 0

        for (const item of rawEmails) {
            const emailId = item?.id || item?.email_id
            let fullItem = item
            if (emailId && (!item.text && !item.text_body && !item.html && !item.html_body)) {
                const detail = await fetchResendEmailDetail(apiKey, emailId)
                if (detail) {
                    fullItem = { ...item, ...detail }
                }
            }

            const parsed = parseResendInboundPayload(fullItem)
            const result = await insertInboundMessage(connection, dbType, parsed, table)
            if (result?.id) {
                importedCount += 1
            }
        }

        return NextResponse.json({
            success: true,
            totalFound: rawEmails.length,
            importedCount,
            message: `Synced ${importedCount} new email(s) from Resend`
        })
    } catch (error) {
        console.error('[resend-sync] Error syncing inbox:', error)
        return NextResponse.json({
            success: false,
            error: error?.message || 'Failed to sync emails from Resend'
        }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
