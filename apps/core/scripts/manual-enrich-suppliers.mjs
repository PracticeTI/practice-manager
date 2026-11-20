// One-off: manually enrich the suppliers whose websites block the server-side fetcher
// (403/empty-page), using data verified via a real browser fetch. Auto-applies via the
// superadmin API and logs before/after to local/manual-enrich-*.jsonl.
//
// Usage: node scripts/manual-enrich-suppliers.mjs [--dry]

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const BASE_URL = process.env.ENRICH_BASE_URL || 'http://localhost:3000'
const TOKEN = process.env.ENRICH_TOKEN || 'localhost-dev-admin-bypass-token'
const DRY = process.argv.includes('--dry')

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const LOG_FILE = path.join(ROOT, 'local', `manual-enrich-${stamp}.jsonl`)
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })

// Keyed by exact stored supplier name. Only fields present here are changed.
const MANUAL = {
    'Active Mobility': {
        product_types: [
            'Wheelchairs', 'Manual Wheelchairs', 'Power Wheelchairs', 'Mobility Scooters',
            'Walking Frames', 'Walkers', 'Rollators', 'Shower Commodes', 'Commode Chairs',
            'Shower Chairs', 'Bathing Aids', 'Grab Rails', 'Access Ramps', 'Patient Hoists',
            'Ceiling Hoists', 'Slings', 'Pressure Cushions', 'Bed Rails', 'Daily Living Aids',
            'Rehabilitation Aids',
        ],
        equipment_categories: ['Mobility', 'Bathroom', 'Seating', 'Beds', 'Pressure Care', 'Home Modifications', 'Daily Living'],
        specialist_equipment: ['Complex Rehab', 'Bariatric', 'Paediatric', 'Seating'],
        description: 'Australian-owned disability and mobility equipment supplier since 1995, with showrooms in Sydney and Newcastle. Stocks wheelchairs, mobility scooters, patient lifting hoists, commodes, bathing aids, ramps and rehabilitation aids, with product trials, equipment hire, servicing and repairs.',
        ndis_status: 'Registered',
        phone: '02 9649 2111',
        geography: ['Australia-wide', 'New South Wales'],
        funding: ['NDIS', 'Private'],
        hire_rental: true,
        home_trials: true,
        repairs: true,
        quotes: true,
        delivery: true,
        status: 'published',
    },
    'OPC Health': {
        product_types: [
            'Orthotic Braces', 'Splints', 'Orthotic Componentry', 'Compression Garments',
            'Prosthetic Components', 'Therapy Tables', 'Treatment Tables', 'Massage Tables',
            'Podiatry Chairs', 'Electrotherapy Units', 'TENS Units', 'Ultrasound', 'Shockwave',
            'Exercise and Rehab Equipment', 'Splinting Materials', 'Hand Therapy Supplies',
            'Hot and Cold Therapy', 'Daily Living Aids', 'Mobility Aids', 'Practice Supplies',
        ],
        equipment_categories: ['Orthotics', 'Prosthetics', 'Compression', 'Rehabilitation', 'Clinic Equipment', 'Daily Living'],
        specialist_equipment: ['Prosthetics', 'Orthotics', 'Paediatric', 'Hand Therapy', 'Burns and Scar'],
        description: 'For over 40 years OPC Health has supplied prosthetic, orthotic and allied health professionals (physiotherapy, podiatry, hand therapy) across Australia and New Zealand, stocking orthotics, prosthetics, compression, clinic and practice equipment from leading brands.',
        ndis_status: '',
        phone: '',
        geography: ['Australia-wide'],
        funding: ['Private'],
        status: 'published',
    },
    'Sister Sensory': {
        product_types: [
            'Sensory Toys', 'Fidget Toys', 'Weighted Blankets', 'Chewing Tools',
            'Oral Motor Tools', 'Sensory Seating', 'Sensory Swings', 'Calming Tools',
            'Sensory Integration Equipment', 'Educational Resources', 'Noise Reducing Headphones',
            'Visual Stimulation Toys', 'Sensory Bundles',
        ],
        equipment_categories: ['Sensory', 'Paediatric', 'Education', 'Daily Living'],
        specialist_equipment: ['Paediatric', 'Autism', 'Sensory Processing'],
        description: 'Australian family-owned sensory toy and tool store and registered NDIS provider (ABN 93 641 255 745). Stocks a large range of autism and sensory-processing tools, fidget toys and therapy resources for children and adults, with a Melton (VIC) store and online shopping.',
        ndis_status: 'Registered',
        phone: '0401 689 313',
        email: 'info@sistersensory.com.au',
        geography: ['Australia-wide', 'Victoria'],
        funding: ['NDIS', 'Private'],
        home_trials: false,
        delivery: true,
        quotes: true,
        status: 'published',
    },
    'The Therapy Store': {
        product_types: [
            'Sensory Toys', 'Fidget Toys', 'Chewing Tools', 'Oral Motor Tools',
            'Visual Stimulation Toys', 'Sound and Audio Toys', 'Vibrating Toys',
            'Fine Motor Tools', 'Gross Motor Equipment', 'Weighted Products',
            'Handwriting Aids', 'Educational Therapy Resources', 'Professional Books',
        ],
        equipment_categories: ['Sensory', 'Paediatric', 'Education'],
        specialist_equipment: ['Paediatric', 'Autism', 'Sensory Processing', 'Speech Pathology'],
        description: 'Australian provider of special-needs educational therapy toys and OT resources (NDIS-approved). Sells sensory, fidget, oral-motor, fine and gross motor, weighted and handwriting tools for teachers, clinics, parents and students across Australia.',
        ndis_status: 'Registered',
        phone: '03 9380 1127',
        email: 'sales@thetherapystore.com.au',
        geography: ['Australia-wide'],
        funding: ['NDIS', 'Private'],
        delivery: true,
        quotes: true,
        status: 'published',
    },
    'Access Built Group': {
        product_types: [
            'Access Ramps', 'Grab Rails', 'Handrails', 'Bathroom Modifications',
            'Door Widening', 'Home Modifications',
        ],
        equipment_categories: ['Home Modifications', 'Bathroom'],
        specialist_equipment: ['Home Modifications'],
        description: 'Melbourne-based NDIS home modification specialist (ABN 96 389 974 594). Supplies grab rails, handrails, access ramps, door widening and compliant bathroom modifications, working with OTs, support coordinators and plan managers.',
        ndis_status: 'Registered',
        phone: '0416 066 104',
        email: 'info@accessbuiltgroup.com.au',
        geography: ['Victoria'],
        funding: ['NDIS'],
        repairs: true,
        quotes: true,
        status: 'published',
    },
}

