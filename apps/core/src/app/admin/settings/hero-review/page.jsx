import AdminHeader from '@/admin-ui/components/AdminHeader'
import HeroReviewView from '@/components/HeroReviewView'
import SuperAdminOnly from '@/components/SuperAdminOnly'
import { isDevToolingEnabled } from '@/lib/devTools'
import { notFound } from 'next/navigation'

// Nothing to prerender: the batch is fetched by the client from a superadmin-only API, and an
// internal tool must never be served from a cache.
export const dynamic = 'force-dynamic'

export const metadata = {
    title: 'Hero Review',
}

/**
 * Superadmin provider hero review — a child of the settings tooling.
 *
 * The implementation lives under `admin/settings/` alongside the other settings tools, and
 * `/settings/hero-review` re-exports it (see `src/app/settings/hero-review/page.jsx`), the same
 * alias arrangement `/settings/system-state` uses. Either path works; the Dev Tools button on
 * `/admin/settings` links to the `/settings` one.
 *
 * The chrome is the admin portal's — `AdminHeader` brings the `AdminBanner` (active domain mode,
 * superadmin links) — rather than the operator's directory shell, because this is an internal
 * superadmin tool and not a page of the public allied health directory. `SuperAdminOnly` sits
 * inside that chrome so the banner stays put while access is resolved.
 *
 * The batch is fetched from `/api/allied-health/provider-review-batch`, which refuses
 * non-superadmins, so nothing internal is serialized into the page before the gate runs. A server
 * component loading the batch would put provider data in the RSC payload for anyone who requests
 * the URL, gate or no gate. The gate resolves the role in the browser (the admin session lives in
 * localStorage, so the server cannot see it) and is for the redirect/access-denied UX; the API is
 * the actual boundary.
 */
export default function HeroReviewSettingsPage() {
    // Capture and approval only exist on a workstation with Chrome, so the page must
    // not be reachable from a deployment where the API answers 501.
    if (!isDevToolingEnabled()) notFound()

    return (
        <div className="min-h-screen bg-gray-50">
            <AdminHeader title="Hero Review" />
            <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
                <SuperAdminOnly
                    title="Hero review is superadmin-only"
                    description="Sign in with a superadmin account to review and approve provider hero captures."
                >
                    <HeroReviewView />
                </SuperAdminOnly>
            </main>
        </div>
    )
}
