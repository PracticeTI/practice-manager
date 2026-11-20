import { getDomainLabel } from '@/lib/domainMode'

/**
 * Full-page maintenance screen shown in place of the public frontend when a
 * domain has Maintenance Mode enabled (production only).
 *
 * Server component: no interactivity is required, and it must render even when
 * the app's client bundles are being redeployed.
 */
export default function MaintenanceScreen({ mode = '' }) {
    const label = getDomainLabel(mode)

    return (
        <main
            role="status"
            aria-live="polite"
            className="flex min-h-[70vh] items-center justify-center px-6 py-20"
        >
            <div className="w-full max-w-xl rounded-2xl border border-gray-200 bg-white p-10 text-center shadow-sm">
                <span className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-700">
                    Scheduled maintenance
                </span>
                <h1 className="mt-6 text-2xl font-semibold text-gray-900 sm:text-3xl">
                    {label} is temporarily unavailable
                </h1>
                <p className="mt-4 text-sm leading-6 text-gray-600">
                    We are making some updates and will be back shortly. Thanks for your patience — please
                    check back in a little while.
                </p>
            </div>
        </main>
    )
}
