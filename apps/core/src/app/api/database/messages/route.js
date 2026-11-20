import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { verifyAdminToken } from '@/lib/auth'

const DEFAULT_OUTBOUND_TABLE = 'outbound_messages'
const DEFAULT_INBOUND_TABLE = 'inbound_messages'

function parseLimit(rawValue, defaultValue = 200, maxValue = 500) {
  const parsed = Number.parseInt(String(rawValue || ''), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue
  return Math.min(parsed, maxValue)
}

function normalizeDomainKey(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizeSearchValue(value) {
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

function toPreview(text, max = 180) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}...`
}

function normalizeOutboundRow(row) {
  const payload = parseMaybeJson(row?.payload_json)
  const payloadDomain = normalizeDomainKey(payload?.domain)
  const subject = String(row?.subject || payload?.subject || '').trim()
  const textBody = String(row?.text_body || payload?.message || '').trim()
  const fromEmail = String(payload?.senderEmail || payload?.sender_email || payload?.from || '').trim().toLowerCase() || null

  return {
    id: row?.id,
    direction: 'outbound',
    domain: normalizeDomainKey(row?.domain) || payloadDomain || '',
    fromEmail,
    toEmail: String(row?.to_email || '').trim().toLowerCase(),
    category: String(row?.category || '').trim().toLowerCase() || 'generic',
    status: String(row?.status || '').trim().toLowerCase() || 'queued',
    subject: subject || null,
    preview: toPreview(textBody),
    attempts: Number(row?.attempts || 0),
    maxAttempts: row?.max_attempts == null ? null : Number(row?.max_attempts || 0),
    provider: String(row?.provider || '').trim() || null,
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
  const subject = String(row?.subject || payload?.subject || '').trim()
  const textBody = String(row?.text_body || payload?.text || payload?.body || '').trim()

  return {
    id: row?.id,
    direction: 'inbound',
    domain: normalizeDomainKey(row?.domain) || payloadDomain || '',
    fromEmail: String(row?.from_email || '').trim().toLowerCase(),
    toEmail: String(row?.to_email || '').trim().toLowerCase(),
    category: String(row?.category || '').trim().toLowerCase() || 'inbound_email',
    status: String(row?.status || '').trim().toLowerCase() || 'received',
    subject: subject || null,
    preview: toPreview(textBody),
    attempts: Number(row?.attempts || 0),
    maxAttempts: row?.max_attempts == null ? null : Number(row?.max_attempts || 0),
    provider: String(row?.provider || 'resend').trim() || 'resend',
    errorMessage: String(row?.error_message || '').trim() || null,
    createdAt: toIsoString(row?.created_at),
    updatedAt: toIsoString(row?.updated_at),
    sentAt: null,
    processedAt: toIsoString(row?.processed_at),
    timestamp: toIsoString(row?.created_at) || toIsoString(row?.updated_at),
  }
}

function messageMatchesSearch(message, searchValue) {
  if (!searchValue) return true

  const haystack = [
    message?.direction,
    message?.fromEmail,
    message?.toEmail,
    message?.category,
    message?.status,
    message?.subject,
    message?.preview,
    message?.provider,
    message?.errorMessage,
    message?.domain,
  ].map((value) => String(value || '').toLowerCase()).join(' ')

  return haystack.includes(searchValue)
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

export async function GET(request) {
  const dbType = detectDatabaseType()
  if (dbType !== 'postgresql') {
    return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
  }

  let connection = null
  try {
    const context = await resolveRequestContext(request)
    if (context?.error) {
      return NextResponse.json({ success: false, error: context.error }, { status: context.status || 401 })
    }

    const { searchParams } = new URL(request.url)
    const limit = parseLimit(searchParams.get('limit'))
    const directionFilter = String(searchParams.get('direction') || 'all').trim().toLowerCase()
    const statusFilter = String(searchParams.get('status') || '').trim().toLowerCase()
    const categoryFilter = String(searchParams.get('category') || '').trim().toLowerCase()
    const searchValue = normalizeSearchValue(searchParams.get('search'))
    const domainScope = normalizeDomainKey(context?.domainScope)

    const outboundTable = resolveOutboundTableName()
    const inboundTable = resolveInboundTableName()

    connection = await getDatabaseConnection()

    let outboundRows = []
    let inboundRows = []

    // Query outbound messages if requested
    if (directionFilter === 'all' || directionFilter === 'outbound') {
      try {
        const result = await connection.query(
          `SELECT id, status, to_email, category, domain, subject, text_body, payload_json, attempts, max_attempts, provider, error_message, created_at, updated_at, sent_at
           FROM ${outboundTable}
           ORDER BY created_at DESC
           LIMIT $1`,
          [limit]
        )
        outboundRows = result.rows || []
      } catch (error) {
        if (!isMissingTableError(error, dbType)) {
          throw error
        }
      }
    }

    // Query inbound messages if requested
    if (directionFilter === 'all' || directionFilter === 'inbound') {
      try {
        const result = await connection.query(
          `SELECT id, status, from_email, to_email, category, domain, subject, text_body, payload_json, attempts, max_attempts, provider, provider_message_id, error_message, created_at, updated_at, processed_at
           FROM ${inboundTable}
           ORDER BY created_at DESC
           LIMIT $1`,
          [limit]
        )
        inboundRows = result.rows || []
      } catch (error) {
        if (!isMissingTableError(error, dbType)) {
          throw error
        }
      }
    }

    const normalizedOutbound = outboundRows.map(normalizeOutboundRow)
    const normalizedInbound = inboundRows.map(normalizeInboundRow)

    const allCombined = [...normalizedInbound, ...normalizedOutbound].sort((a, b) => {
      const aTime = new Date(a.timestamp || 0).getTime()
      const bTime = new Date(b.timestamp || 0).getTime()
      return bTime - aTime
    })

    const filteredMessages = allCombined
      .filter((message) => {
        if (domainScope && normalizeDomainKey(message?.domain) !== domainScope) return false
        if (directionFilter !== 'all' && message.direction !== directionFilter) return false
        if (statusFilter && statusFilter !== 'all' && message.status !== statusFilter) return false
        if (categoryFilter && categoryFilter !== 'all' && message.category !== categoryFilter) return false
        return true
      })
      .filter((message) => messageMatchesSearch(message, searchValue))

    const statuses = Array.from(new Set(allCombined.map((message) => message.status).filter(Boolean)))
    const categories = Array.from(new Set(allCombined.map((message) => message.category).filter(Boolean)))

    const inboundCount = allCombined.filter((m) => m.direction === 'inbound' && (!domainScope || normalizeDomainKey(m.domain) === domainScope)).length
    const outboundCount = allCombined.filter((m) => m.direction === 'outbound' && (!domainScope || normalizeDomainKey(m.domain) === domainScope)).length

    return NextResponse.json({
      success: true,
      data: filteredMessages,
      counts: {
        total: allCombined.length,
        inbound: inboundCount,
        outbound: outboundCount,
      },
      filters: {
        directions: ['all', 'inbound', 'outbound'],
        statuses,
        categories,
      },
      domain: domainScope || null,
    })
  } catch (error) {
    return NextResponse.json({ success: false, error: error?.message || 'Failed to load messages' }, { status: 500 })
  } finally {
    if (connection?.end) {
      await connection.end().catch(() => { })
    }
  }
}
