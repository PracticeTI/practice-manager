'use client'

import { useEffect, useRef } from 'react'
import AdminHeader from '@/admin-ui/components/AdminHeader'
import ProvidersDirectory from '@/components/ProvidersDirectory'

export default function ProvidersSettingsPage() {
    const directoryRef = useRef(null)

    useEffect(() => {
        document.title = 'Provider Settings'
    }, [])

    return (
        <div className="min-h-screen">
            <AdminHeader title="Provider Settings" />
            <main className="mx-auto max-w-7xl px-4 py-8">
                <section className="mb-6 rounded-lg border border-gray-200 bg-white/90 p-6 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Provider Settings</h1>
                            <p className="mt-1 text-sm text-gray-600">Review and manage the shared Allied Health provider directory.</p>
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
                <ProvidersDirectory ref={directoryRef} manage superadminReview showHeader={false} />
            </main>
        </div>
    )
}
