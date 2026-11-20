'use client'

import { useEffect, useRef } from 'react'
import AdminHeader from '@/admin-ui/components/AdminHeader'
import EquipmentDirectory from '@/components/EquipmentDirectory'

const PANEL_SURFACE_CLASS = 'rounded-lg border border-gray-200 bg-white/90 p-6 shadow-sm backdrop-blur-[1px]'

export default function AdminSuppliersPage() {
    const directoryRef = useRef(null)

    useEffect(() => {
        document.title = 'Equipment Suppliers'
    }, [])

    return (
        <div className="min-h-screen">
            <AdminHeader title="Equipment Suppliers" />

            <main className="mx-auto max-w-7xl px-4 py-8">
                <section className={PANEL_SURFACE_CLASS}>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Equipment Suppliers</h1>
                            <p className="mt-1 text-sm text-gray-600">Manage the Allied Health supplier directory and your favourites.</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => directoryRef.current?.openCreateForm()}
                            className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700"
                        >
                            Add supplier
                        </button>
                    </div>
                </section>
            </main>

            <EquipmentDirectory ref={directoryRef} manage showHeader={false} embedded />
        </div>
    )
}
