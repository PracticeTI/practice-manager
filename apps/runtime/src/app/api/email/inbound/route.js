import { NextResponse } from 'next/server'
import { recordInboundEmail } from '@practice-manager/jobs/enqueue'

/**
 * Provider inbound-email webhook (Resend `email.received`).
 *
 * A hosted core receives these itself; this route exists for deployments that hand the
 * provider the runtime's hostname instead. The row is what the inbound-email worker polls.
 */
export async function POST(request) {
  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ success: false, error: 'Invalid JSON payload' }, { status: 400 })
  }

  try {
    return NextResponse.json(await recordInboundEmail(body))
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to record inbound email' },
      { status: Number(error?.status) || 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({ success: true, service: 'runtime-inbound-email', status: 'active' })
}
