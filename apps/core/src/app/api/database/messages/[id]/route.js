import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { verifyAdminToken } from '@/lib/auth'
import { ensureContactEnquiryReviewColumns, markContactEnquiryReviewed } from '@/lib/contactEnquiryReview'

const DEFAULT_OUTBOUND_TABLE = 'outbound_messages'
const DEFAULT_INBOUND_TABLE = 'inbound_messages'

function normalizeDomainKey(value) {
  return String(value || '').trim().toLowerCase()
}

function isSafeSqlIdentifier(value) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ''))
}

function resolveOutboundTableName() {
  const table = String(process.env.EMAIL_QUEUE_TABLE || DEFAULT_OUTBOUND_TABLE).trim()
  if (!isSafeSqlIdentifier(table)) {
    throw new Error('EMAIL_QUEUE_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
  }
  return table
}

function resolveInboundTableName() {
  const table = String(
    process.env.INBOUND_EMAIL_TABLE ||
    process.env.INBOUND_MESSAGES_TABLE ||
    DEFAULT_INBOUND_TABLE
  ).trim()
  if (!isSafeSqlIdentifier(table)) {
    throw new Error('INBOUND_EMAIL_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
  }
  return table
}

function parseMaybeJson(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value !== 'string') return null

  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function toIsoString(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function normalizeOutboundRow(row) {
  const payload = parseMaybeJson(row?.payload_json)
  const payloadDomain = normalizeDomainKey(payload?.domain)
  const textBody = String(row?.text_body || '').trim()
  const htmlBody = String(row?.html_body || '').trim()
  const fromEmail = String(payload?.senderEmail || payload?.sender_email || payload?.from || '').trim().toLowerCase() || null

  return {
    id: row?.id,
    direction: 'outbound',
    domain: normalizeDomainKey(row?.domain) || payloadDomain || '',
    fromEmail,
    toEmail: String(row?.to_email || '').trim().toLowerCase(),
    category: String(row?.category || '').trim().toLowerCase() || 'generic',
    status: String(row?.status || '').trim().toLowerCase() || 'queued',
    subject: String(row?.subject || payload?.subject || '').trim() || null,
    textBody: textBody || null,
    htmlBody: htmlBody || null,
    payload: payload || {},
    attempts: Number(row?.attempts || 0),
    maxAttempts: row?.max_attempts == null ? null : Number(row?.max_attempts || 0),
    provider: String(row?.provider || '').trim() || null,
    providerMessageId: String(row?.provider_message_id || '').trim() || null,
    errorMessage: String(row?.error_message || '').trim() || null,
    createdAt: toIsoString(row?.created_at),
    updatedAt: toIsoString(row?.updated_at),
    sentAt: toIsoString(row?.sent_at),
    processedAt: null,
    timestamp: toIsoString(row?.updated_at) || toIsoString(row?.created_at),
  }
}

function normalizeInboundRow(row) {
  const payload = parseMaybeJson(row?.payload_json)
  const payloadDomain = normalizeDomainKey(payload?.domain)
  const textBody = String(row?.text_body || '').trim()
  const htmlBody = String(row?.html_body || '').trim()

  return {
    id: row?.id,
    direction: 'inbound',
    domain: normalizeDomainKey(row?.domain) || payloadDomain || '',
    fromEmail: String(row?.from_email || '').trim().toLowerCase(),
    toEmail: String(row?.to_email || '').trim().toLowerCase(),
    category: String(row?.category || '').trim().toLowerCase() || 'inbound_email',
    status: String(row?.status || '').trim().toLowerCase() || 'received',
    subject: String(row?.subject || payload?.subject || '').trim() || null,
    textBody: textBody || null,
    htmlBody: htmlBody || null,
    payload: payload || {},
    attempts: Number(row?.attempts || 0),
    maxAttempts: row?.max_attempts == null ? null : Number(row?.max_attempts || 0),
    provider: String(row?.provider || 'resend').trim() || 'resend',
    providerMessageId: String(row?.provider_message_id || '').trim() || null,
    errorMessage: String(row?.error_message || '').trim() || null,
    createdAt: toIsoString(row?.created_at),
    updatedAt: toIsoString(row?.updated_at),
    sentAt: null,
    processedAt: toIsoString(row?.processed_at),
    timestamp: toIsoString(row?.created_at) || toIsoString(row?.updated_at),
  }
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

function isMissingTableError(error, dbType) {
  if (dbType === 'postgresql') return error?.code === '42P01'
  return false
}

export async function GET(request, context) {
  const dbType = detectDatabaseType()
  if (dbType !== 'postgresql') {
    return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
  }

  const params = await context?.params
  const messageId = Number.parseInt(String(params?.id || ''), 10)
  if (!Number.isFinite(messageId) || messageId <= 0) {
    return NextResponse.json({ success: false, error: 'Invalid message id' }, { status: 400 })
  }

  let connection = null
  try {
    const contextResolved = await resolveRequestContext(request)
    if (contextResolved?.error) {
      return NextResponse.json({ success: false, error: contextResolved.error }, { status: contextResolved.status || 401 })
    }

    const { searchParams } = new URL(request.url)
    const direction = String(searchParams.get('direction') || '').trim().toLowerCase()
    const domainScope = normalizeDomainKey(contextResolved?.domainScope)

    const outboundTable = resolveOutboundTableName()
    const inboundTable = resolveInboundTableName()

    connection = await getDatabaseConnection()

    let message = null

    // If explicit direction is inbound, or no direction specified:
    if (direction === 'inbound' || !direction) {
      try {
        const result = await connection.query(
          `SELECT id, status, from_email, to_email, category, domain, subject, text_body, html_body, payload_json, attempts, max_attempts, provider, provider_message_id, error_message, created_at, updated_at, processed_at
           FROM ${inboundTable}
           WHERE id = $1
           LIMIT 1`,
          [messageId]
        )
        if (result?.rows?.[0]) {
          message = normalizeInboundRow(result.rows[0])
        }
      } catch (error) {
        if (!isMissingTableError(error, dbType)) {
          throw error
        }
      }
    }

    // If explicit direction is outbound, or wasn't found in inbound:
    if (!message && (direction === 'outbound' || !direction)) {
      try {
        const result = await connection.query(
          `SELECT id, status, to_email, category, domain, subject, text_body, html_body, payload_json, attempts, max_attempts, provider, provider_message_id, error_message, created_at, updated_at, sent_at
           FROM ${outboundTable}
           WHERE id = $1
           LIMIT 1`,
          [messageId]
        )
        if (result?.rows?.[0]) {
          message = normalizeOutboundRow(result.rows[0])
        }
      } catch (error) {
        if (!isMissingTableError(error, dbType)) {
          throw error
        }
      }
    }

    if (!message) {
      return NextResponse.json({ success: false, error: 'Message not found' }, { status: 404 })
    }

    if (domainScope && normalizeDomainKey(message?.domain) !== domainScope) {
      return NextResponse.json({ success: false, error: 'Message not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, message })
  } catch (error) {
    return NextResponse.json({ success: false, error: error?.message || 'Failed to load message' }, { status: 500 })
  } finally {
    if (connection?.end) {
      await connection.end().catch(() => { })
    }
  }
}

/**
 * Record that a person has opened a website enquiry, which is what takes it off the
 * practice-wide Tasks queue (see `contactEnquiryReview.js`). Only the queue row's
 * review marker changes; the email record itself is untouched.
 */
export async function POST(request, context) {
  const dbType = detectDatabaseType()
  if (dbType !== 'postgresql') {
    return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
  }

  const params = await context?.params
  const messageId = Number.parseInt(String(params?.id || ''), 10)
  if (!Number.isFinite(messageId) || messageId <= 0) {
    return NextResponse.json({ success: false, error: 'Invalid message id' }, { status: 400 })
  }

  let connection = null
  try {
    const contextResolved = await resolveRequestContext(request)
    if (contextResolved?.error) {
      return NextResponse.json({ success: false, error: contextResolved.error }, { status: contextResolved.status || 401 })
    }

    const body = await request.json().catch(() => ({}))
    if (body?.action !== 'mark-reviewed') {
      return NextResponse.json({ success: false, error: 'Unsupported action' }, { status: 400 })
    }

    const table = resolveOutboundTableName()
    connection = await getDatabaseConnection()
    await ensureContactEnquiryReviewColumns(connection, table)

    const reviewed = await markContactEnquiryReviewed(connection, {
      id: messageId,
      domain: normalizeDomainKey(contextResolved?.domainScope),
      reviewedBy: String(contextResolved?.user?.username || contextResolved?.user?.email || '').trim() || null,
      table,
    })

    return NextResponse.json({ success: true, reviewed })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to mark the enquiry reviewed' },
      { status: 500 }
    )
  } finally {
    if (connection?.end) {
      await connection.end().catch(() => { })
    }
  }
}
