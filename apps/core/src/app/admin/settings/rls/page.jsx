'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import RlsCheckPanel from '@/admin-ui/components/RlsCheckPanel'
import { getCurrentUser, resolveAdminAuthToken } from '@/lib/clientAdminAuth'
import { canReadRlsDiagnostics } from '@/lib/rlsPanelAccess'

/**
 * Read-only RLS posture for the primary database.
 *
 * Kept out of the Settings page because that surface is superadmin-only and a
 * domain-scoped admin is redirected away from it. A simulated admin session can
 * open this page to confirm what its own session can see; a real admin login is
 * sent back to the dashboard, and the API refuses it too.
 */
export default function RlsCheckPage() {
  const router = useRouter()
  const [permitted, setPermitted] = useState(false)

  useEffect(() => {
    document.title = 'RLS Check'
  }, [])

  useEffect(() => {
    let cancelled = false

    async function resolveAccess() {
      // Other admin pages mint the localhost/preview session token on mount; a direct
      // visit must do the same before it can read the stored session.
      await resolveAdminAuthToken()
      if (cancelled) return

      const user = getCurrentUser()
      if (!canReadRlsDiagnostics(user, { superAdmin: user?.role === 'superadmin' })) {
        router.replace('/admin')
        return
      }

      setPermitted(true)
    }

    resolveAccess()

    return () => { cancelled = true }
  }, [router])

  if (!permitted) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-gray-500">
        Checking access…
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="admin-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">RLS Check</h1>
            <p className="mt-1 text-sm text-gray-600">
              Row-level security posture of the primary database. Read-only; no tenant data is shown.
            </p>
          </div>
          <Link href="/admin" className="text-sm text-gray-700 underline">
            Back to dashboard
          </Link>
        </div>

        <div className="mt-6">
          <RlsCheckPanel variant="page" />
        </div>
      </div>
    </div>
  )
}