async function api(pathname, options = {}) {
    const response = await fetch(`${BASE_URL}${pathname}`, {
        ...options,
        headers: { Authorization: `Bearer ${TOKEN}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    })
    return { response, data: await response.json().catch(() => ({})) }
}

async function main() {
    const { data } = await api('/api/equipment/review')
    if (!data?.suppliers) {
        console.error(`Failed to load suppliers: ${data?.error || 'unexpected'}`)
        process.exit(1)
    }
    const byName = new Map(data.suppliers.map((s) => [s.supplier, s]))
    let applied = 0
    let failed = 0
    for (const [name, overrides] of Object.entries(MANUAL)) {
        const supplier = byName.get(name)
        if (!supplier) {
            console.warn(`✗ ${name}: not found`)
            failed += 1
            continue
        }
        const before = {
            status: supplier.status,
            description: supplier.description,
            product_types: supplier.product_types,
            equipment_categories: supplier.equipment_categories,
            specialist_equipment: supplier.specialist_equipment,
            phone: supplier.phone,
            email: supplier.email,
        }
        const next = { ...supplier }
        for (const key of ['id', 'favorite_count', 'is_favorite', 'logo_url', 'created_at', 'updated_at']) delete next[key]
        Object.assign(next, overrides)

        let after = supplier
        if (!DRY) {
            const { response, data: patchData } = await api(`/api/equipment/${supplier.id}`, {
                method: 'PATCH',
                body: JSON.stringify(next),
            })
            if (!response.ok) {
                console.warn(`✗ ${name}: ${patchData?.error || response.status}`)
                failed += 1
                continue
            }
            after = patchData.supplier || next
        }
        applied += 1
        const record = {
            ts: new Date().toISOString(),
            id: supplier.id,
            supplier: name,
            statusBefore: before.status,
            statusAfter: after?.status,
            changed: Object.keys(overrides).filter((key) => JSON.stringify(overrides[key]) !== JSON.stringify(supplier[key])),
            before,
            after: {
                status: after?.status,
                description: after?.description,
                product_types: after?.product_types,
                equipment_categories: after?.equipment_categories,
                specialist_equipment: after?.specialist_equipment,
                phone: after?.phone,
                email: after?.email,
            },
        }
        fs.appendFileSync(LOG_FILE, `${JSON.stringify(record)}\n`)
        console.log(`${DRY ? '[dry]' : '[ok]'} ${name}: status ${before.status} -> ${record.statusAfter}, changed=[${record.changed.join(', ')}]`)
    }
    console.log(`\nApplied ${applied}, failed ${failed}. ${DRY ? '(dry run)' : ''} Log: ${LOG_FILE}`)
}

main()
