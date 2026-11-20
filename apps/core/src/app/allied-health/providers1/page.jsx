import ProvidersDirectory from '@/components/ProvidersDirectory'
import { normalizeProfession } from '@/lib/providersDirectory'
import { buildAlliedHealthDirectoryMetadata } from '@/lib/alliedHealthMetadata'

export function generateMetadata() {
    return {
        ...buildAlliedHealthDirectoryMetadata({
            path: '/allied-health/providers1',
            title: 'Allied Health Provider Directory',
            description: 'Search Australian allied health providers by profession, service type, funding pathway, and location.',
        }),
        // Superseded by /allied-health/providers: the same listings without the approved website
        // captures, kept as a plain-card fallback rather than a second page competing for the same
        // searches.
        robots: { index: false, follow: true },
    }
}

export default async function Providers1Page({ searchParams }) {
    const params = await Promise.resolve(searchParams)
    return <ProvidersDirectory basePath="/allied-health/providers1" initialProfession={normalizeProfession(params?.p || params?.profession || '')} />
}
