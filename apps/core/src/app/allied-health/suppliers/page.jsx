import EquipmentDirectory from '@/components/EquipmentDirectory'
import { normalizeProfession } from '@/lib/equipmentDirectory'
import { buildAlliedHealthDirectoryMetadata } from '@/lib/alliedHealthMetadata'

export function generateMetadata() {
    return buildAlliedHealthDirectoryMetadata({
        path: '/allied-health/suppliers',
        title: 'Allied Health Equipment Suppliers',
        description: 'Search Allied Health equipment suppliers by product, profession, location, funding, and service options.',
    })
}

export default async function SuppliersPage({ searchParams }) {
    const params = await Promise.resolve(searchParams)
    return <EquipmentDirectory initialProfession={normalizeProfession(params?.p || params?.profession || '')} />
}
