import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { getDomainBoundConnection, getSuperAdminConnection } from '@/lib/domainScopedConnection'
import { verifyAdminToken } from '@/lib/auth'
import { buildChatPresentation } from '@/lib/chatPresentation'

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
    metadata: normalizedMetadata,
    messages: normalizedMessages,
    messageCount: normalizedMessages.length,
    createdAt: row?.created_at || null,
    updatedAt: row?.updated_at || null,
    timestamp: row?.updated_at || row?.created_at || null,
  }
}

function isMissingChatsTableError(error, dbType) {
  if (dbType === 'postgresql') return error?.code === '42P01'
  return false
}

export async function GET(request, context) {
  const dbType = detectDatabaseType()
  if (dbType !== 'postgresql') {
    return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
  }

  const params = await context?.params
  const chatId = Number.parseInt(String(params?.id || ''), 10)
  if (!Number.isFinite(chatId) || chatId <= 0) {
    return NextResponse.json({ success: false, error: 'Invalid chat id' }, { status: 400 })
  }

  let connection = null
  try {
    const context = await resolveRequestContext(request)
    if (context?.error) {
      return NextResponse.json({ success: false, error: context.error }, { status: context.status || 401 })
    }

    const domainScope = normalizeDomainKey(context?.domainScope)
    const crossTenant = !domainScope && context?.user?.role === 'superadmin'
    connection = crossTenant
      ? await getSuperAdminConnection()
      : await getDomainBoundConnection(domainScope)

    let row = null

    try {
      const paramsList = [chatId]
      let domainSql = ''

      if (domainScope) {
        paramsList.push(domainScope)
        domainSql = ` AND LOWER(COALESCE(domain, '')) = $${paramsList.length}`
      }

      const result = await connection.query(
        `SELECT id, domain, role, session_id, messages, metadata, status, created_at, updated_at
         FROM chats
         WHERE id = $1${domainSql}
         LIMIT 1`,
        paramsList
      )

      row = result?.rows?.[0] || null
    } catch (error) {
      if (isMissingChatsTableError(error, dbType)) {
        return NextResponse.json({ success: false, error: 'Chat not found' }, { status: 404 })
      }
      throw error
    }

    if (!row) {
      return NextResponse.json({ success: false, error: 'Chat not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, chat: normalizeChatRow(row) })
  } catch (error) {
    return NextResponse.json({ success: false, error: error?.message || 'Failed to load chat' }, { status: 500 })
  } finally {
    if (connection?.end) {
      await connection.end().catch(() => { })
    }
  }
}
