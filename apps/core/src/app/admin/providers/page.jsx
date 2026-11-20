import AdminProvidersDirectory from '@/admin-ui/components/AdminProvidersDirectory'
import { readApprovedHeroes } from '@/lib/providerHeroReview'

// The approved-capture manifest is read from disk per request, the same as /allied-health/providers,
// so an image approved after the last deploy shows up without a rebuild.
export const dynamic = 'force-dynamic'

/**
 * Admin provider directory.
 *
 * A server component only so the approved captures can be read from the manifest — the client cannot
 * (`node:fs`) — and handed to the cards. The listing itself is the client
 * `AdminProvidersDirectory`, which renders the same hero cards as /allied-health/providers.
 */
export default async function AdminProvidersPage() {
    const providerHeroes = await readApprovedHeroes()

    return <AdminProvidersDirectory providerHeroes={providerHeroes} />
}
