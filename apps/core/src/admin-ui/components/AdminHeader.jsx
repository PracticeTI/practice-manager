'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { ExternalLink, LogOut, User } from 'lucide-react'
import AdminBanner from '@/admin-ui/components/AdminBanner'
import AdminNotificationBell from '@/admin-ui/components/AdminNotificationBell'
import AssistantLauncher from '@/admin-ui/components/AssistantLauncher'
import PracticeSearchBox from '@/admin-ui/components/PracticeSearchBox'
import { clearAdminSession, getCurrentUser, resolveAdminAuthToken } from '@/lib/clientAdminAuth'
import { getAdminDomainMode } from '@/lib/adminActiveDomain'
import { normalizePracticeType } from '@/lib/practiceTypes'
import { getPracticeTypeBrandImage, shouldUsePracticeTypeBranding } from '@/lib/practiceTypeBranding'
import { getAdminRoleLabel } from '@/lib/adminRoles'
import { DEFAULT_DOMAIN_MODE } from '@/lib/domainMode'
import { hasPrivateDomainTrait, getPrivateDomainBrandMark } from '@/lib/domainExtension'

const DEFAULT_BRAND_DOMAIN_KEY = DEFAULT_DOMAIN_MODE

/**
 * In-flight lookups of a domain's practice type. Every admin page mounts this
 * header, so concurrent mounts share one request instead of racing each other.
 */
const practiceTypeRequests = new Map()

