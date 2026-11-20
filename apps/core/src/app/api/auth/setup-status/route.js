import { NextResponse } from 'next/server'
import { resolveDeploymentRuntime } from '@/lib/deploymentRuntime'
import { isPreviewBypassEnabled, resolvePreviewBypassDomain } from '@/lib/adminBypassTokens'

export async function GET() {
  try {
    const isLocalhost = process.env.NODE_ENV === 'development'
    const isProduction = process.env.NODE_ENV === 'production'
    const isVercel = !!process.env.VERCEL
    const vercelEnv = process.env.VERCEL_ENV || null
    // Report the effective state: the bypass needs the opt-in flag *and* a scoped
    // domain, so the client must not mint a token the server will reject.
    const previewAdminBypassEnabled = isPreviewBypassEnabled()
    const previewAdminDomain = resolvePreviewBypassDomain()
    const previewAdminUsername = process.env.ADMIN_PREVIEW_USERNAME || 'vercel-preview'
    
    const hasUsername = !!process.env.ADMIN_USERNAME
    const hasPassword = !!process.env.ADMIN_PASSWORD
    const configured = hasUsername && hasPassword

    return NextResponse.json({
      configured,
      isLocalhost,
      isProduction,
      isVercel,
      vercelEnv,
      previewAdminBypassEnabled,
      previewAdminDomain,
      previewAdminUsername,
      runtime: resolveDeploymentRuntime(),
    })
  } catch (error) {
    console.error('Setup status check error:', error)
    return NextResponse.json(
      { error: 'Failed to check setup status' },
      { status: 500 }
    )
  }
}
