import AdminHeader from '@/admin-ui/components/AdminHeader'
import ActivityLog from '@/admin-ui/components/ActivityLog'
import SuperAdminOnly from '@/components/SuperAdminOnly'

// The trail is fetched by the client from a superadmin-only API, and an internal
// audit view must never be served from a cache.
export const dynamic = 'force-dynamic'

export const metadata = {
    title: 'Activities',
}

/**
 * Superadmin view of the audit trail across every domain.
 *
 * Implemented under `admin/settings/` alongside the other settings tools so it inherits the
 * settings chrome, and `/settings/activities` re-exports it (see
 * `src/app/settings/activities/page.jsx`), the same alias arrangement `/settings/system-state`
 * and `/settings/hero-review` use.
 *
 * The gate resolves the role in the browser (the admin session lives in localStorage, so the
 * server cannot see it) and provides the redirect/access-denied UX; `/api/settings/activities`
 * is the actual boundary and refuses non-superadmins on its own.
 */
export default function ActivitiesSettingsPage() {
    return (
        <div className="min-h-screen bg-gray-50">
            <AdminHeader title="Activities" />
            <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
                <SuperAdminOnly
                    title="Activities is superadmin-only"
                    description="Sign in with a superadmin account to see the audit trail for every domain."
                >
                    <ActivityLog
                        endpoint="/api/settings/activities"
                        showDomainFilter
                        description="Audit trail of who created, changed or deleted records across every domain."
                    />
                </SuperAdminOnly>
            </main>
        </div>
    )
}
