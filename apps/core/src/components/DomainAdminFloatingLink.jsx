'use client'

import Link from 'next/link'
import { LayoutDashboard } from 'lucide-react'

/**
 * Small, subtle circular floating Admin link shown in the bottom-right corner
 * of a domain's public root page. Visibility is controlled per domain by the
 * `adminFloatingLinkEnabled` feature flag in Domain Settings (/domains).
 */
export default function DomainAdminFloatingLink({ show = false, offsetForVersionBadge = false }) {
    if (!show) return null

    return (
        <Link
            href="/admin"
            title="Admin"
            aria-label="Admin"
            className={`fixed ${offsetForVersionBadge ? 'bottom-12 right-4' : 'bottom-5 right-5'} z-[60] flex h-9 w-9 items-center justify-center rounded-full border border-gray-200/60 bg-white/60 text-gray-400 opacity-50 shadow-sm backdrop-blur-sm transition-all duration-200 hover:border-gray-300 hover:bg-white/90 hover:text-gray-700 hover:opacity-100 focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-gray-300`}
        >
            <LayoutDashboard className="h-4 w-4" strokeWidth={1.75} />
        </Link>
    )
}