async function resolveDomainPracticeType(domainKey) {
  const key = String(domainKey || '').trim().toLowerCase()
  if (!key) return ''

  const pending = practiceTypeRequests.get(key)
  if (pending) return pending

  const request = (async () => {
    try {
      const token = await resolveAdminAuthToken()
      if (!token) return ''

      const response = await fetch('/api/settings/domains', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (!response.ok) return ''

      const data = await response.json().catch(() => ({}))
      return normalizePracticeType(data?.domains?.[key]?.practiceType, key)
    } catch {
      return ''
    } finally {
      practiceTypeRequests.delete(key)
    }
  })()

  practiceTypeRequests.set(key, request)
  return request
}

export default function AdminHeader({ title, brandingDomainKey }) {
  const router = useRouter()
  const [activeDomainMode, setActiveDomainMode] = useState(DEFAULT_DOMAIN_MODE)
  const [brandLogoPath, setBrandLogoPath] = useState(null)
  const [practiceBrandImage, setPracticeBrandImage] = useState(null)
  const [currentUser, setCurrentUser] = useState(null)
  const [showAccountMenu, setShowAccountMenu] = useState(false)
  const accountMenuRef = useRef(null)
  const isCompactBrand = hasPrivateDomainTrait(
    String(brandingDomainKey || activeDomainMode || '').trim().toLowerCase(),
    'compactAdminHeader'
  )

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      try {
        setActiveDomainMode(getAdminDomainMode())
      } catch {
        setActiveDomainMode(DEFAULT_DOMAIN_MODE)
      }
      setCurrentUser(getCurrentUser())
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [])

  // The account menu is the only logout entry point, so it also closes on an
  // outside click or Escape rather than trapping the page.
  useEffect(() => {
    if (!showAccountMenu) return undefined

    const handlePointerDown = (event) => {
      if (accountMenuRef.current?.contains(event.target)) return
      setShowAccountMenu(false)
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setShowAccountMenu(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [showAccountMenu])

  useEffect(() => {
    let cancelled = false
    const canShowDomainBranding = shouldUsePracticeTypeBranding(getCurrentUser())
    const domainKey = String(brandingDomainKey || activeDomainMode || DEFAULT_BRAND_DOMAIN_KEY).trim()
    const domainBrandMark = getPrivateDomainBrandMark(domainKey)

    // The unbranded core default uses the open-source Practice Manager lockup. Defer this
    // update so the mark does not flash while the auth user resolves.
    if (!canShowDomainBranding || !domainKey || (domainKey === DEFAULT_BRAND_DOMAIN_KEY && !domainBrandMark)) {
      const brandImage = canShowDomainBranding ? getPracticeTypeBrandImage('', DEFAULT_BRAND_DOMAIN_KEY) : null
      const timeoutId = window.setTimeout(() => {
        setBrandLogoPath(null)
        setPracticeBrandImage(brandImage)
      }, 0)
      return () => {
        window.clearTimeout(timeoutId)
        cancelled = true
      }
    }

    const logoPath = `/${domainKey}/logo.png`

    async function resolveBranding() {
      const [logoAvailable, practiceType] = await Promise.all([
        (async () => {
          try {
            const response = await fetch(logoPath, {
              method: 'HEAD',
              cache: 'no-store',
            })
            return response.ok
          } catch {
            return false
          }
        })(),
        resolveDomainPracticeType(domainKey),
      ])

      if (cancelled) return

      // A practice type with its own mark owns the primary brand slot; the domain
      // logo then moves to the right as the co-brand.
      setBrandLogoPath(logoAvailable ? logoPath : null)
      setPracticeBrandImage(getPracticeTypeBrandImage(practiceType, domainKey, domainBrandMark))
    }

    resolveBranding()

    return () => {
      cancelled = true
    }
  }, [activeDomainMode, brandingDomainKey])

  const goToDashboard = () => {
    router.push('/admin')
  }

  const handleLogout = () => {
    clearAdminSession()
    router.push('/login')
  }

  const handleNavigation = (path) => {
    router.push(path)
  }

  const hasCoBrandLogo = Boolean(
    practiceBrandImage && brandLogoPath && practiceBrandImage.src !== brandLogoPath
  )

  return (
    <>
      <AdminBanner />
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 ${isCompactBrand ? 'py-1' : 'py-4'}`}>
          <div className="flex min-w-0 items-center gap-8">
            {/* A domain without a brand mark leaves this slot blank: the label used to
                flash here before the logo resolved, which read as the wrong brand. */}
            {(practiceBrandImage || brandLogoPath) && (
              <button
                onClick={goToDashboard}
                className="rounded transition-opacity hover:opacity-70 focus:outline-none focus:ring-1 focus:ring-gray-400"
                aria-label="Go to admin dashboard"
              >
                {practiceBrandImage ? (
                  <Image
                    src={practiceBrandImage.src}
                    alt={practiceBrandImage.alt}
                    width={practiceBrandImage.width}
                    height={practiceBrandImage.height}
                    className="h-10 w-auto animate-fade-in motion-reduce:animate-none"
                    style={{ width: 'auto' }}
                    priority
                  />
                ) : (
                  <Image
                    src={brandLogoPath}
                    alt={`${String(brandingDomainKey || activeDomainMode || 'Practice')} logo`}
                    width={324}
                    height={72}
                    className="h-16 w-auto animate-fade-in motion-reduce:animate-none"
                    style={{ width: 'auto' }}
                    priority
                  />
                )}
              </button>
            )}
            {title && <h2 className="text-lg font-semibold text-gray-700 hidden lg:block">{title}</h2>}
          </div>

          {/* Centred between the brand and the account controls. */}
          <div className="flex justify-center">
            <PracticeSearchBox />
          </div>

          <div className="flex items-center justify-end gap-6">
            <AdminNotificationBell />
            {/* The co-brand mark doubles as the account trigger: it opens the
                user, website and logout menu. It falls back to a plain account
                icon when the domain has no co-brand logo. */}
            <div ref={accountMenuRef} className="relative flex items-center border-l border-gray-200 pl-6">
              <button
                type="button"
                onClick={() => setShowAccountMenu((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={showAccountMenu}
                aria-label="Account menu"
                className={
                  hasCoBrandLogo
                    ? 'flex items-center rounded p-0.5 transition-opacity hover:opacity-70 focus:outline-none focus-visible:ring-1 focus-visible:ring-gray-400'
                    : 'inline-flex h-8 w-8 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus:ring-1 focus:ring-gray-400'
                }
              >
                {hasCoBrandLogo ? (
                  <Image
                    src={brandLogoPath}
                    alt={`${String(brandingDomainKey || activeDomainMode || 'Domain')} logo`}
                    width={165}
                    height={44}
                    className="h-11 w-auto object-contain animate-fade-in motion-reduce:animate-none"
                    style={{ width: 'auto' }}
                    loading="eager"
                  />
                ) : (
                  <User className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                )}
              </button>

              {showAccountMenu && (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
                >
                  <div className="border-b border-gray-100 px-3 py-2">
                    <p className="truncate text-sm font-medium text-gray-900">{currentUser?.username || 'Signed in'}</p>
                    {currentUser?.role && <p className="text-xs text-gray-500">{getAdminRoleLabel(currentUser.role)}</p>}
                  </div>
                  {currentUser && currentUser.role !== 'superadmin' && (
                    <Link
                      href="/admin/profile"
                      role="menuitem"
                      onClick={() => setShowAccountMenu(false)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      <User className="h-4 w-4 text-gray-400" aria-hidden="true" />
                      Your profile
                    </Link>
                  )}
                  <Link
                    href="/"
                    role="menuitem"
                    onClick={() => setShowAccountMenu(false)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    <ExternalLink className="h-4 w-4 text-gray-400" aria-hidden="true" />
                    View website
                  </Link>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    <LogOut className="h-4 w-4 text-gray-400" aria-hidden="true" />
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
      <AssistantLauncher />
    </>
  )
}
