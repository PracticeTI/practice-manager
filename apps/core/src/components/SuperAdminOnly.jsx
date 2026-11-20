'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getCurrentUser, getOrCreateAdminTokenForLocalhost } from '@/lib/clientAdminAuth'

const FOCUS_RING =
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 focus-visible:ring-offset-white'

/**
 * Client-side gate for internal tools that only superadmins may open.
 *
 * The admin session lives in localStorage (see `clientAdminAuth.js`), so a server
 * component cannot resolve the role — the same reason every `/admin` page gates in
 * the browser. Nothing is rendered until the check finishes, so the fallback HTML
 * never contains the protected content.
 *
 * The page wraps this gate in the admin chrome (banner + header), so both fallbacks are
 * inline panels that leave that chrome in place rather than full-screen pages.
 *
 * - no session token  -> sent to /login
 * - non-superadmin    -> "Access denied" and a way back to /admin
 * - superadmin        -> `children`
 */
export default function SuperAdminOnly({ children, title = 'Access denied', description = 'This tool is limited to superadmin sessions.' }) {
    const router = useRouter()
    // 'checking' | 'allowed' | 'denied'
    const [access, setAccess] = useState('checking')

    useEffect(() => {
        let cancelled = false

        async function bootstrap() {
            const token = await getOrCreateAdminTokenForLocalhost()
            if (cancelled) return

            if (!token) {
                router.replace('/login')
                return
            }

            const user = getCurrentUser()
            setAccess(user?.role === 'superadmin' ? 'allowed' : 'denied')
        }

        bootstrap()
        return () => { cancelled = true }
    }, [router])

    if (access === 'allowed') {
        return children
    }

    if (access === 'denied') {
        return (
            <div className="admin-card border-red-200 bg-red-50 p-8 text-center">
                <h1 className="text-lg font-semibold text-red-900">{title}</h1>
                <p className="mt-2 text-sm leading-6 text-red-700">{description}</p>
                <Link
                    href="/admin"
                    className={`mt-6 inline-block rounded-md bg-gray-900 px-4 py-2 text-xs font-medium text-white transition hover:bg-gray-700 ${FOCUS_RING}`}
                >
                    Back to admin
                </Link>
            </div>
        )
    }

    return (
        <div className="admin-card p-6 text-sm text-gray-500">Checking access&hellip;</div>
    )
}
