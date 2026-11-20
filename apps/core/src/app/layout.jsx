import './globals.css'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getDomainLabel, resolveDomainModeFromHeaders } from '@/lib/domainMode'
import { getDomainSeoSettings, getSiteDescription, getSiteName, resolveCanonicalOrigin, resolveDomainOgImage, toAbsoluteUrl } from '@/lib/siteMetadata'
import { resolveBrandIconLinks } from '@/lib/brandingIcons'
import { isPublicSurfacePath, PUBLIC_SURFACE_PATHNAME_HEADER } from '@/lib/publicSurface'
import { resolveDomainMaintenanceMode } from '@/lib/maintenanceMode'
import { getPrivateFooterBrand, hasPrivateDomainTrait } from '@/lib/domainExtension'
import { getDomainSetting } from '@/lib/appSettings'
import { isWebsiteFeatureEnabled } from '@/lib/domainFeatureFlags'
import GlobalPageMotion from '@/components/GlobalPageMotion'
import CacheInitializer from '@/components/CacheInitializer'
import MaintenanceScreen from '@/components/MaintenanceScreen'
import AdminSimulationExit from '@/admin-ui/components/AdminSimulationExit'

/**
 * True when this request is for the public frontend AND the domain has
 * Maintenance Mode enabled. Operational surfaces (/admin, /login, /settings,
 * /domains, /presence, /og) and every non-production environment are always
 * excluded.
 */
async function isMaintenanceActiveForRequest(headerStore, mode) {
  const pathname = String(headerStore.get(PUBLIC_SURFACE_PATHNAME_HEADER) || '')
  if (!pathname || !isPublicSurfacePath(pathname)) return false
  return resolveDomainMaintenanceMode(mode)
}

/**
 * True when `/` may render the domain's public website.
 *
 * Only the root path is gated, and the check uses the original request path so it
 * also covers domain roots the middleware rewrites to a landing route. Every other
 * path (content pages, admin, API) is unaffected.
 */
async function isWebsiteVisibleAtRoot(headerStore, mode) {
  const pathname = String(headerStore.get(PUBLIC_SURFACE_PATHNAME_HEADER) || '')
  if (pathname !== '/') return true
  const settings = await getDomainSetting(mode, 'management').catch(() => null)
  return isWebsiteFeatureEnabled(settings, mode)
}

export async function generateMetadata() {
  const headerStore = await headers()
  const mode = resolveDomainModeFromHeaders(headerStore)
  const maintenanceActive = await isMaintenanceActiveForRequest(headerStore, mode)
  const seo = await getDomainSeoSettings(mode)
  const canonicalOrigin = await resolveCanonicalOrigin({ mode, headerStore })
  const label = getDomainLabel(mode)
  const title = seo.metaTitle || label
  const description = seo.metaDescription || getSiteDescription(mode)
  const siteName = seo.siteName || getSiteName(mode)
  const ogTitle = seo.ogTitle || title
  const ogDescription = seo.ogDescription || description
  const ogImage = resolveDomainOgImage({ mode, origin: canonicalOrigin, configuredImageUrl: seo.ogImageUrl })
  const twitterTitle = seo.twitterTitle || ogTitle
  const twitterDescription = seo.twitterDescription || ogDescription
  const twitterImage = toAbsoluteUrl(canonicalOrigin, seo.twitterImageUrl) || ogImage

  return {
    title: maintenanceActive ? `Temporarily unavailable | ${label}` : title,
    description,
    metadataBase: new URL(canonicalOrigin),
    alternates: { canonical: canonicalOrigin },
    openGraph: {
      title: ogTitle,
      description: ogDescription,
      url: canonicalOrigin,
      siteName,
      type: 'website',
      images: ogImage ? [{ url: ogImage, width: 1200, height: 630, alt: `${siteName} preview` }] : [],
    },
    twitter: {
      card: seo.twitterCard,
      title: twitterTitle,
      description: twitterDescription,
      images: twitterImage ? [twitterImage] : [],
    },
    robots: maintenanceActive
      ? { index: false, follow: false }
      : { index: seo.robotsIndex, follow: seo.robotsFollow },
    icons: resolveBrandIconLinks(mode),
    manifest: `/api/branding/manifest?mode=${mode}`,
  }
}

export default async function RootLayout({ children }) {
  const headerStore = await headers()
  const mode = resolveDomainModeFromHeaders(headerStore)

  if (!(await isWebsiteVisibleAtRoot(headerStore, mode))) {
    redirect('/admin')
  }

  const maintenanceActive = await isMaintenanceActiveForRequest(headerStore, mode)
  const footerBrand = getPrivateFooterBrand()
  // Standalone landing pages render their own footer; keep the simulated-admin exit
  // reachable because the admin nav bar is hidden during a simulation. Domains that
  // declare the standaloneLanding trait serve that landing at their own root
  // (see middleware.js).
  const pathname = String(headerStore.get(PUBLIC_SURFACE_PATHNAME_HEADER) || '')
  const hasPageFooter = hasPrivateDomainTrait(mode, 'standaloneLanding')
    && (pathname === `/${mode}` || pathname === '/')

  return (
    <html lang="en">
      <body className="bg-white min-h-screen text-gray-900 flex flex-col">
        <GlobalPageMotion />
        <CacheInitializer />
        <div className="flex-1">
          {maintenanceActive ? <MaintenanceScreen mode={mode} /> : children}
        </div>
        {!maintenanceActive && (
          hasPageFooter ? (
            <AdminSimulationExit />
          ) : (
            <footer className="py-4 px-6 text-center text-xs text-gray-400 border-t border-gray-100 mt-12">
              © 2026 {footerBrand && (
                <a href={footerBrand.href} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gray-600 transition-colors">{footerBrand.name}</a>
              )}
              <span className="text-gray-300"> · </span>
              {/* AGPL-3.0 section 13: offer the corresponding source to network users. */}
              <a href={process.env.NEXT_PUBLIC_SOURCE_URL} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gray-600 transition-colors">Source</a>
              <span className="text-gray-300"> · </span>
              AGPL-3.0
              {/* Simulated-admin sessions hide the admin nav bar; this is the only way back. */}
              <AdminSimulationExit />
            </footer>
          )
        )}
      </body>
    </html>
  )
}
