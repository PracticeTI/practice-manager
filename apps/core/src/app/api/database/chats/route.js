import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { getDomainBoundConnection, getSuperAdminConnection } from '@/lib/domainScopedConnection'
import { verifyAdminToken } from '@/lib/auth'
import { buildChatPresentation } from '@/lib/chatPresentation'

function parseLimit(rawValue, defaultValue = 200, maxValue = 500) {
  const parsed = Number.parseInt(String(rawValue || ''), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue
  return Math.min(parsed, maxValue)
}

function parseMaybeJson(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'object') return value
  if (typeof value !== 'string') return null

  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function normalizeDomainKey(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizeSearchValue(value) {
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

function normalizeChatRow(row) {
  const metadata = parseMaybeJson(row?.metadata)
  const messages = parseMaybeJson(row?.messages)
  const normalizedMessages = Array.isArray(messages) ? messages : []
  const normalizedMetadata = metadata && typeof metadata === 'object' ? metadata : {}
  const presentation = buildChatPresentation({
    role: row?.role,
    metadata: normalizedMetadata,
    messages: normalizedMessages,
  })

  return {
    id: row?.id,
    domain: String(row?.domain || '').trim(),
    role: String(row?.role || 'Contact').trim() || 'Contact',
    sessionId: String(row?.session_id || '').trim() || null,
    status: String(row?.status || 'completed').trim() || 'completed',
    from: presentation.from,
    title: presentation.title,
    summary: presentation.summary,
    preview: presentation.preview,
    messageCount: normalizedMessages.length,
    metadata: normalizedMetadata,
    createdAt: row?.created_at || null,
    updatedAt: row?.updated_at || null,
    timestamp: row?.updated_at || row?.created_at || null,
  }
}

function chatMatchesSearch(chat, searchValue) {
  if (!searchValue) return true

  const haystack = [
    chat?.title,
    chat?.role,
    chat?.status,
    chat?.sessionId,
    chat?.preview,
    chat?.domain,
    chat?.metadata?.email,
    chat?.metadata?.contactEmail,
  ]
    .map((value) => String(value || '').toLowerCase())
    .join(' ')

  return haystack.includes(searchValue)
}

function isMissingChatsTableError(error, dbType) {
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
    const roleFilter = String(searchParams.get('role') || '').trim()
    const statusFilter = String(searchParams.get('status') || '').trim()
    const searchValue = normalizeSearchValue(searchParams.get('search'))
    const domainScope = normalizeDomainKey(context?.domainScope)
    const crossTenant = !domainScope && context?.user?.role === 'superadmin'

    connection = crossTenant
      ? await getSuperAdminConnection()
      : await getDomainBoundConnection(domainScope)

    let rows = []

    try {
      const whereClauses = []
      const params = []

      if (domainScope) {
        params.push(domainScope)
        whereClauses.push(`LOWER(COALESCE(domain, '')) = $${params.length}`)
      }

      if (roleFilter) {
        params.push(roleFilter)
        whereClauses.push(`role = $${params.length}`)
      }

      if (statusFilter) {
        params.push(statusFilter)
        whereClauses.push(`status = $${params.length}`)
      }

      params.push(limit)
      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

      const result = await connection.query(
        `SELECT id, domain, role, session_id, messages, metadata, status, created_at, updated_at
         FROM chats
         ${whereSql}
         ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
         LIMIT $${params.length}`,
        params
      )
      rows = result.rows || []
    } catch (error) {
      if (isMissingChatsTableError(error, dbType)) {
        return NextResponse.json({
          success: true,
          data: [],
          filters: { roles: [], statuses: [] },
          domain: domainScope || null,
        })
      }
      throw error
    }

    const normalizedChats = rows.map(normalizeChatRow)
    const filteredChats = normalizedChats.filter((chat) => chatMatchesSearch(chat, searchValue))
    const roles = Array.from(new Set(normalizedChats.map((chat) => chat.role).filter(Boolean)))
    const statuses = Array.from(new Set(normalizedChats.map((chat) => chat.status).filter(Boolean)))

    return NextResponse.json({
      success: true,
      data: filteredChats,
      filters: {
        roles,
        statuses,
      },
      domain: domainScope || null,
    })
  } catch (error) {
    return NextResponse.json({ success: false, error: error?.message || 'Failed to load chats' }, { status: 500 })
  } finally {
    if (connection?.end) {
      await connection.end().catch(() => { })
    }
  }
}