'use client'

import { useEffect, useRef } from 'react'
import AdminHeader from '@/admin-ui/components/AdminHeader'
import ProvidersDirectory from '@/components/ProvidersDirectory'

const PANEL_SURFACE_CLASS = 'rounded-lg border border-gray-200 bg-white/90 p-6 shadow-sm backdrop-blur-[1px]'

/**
 * Admin shell around the shared `ProvidersDirectory`.
 *
 * The admin listing renders the same cards as the public directory, captures included: a listing
 * being edited should look like the card a referrer sees at /allied-health/providers, and the
 * classic variant no longer has a caller of its own. `heroCard` selects that variant, and
 * `providerHeroes` (read from the manifest by the page, since the client cannot touch node:fs)
 * supplies each card's approved capture.
 */
export default function AdminProvidersDirectory({ providerHeroes = {} }) {
    const directoryRef = useRef(null)

    useEffect(() => {
        document.title = 'Provider Directory Admin'
    }, [])

    return (
        <div className="min-h-screen">
            <AdminHeader title="Provider Directory" />

            <main className="mx-auto max-w-7xl px-4 py-8">
                <section className={PANEL_SURFACE_CLASS}>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Provider Directory</h1>
                            <p className="mt-1 text-sm text-gray-600">Manage the Allied Health provider directory and your favourites.</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => directoryRef.current?.openCreateForm()}
                            className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700"
                        >
                            Add provider
                        </button>
                    </div>
                </section>
            </main>

            <ProvidersDirectory ref={directoryRef} manage showHeader={false} embedded heroCard providerHeroes={providerHeroes} />
        </div>
    )
}
