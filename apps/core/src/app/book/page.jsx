import { headers } from 'next/headers'
import { detectDomainFromHostname, resolveDomainModeFromHeaders } from '@/lib/domainMode'
import BookingClient from './BookingClient'

function normalizeDomain(value) {
    const normalized = String(value || '').trim().toLowerCase()
    return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized) ? normalized : ''
}

export const metadata = {
    title: 'Book an appointment',
    description: 'Choose an appointment type and a time that suits you.',
    robots: { index: false, follow: false },
}

export default async function BookPage({ searchParams }) {
    const params = await searchParams
    const headerStore = await headers()
    const host = headerStore.get('x-forwarded-host') || headerStore.get('host') || ''
    const domain = normalizeDomain(params?.domain)
        || detectDomainFromHostname(host)
        || resolveDomainModeFromHeaders(headerStore)

    return <BookingClient domain={domain} />
}
