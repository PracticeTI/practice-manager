'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { getAdminSetupStatus, getCurrentUser, getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'
import { getDomainLabel } from '@/lib/domainMode'
import { getAdminDomainSourceLabel, getEffectiveAdminDomainModeFromStorage } from '@/lib/adminActiveDomain'
const DEFAULT_DOMAIN_CONTEXT = { label: 'Practice', source: 'default' }
const BUILD_ENVIRONMENT_FALLBACK = process.env.NODE_ENV === 'development' ? 'dev' : 'prod'
const SHORT_COMMIT_LENGTH = 7

/**
 * Build/runtime facts a superadmin gets in the centre of the banner.
 *
 * Version/commit/ref are inlined at build time by next.config.js from whichever
 * provider built the bundle, so they are identical on Vercel, Cloud Run and a local
 * build. Environment, service and revision are runtime facts and arrive from the setup
 * status snapshot instead.
 */
function buildSuperAdminInfo() {
  const commit = String(process.env.NEXT_PUBLIC_BUILD_COMMIT || '').trim()

  return {
    version: process.env.NEXT_PUBLIC_APP_VERSION || 'dev',
    commit: commit ? commit.slice(0, SHORT_COMMIT_LENGTH) : '',
    ref: String(process.env.NEXT_PUBLIC_BUILD_REF || '').trim(),
    buildId: String(process.env.NEXT_PUBLIC_BUILD_ID || '').trim(),
    buildTime: process.env.NEXT_PUBLIC_BUILD_TIME || null,
    environment: BUILD_ENVIRONMENT_FALLBACK,
    service: '',
    revision: '',
  }
}

function SuperAdminInfo({ info }) {
  const builtAt = info.buildTime ? new Date(info.buildTime).toLocaleString() : null

  return (
    <span className="block text-center font-mono text-[11px] font-normal leading-4">
      <span className="block text-gray-800">
        v{info.version}
        {info.commit && (
          <>
            <span className="text-gray-400"> · </span>
            {info.commit}
          </>
        )}
        <span className="text-gray-400"> · </span>
        {info.environment}
        {builtAt && (
          <>
            <span className="text-gray-400"> · </span>
            built {builtAt}
          </>
        )}
        {(info.revision || info.ref || info.buildId) && (
          <>
            <span className="text-gray-400"> · </span>
            {info.revision && <span className="whitespace-nowrap text-gray-500">rev {info.revision}</span>}
            {info.revision && info.ref && <span className="text-gray-400"> · </span>}
            {info.ref && <span className="whitespace-nowrap text-gray-500">ref {info.ref}</span>}
            {(info.revision || info.ref) && info.buildId && <span className="text-gray-400"> · </span>}
            {info.buildId && <span className="whitespace-nowrap text-gray-500">build {info.buildId}</span>}
          </>
        )}
      </span>
      {/* The runtime service keeps its own line so a long hostname cannot push the
          deployment identity apart when the line wraps. */}
      {info.service && <span className="block text-gray-500">{info.service}</span>}
    </span>
  )
}

