// One-off cleanup script: collapses duplicate catalogue profiles in the Equipment
// directory. Suppliers that carry byte-identical catalogue data (same product types,
// categories, specialist equipment, brands, description, professions) are
// indistinguishable to the sourcing-wizard matcher, which made "Top catalog matches"
// surface arbitrary alphabetical clones.
//
// For each identical-profile group we keep the well-known real anchors (below) — or, if
// a group has no known anchor, the single "best" published supplier (favourites, then
// alphabetical) — and set every other published member to `status: hidden`. Hidden rows
// stay in the DB and remain visible to superadmins in Equipment settings → review, so the
// change is fully reversible.
//
// Usage: node scripts/cleanup-equipment-duplicates.mjs                # dry run
//        node scripts/cleanup-equipment-duplicates.mjs --apply        # actually hide

const DEV_ADMIN_TOKEN = 'localhost-dev-admin-bypass-token'

const baseUrlArgIndex = process.argv.indexOf('--base-url')
const BASE_URL = baseUrlArgIndex !== -1 ? process.argv[baseUrlArgIndex + 1] : 'http://localhost:3000'
const APPLY = process.argv.includes('--apply')

// Real, well-known national suppliers worth keeping as anchors even though their seeded
// profile is generic. Exact names must match the stored `supplier` field.
const KEEP_ANCHORS = new Set([
    'Aidacare',
    'Active Mobility',
    'Independent Living Specialists',
    'Independence Australia',
    'Arthritis Solutions',
    'Invacare Australia',
    'Sunrise Medical Australia',
    'Permobil Australia',
    'Ottobock Australia',
    'Rebotec Australia',
    'Seating Matters Australia',
    'GMS Rehab',
    'Novita',
    'Australian Assistive Technology',
    'Everyday Independence',
    'Step Ahead Paediatrics',
    'Pelican Manufacturing',
    'Sister Sensory',
    'The Sensory Specialist',
    'Novacorr',
    'OPED Australia',
    'Tynor Australia',
    'OPC Health',
    'Liberator Ltd',
    'Zyteq',
])

// Fields that make one supplier's catalogue profile identical to another's. Brands and
// specialist_equipment are included so suppliers that already carry differentiating data
// (e.g. Invacare vs Sunrise) are never treated as duplicates.
const SIGNATURE_FIELDS = [
    'product_types',
    'equipment_categories',
    'specialist_equipment',
    'description',
    'brands',
    'professions',
]

function signatureOf(supplier) {
    return JSON.stringify(SIGNATURE_FIELDS.map((field) => {
        const value = supplier?.[field]
        return Array.isArray(value) ? [...value].sort() : String(value || '')
    }))
}

async function main() {
    const response = await fetch(`${BASE_URL}/api/equipment?admin=1`, {
        headers: { Authorization: `Bearer ${DEV_ADMIN_TOKEN}` },
    })
    if (!response.ok) {
        console.error(`Failed to load suppliers: HTTP ${response.status}`)
        process.exit(1)
    }
    const { suppliers } = await response.json()

    // Only touch rows that are currently published; leave draft/archived/admin_added alone.
    const published = suppliers.filter((supplier) => supplier.status === 'published')

    const bySignature = new Map()
    for (const supplier of published) {
        const signature = signatureOf(supplier)
        if (!bySignature.has(signature)) bySignature.set(signature, [])
        bySignature.get(signature).push(supplier)
    }

    const groups = [...bySignature.values()].filter((group) => group.length > 1)
    const plan = []
    for (const group of groups) {
        const anchors = group.filter((supplier) => KEEP_ANCHORS.has(supplier.supplier))
        let keep
        if (anchors.length > 0) {
            keep = anchors
        } else {
            // No known anchor: keep the single most-liked row, else alphabetical first.
            const best = [...group].sort((left, right) => (
                (right.favorite_count || 0) - (left.favorite_count || 0)
                || left.supplier.localeCompare(right.supplier)
            ))[0]
            keep = [best]
        }
        const keepIds = new Set(keep.map((supplier) => supplier.id))
        const toHide = group.filter((supplier) => !keepIds.has(supplier.id))
        plan.push({ group, keep, toHide })
    }

    const totalToHide = plan.reduce((sum, { toHide }) => sum + toHide.length, 0)
    console.log(`${published.length} published suppliers, ${groups.length} duplicate-profile groups.`)
    console.log(`Plan: keep ${published.length - totalToHide}, hide ${totalToHide} (${APPLY ? 'APPLYING' : 'dry run — pass --apply to execute'})`)

    for (const { group, keep, toHide } of plan) {
        const profile = `${group[0].product_types?.join('|') || '?'} // ${group[0].description?.slice(0, 60) || ''}`
        console.log(`\n[${group.length} identical] ${profile}`)
        console.log(`  keep:  ${keep.map((s) => `${s.supplier} (id ${s.id}${s.favorite_count ? `, fav ${s.favorite_count}` : ''})`).join(' | ')}`)
        if (toHide.length === 0) continue
        console.log(`  hide:  ${toHide.map((s) => s.supplier).join(' | ')}`)
    }

    if (!APPLY) {
        console.log('\nDry run complete. Re-run with --apply to set the listed rows to hidden.')
        return
    }

    let hidden = 0
    let failed = 0
    for (const { toHide } of plan) {
        for (const supplier of toHide) {
            const patchResponse = await fetch(`${BASE_URL}/api/equipment/review/${supplier.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${DEV_ADMIN_TOKEN}`,
                },
                body: JSON.stringify({ status: 'hidden' }),
            })
            const data = await patchResponse.json().catch(() => ({}))
            if (!patchResponse.ok) {
                console.warn(`✗ ${supplier.supplier} (id ${supplier.id}): ${data?.error || patchResponse.status}`)
                failed += 1
                continue
            }
            hidden += 1
        }
    }
    console.log(`\nDone. Hidden ${hidden}, failed ${failed}.`)
}

main()
