import { randomInt } from 'node:crypto'
import ProvidersDirectory from '@/components/ProvidersDirectory'
import { normalizeProfession } from '@/lib/providersDirectory'
import { buildAlliedHealthDirectoryMetadata } from '@/lib/alliedHealthMetadata'
import { readApprovedHeroes } from '@/lib/providerHeroReview'

const BASE_PATH = '/allied-health/providers'

export function generateMetadata() {
    return {
        ...buildAlliedHealthDirectoryMetadata({
            path: BASE_PATH,
            title: 'Allied Health Provider Directory',
            description: 'Search Australian allied health providers by profession, service type, funding pathway, and location.',
        }),
    }
}

// The approved-capture manifest is read from disk per request, so an image approved after the last
// deploy shows up without a rebuild.
export const dynamic = 'force-dynamic'

export default async function ProvidersPage({ searchParams }) {
    const params = await Promise.resolve(searchParams)
    const providerHeroes = await readApprovedHeroes()

    // `heroCard` is the card variant this directory uses: the capture sits on the right and
    // the description moves under the provider name, clamped behind a chevron. `shuffleSeed` shuffles
    // the default listing instead of leaving it alphabetical, so the same handful of names does not
    // always lead the page. It is generated per request; the client re-shuffles deterministically from
    // it, so the cards keep their order across re-renders.
    return (
        <ProvidersDirectory
            initialProfession={normalizeProfession(params?.p || params?.profession || '')}
            providerHeroes={providerHeroes}
            heroCard
            shuffleSeed={randomInt(1, 0x7fffffff)}
        />
    )
}