export default function AdminBanner() {
  const [isMounted, setIsMounted] = useState(false)
  const [domainContext, setDomainContext] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_DOMAIN_CONTEXT

    try {
      const { mode, source } = getEffectiveAdminDomainModeFromStorage()
      return { label: getDomainLabel(mode), source: getAdminDomainSourceLabel(source) }
    } catch {
      return DEFAULT_DOMAIN_CONTEXT
    }
  })
  const [isDomainScopedAdmin, setIsDomainScopedAdmin] = useState(() => {
    const currentUser = getCurrentUser()
    return Boolean(currentUser && currentUser.role !== 'superadmin' && currentUser.domain)
  })
  const [isSuperAdmin, setIsSuperAdmin] = useState(() => getCurrentUser()?.role === 'superadmin')
  const [superAdminInfo, setSuperAdminInfo] = useState(null)
  const [isSimulatedAdmin, setIsSimulatedAdmin] = useState(() => getCurrentUser()?.simulated === true)
  const [homePageBlockEditorEnabled, setHomePageBlockEditorEnabled] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setIsMounted(true)
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [])

  const handleDefaultDomainClick = (event) => {
    if (pathname !== '/admin/settings') return

    event.preventDefault()
    window.dispatchEvent(new CustomEvent('domain:open-default-domain-modal'))
  }

  useEffect(() => {
    let cancelled = false

    async function bootstrapBanner() {
      try {
        const { mode, source } = getEffectiveAdminDomainModeFromStorage()
        if (cancelled) return

        setDomainContext({ label: getDomainLabel(mode), source: getAdminDomainSourceLabel(source) })

        const currentUser = getCurrentUser()
        const isSuperAdminUser = currentUser?.role === 'superadmin'
        setIsSuperAdmin(isSuperAdminUser)
        setIsDomainScopedAdmin(Boolean(currentUser && currentUser.role !== 'superadmin' && currentUser.domain))
        setIsSimulatedAdmin(currentUser?.simulated === true)

        if (isSuperAdminUser) {
          const info = buildSuperAdminInfo()
          if (!cancelled) setSuperAdminInfo(info)

          const setupStatus = await getAdminSetupStatus()
          const runtime = setupStatus?.runtime

          if (!cancelled && runtime) {
            setSuperAdminInfo({
              ...info,
              environment: runtime.environment || info.environment,
              service: String(runtime.service || '').trim(),
              revision: String(runtime.revision || '').trim(),
            })
          }
        }

        const token = await getOrCreateAdminTokenForLocalhost()
        if (cancelled || !token) return

        const response = await fetch(`/api/settings/domains/quick-actions?domainKey=${encodeURIComponent(mode)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })

        if (!response.ok) {
          setHomePageBlockEditorEnabled(false)
          return
        }

        const data = await response.json().catch(() => ({}))
        if (!cancelled) {
          setHomePageBlockEditorEnabled(data?.homePageBlockEditorEnabled === true)
        }
      } catch {
        if (!cancelled) {
          setDomainContext(DEFAULT_DOMAIN_CONTEXT)
          setIsSuperAdmin(false)
          setIsDomainScopedAdmin(false)
          setIsSimulatedAdmin(false)
          setSuperAdminInfo(null)
          setHomePageBlockEditorEnabled(false)
        }
      }
    }

    bootstrapBanner()

    return () => {
      cancelled = true
    }
  }, [])

  if (!isMounted) {
    return null
  }

  // Simulated admins get a clean page without the admin nav bar. The way back to the
  // superadmin session is the exit control in the page footer (AdminSimulationExit).
  if (isSimulatedAdmin) {
    return null
  }

  return (
    <div className="block w-full bg-purple-50 border-b border-purple-200 text-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-1.5 md:py-3 lg:py-1.5">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 md:grid md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <div className="flex items-center gap-4">
            {!isDomainScopedAdmin ? (
              <Link
                href="/admin/settings?defaultDomain=1"
                onClick={handleDefaultDomainClick}
                className="text-gray-600 no-underline hover:no-underline hover:text-gray-800 transition-colors"
                title="Open default domain settings"
                aria-label="Open default domain settings"
              >
                <span>{domainContext.label} mode</span>
                <span className="text-gray-500"> · {domainContext.source}</span>
              </Link>
            ) : (
              <span className="text-gray-600">
                <span>{domainContext.label} mode</span>
                <span className="text-gray-500"> · {domainContext.source}</span>
              </span>
            )}
          </div>

          {/* Deployment identity for a superadmin, centred between the mode label
              and the nav links. Full width on narrow screens, where it wraps onto
              its own row rather than squeezing the nav. */}
          {superAdminInfo && (
            <div className="order-3 flex w-full justify-center md:order-none md:w-auto">
              <SuperAdminInfo info={superAdminInfo} />
            </div>
          )}

          <div className="flex items-center justify-end gap-4 md:col-start-3">
            <Link href="/admin" className="text-gray-600 hover:text-gray-800">
              Admin
            </Link>
            {homePageBlockEditorEnabled && (
              <Link href="/admin/homepage" className="text-gray-600 hover:text-gray-800">
                Homepage
              </Link>
            )}
            {!isDomainScopedAdmin && (
              <Link href="/settings" className="text-gray-600 hover:text-gray-800">
                Settings
              </Link>
            )}
            {isSuperAdmin && (
              <Link href="/domains" className="text-gray-600 hover:text-gray-800">
                Domains
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
