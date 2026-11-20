import { NextResponse } from 'next/server'

// Simple pass-through proxy; extend for auth/rewrites if needed
export function proxy(request) {
  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
}
