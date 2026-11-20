import { permanentRedirect } from 'next/navigation'

const SUPPLIERS_PATH = '/allied-health/suppliers'

// The supplier directory lives at /allied-health/suppliers (canonical
// the canonical suppliers URL). This path is kept as a permanent redirect so
// existing links and any indexed URLs transfer instead of 404ing. Query params are carried
// over because the directory uses ?p=<profession> for its initial filter.
export default async function LegacyEquipmentPage({ searchParams }) {
    const params = await Promise.resolve(searchParams)
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params || {})) {
        if (typeof value === 'string') query.set(key, value)
    }
    const suffix = query.toString()
    permanentRedirect(`${SUPPLIERS_PATH}${suffix ? `?${suffix}` : ''}`)
}