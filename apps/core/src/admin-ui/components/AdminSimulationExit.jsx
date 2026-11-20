'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { clearAdminSession, getCurrentUser, getOrCreateAdminTokenForLocalhost, persistAdminSession } from '@/lib/clientAdminAuth'

const SUPERADMIN_TOKEN_BACKUP_STORAGE_KEY = 'admin_superadmin_token_backup_v1'
const SUPERADMIN_USERNAME_BACKUP_STORAGE_KEY = 'admin_superadmin_username_backup_v1'

/**
 * Faint exit control for simulated-admin sessions, rendered in the page's bottom line.
 *
 * A simulated session hides the admin nav bar (see `AdminBanner`), so this is the only
 * way back to the superadmin session. Renders nothing outside a simulated session.
 */
export default function AdminSimulationExit() {
  const router = useRouter()
  const pathname = usePathname()
  const [isMounted, setIsMounted] = useState(false)
  const [isSimulatedAdmin, setIsSimulatedAdmin] = useState(() => getCurrentUser()?.simulated === true)
  const [exiting, setExiting] = useState(false)

  // This lives in the root layout, which survives client-side navigation, so re-read the
  // session on every route change: starting or leaving a simulation always navigates.
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setIsMounted(true)
      setIsSimulatedAdmin(getCurrentUser()?.simulated === true)
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [pathname])

  const exitSimulation = async () => {
    if (typeof window === 'undefined' || exiting) return

    setExiting(true)
    try {
      const backedUpToken = window.localStorage.getItem(SUPERADMIN_TOKEN_BACKUP_STORAGE_KEY)
      const backedUpUsername = window.localStorage.getItem(SUPERADMIN_USERNAME_BACKUP_STORAGE_KEY)

      if (backedUpToken) {
        persistAdminSession(backedUpToken, backedUpUsername)
      } else {
        clearAdminSession()
        const restoredToken = await getOrCreateAdminTokenForLocalhost()
        if (!restoredToken) {
          setIsSimulatedAdmin(false)
          router.push('/login')
          return
        }
      }

      window.localStorage.removeItem(SUPERADMIN_TOKEN_BACKUP_STORAGE_KEY)
      window.localStorage.removeItem(SUPERADMIN_USERNAME_BACKUP_STORAGE_KEY)
      setIsSimulatedAdmin(false)
      router.push('/admin/settings')
    } catch {
      window.alert('Failed to restore superadmin session')
    } finally {
      setExiting(false)
    }
  }

  if (!isMounted || !isSimulatedAdmin) {
    return null
  }

  return (
    // The admin layout paints an opaque fixed background at z-0, which otherwise covers
    // in-flow page content; the wrapper keeps the icon above it (modals use z-50+).
    <div className="relative z-10 mt-2 flex items-center justify-center gap-2">
      {/* A simulated session is the only non-superadmin principal allowed to read RLS posture. */}
      <Link
        href="/admin/settings/rls"
        title="Row-level security posture of the primary database"
        className="text-[11px] lowercase text-gray-400 underline transition-colors hover:text-gray-600"
      >
        rls
      </Link>
      <button
        type="button"
        onClick={exitSimulation}
        disabled={exiting}
        title="Exit simulated admin and return to your superadmin session"
        aria-label="Exit simulated admin"
        className="rounded-full p-1.5 text-gray-400 transition-colors hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
        </svg>
      </button>
    </div>
  )
}
