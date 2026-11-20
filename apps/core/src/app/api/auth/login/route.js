import { NextResponse } from 'next/server'
import { SignJWT } from 'jose'
import { findAdminUserByUsername, verifyPassword } from '@/lib/adminUsers.js'

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-secret-key-change-in-production'
)

async function issueToken(claims) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(JWT_SECRET)
}

function setCookieOnResponse(response) {
  const isSecure = process.env.NODE_ENV === 'production'
  response.cookies.set('admin_presence_v1', '1', {
    path: '/',
    maxAge: 60 * 60 * 24,
    sameSite: 'lax',
    secure: isSecure,
    httpOnly: false,
  })
}

export async function POST(request) {
  try {
    const { username, password } = await request.json()

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required' }, { status: 400 })
    }

    // 1. Check superadmin env-var credentials first
    const adminUsername = process.env.ADMIN_USERNAME
    const adminPassword = process.env.ADMIN_PASSWORD

    if (adminUsername && adminPassword && username === adminUsername && password === adminPassword) {
      const token = await issueToken({ username, role: 'superadmin' })
      const response = NextResponse.json({ token })
      setCookieOnResponse(response)
      return response
    }

    // 2. Fall through to DB-managed admin users
    let dbUser = null
    try {
      dbUser = await findAdminUserByUsername(username)
    } catch {
      // DB may not be configured; treated as no match
    }

    if (dbUser && (await verifyPassword(password, dbUser.password_hash))) {
      const claims = { username: dbUser.username, role: dbUser.role }
      if (dbUser.domain) claims.domain = dbUser.domain
      const token = await issueToken(claims)
      const response = NextResponse.json({ token })
      setCookieOnResponse(response)
      return response
    }

    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json({ error: 'Login failed' }, { status: 500 })
  }
}
