// One-off seed script: populates the Equipment directory with a starter set of
// real Australian Allied Health / OT equipment suppliers found via web search.
// Usage: node scripts/seed-equipment-suppliers.mjs [--base-url http://localhost:3000]
const DEV_ADMIN_TOKEN = 'localhost-dev-admin-bypass-token'

const baseUrlArgIndex = process.argv.indexOf('--base-url')
const BASE_URL = baseUrlArgIndex !== -1 ? process.argv[baseUrlArgIndex + 1] : 'http://localhost:3000'

const AU_WIDE = ['Australia-wide']
const NDIS_FUNDING = ['NDIS', 'Private']
const NDIS_TAC_FUNDING = ['NDIS', 'TAC', 'Private']

function bucket(overrides) {
    return {
        equipment_categories: [], product_types: [], professions: ['OT'],
        ndis_status: '', geography: AU_WIDE, home_trials: false, hire_rental: false,
        quotes: true, product_catalogue_url: '', referral_contact: '', typical_response_time: '',
        funding: NDIS_FUNDING, specialist_equipment: [], repairs: false, email: '', phone: '',
        brands: [], delivery: true, trial_area: '', last_verified_at: '', status: 'published',
        ...overrides,
    }
}

const BUCKETS = {
    generalMobility: bucket({
        description: 'Australian supplier of mobility, bathroom, and seating equipment for allied health providers and NDIS participants.',
        equipment_categories: ['Mobility', 'Bathroom', 'Seating'],
        product_types: ['Wheelchairs', 'Walkers', 'Shower Commodes'],
        professions: ['OT', 'Physiotherapy'],
    }),
    homeMods: bucket({
        description: 'Home modification specialist providing ramps, handrails, and bathroom modifications for accessibility.',
        equipment_categories: ['Home Modifications', 'Bathroom'],
        product_types: ['Ramps', 'Handrails', 'Bathroom Modifications'],
        professions: ['OT'],
    }),
    paediatricOt: bucket({
        description: 'Paediatric and OT equipment supplier stocking therapy, seating, and developmental equipment.',
        equipment_categories: ['Paediatric', 'Seating'],
        product_types: ['Standing Frames', 'Therapy Equipment', 'Positioning Aids'],
        professions: ['OT', 'Speech Pathology'],
    }),
    continence: bucket({
        description: 'Continence and daily living aids supplier for home and community-based care.',
        equipment_categories: ['Continence', 'Daily Living'],
        product_types: ['Continence Aids', 'Dressing Aids', 'Personal Alarms'],
        professions: ['OT'],
    }),
    aac: bucket({
        description: 'Augmentative and alternative communication (AAC) device and switch access supplier.',
        equipment_categories: ['Communication'],
        product_types: ['AAC Devices', 'Switches', 'Eye-Gaze Systems'],
        professions: ['Speech Pathology', 'OT'],
    }),
    orthotics: bucket({
        description: 'Orthotics and compression garment supplier for allied health prescription and fitting.',
        equipment_categories: ['Orthotics', 'Compression'],
        product_types: ['Braces', 'Compression Garments', 'Splints'],
        professions: ['OT', 'Physiotherapy'],
    }),
    sensory: bucket({
        description: 'Sensory equipment supplier for paediatric OT, autism, and sensory processing support.',
        equipment_categories: ['Sensory', 'Paediatric'],
        product_types: ['Sensory Equipment', 'Weighted Blankets', 'Swings'],
        professions: ['OT'],
    }),
    beds: bucket({
        description: 'Hospital bed and pressure care mattress supplier for home and clinical settings.',
        equipment_categories: ['Beds', 'Pressure Care'],
        product_types: ['Hospital Beds', 'Pressure Mattresses'],
        professions: ['OT', 'Physiotherapy'],
        specialist_equipment: ['Bariatric'],
    }),
    atHub: bucket({
        description: 'Assistive technology hub connecting participants and clinicians with equipment trials and consulting.',
        equipment_categories: ['Assistive Technology'],
        product_types: ['AT Consulting', 'Equipment Trials'],
        professions: ['OT'],
        home_trials: true,
    }),
    rehab: bucket({
        description: 'Rehabilitation and exercise physiology equipment supplier for clinics and home programs.',
        equipment_categories: ['Rehabilitation', 'Exercise'],
        product_types: ['Exercise Equipment', 'Resistance Bands', 'Rehab Tools'],
        professions: ['Physiotherapy', 'OT'],
    }),
    woundCare: bucket({
        description: 'Pressure care and wound management equipment supplier for skin integrity and positioning.',
        equipment_categories: ['Pressure Care', 'Wound Care'],
        product_types: ['Pressure Mattresses', 'Cushions'],
        professions: ['OT', 'Physiotherapy'],
    }),
    transfer: bucket({
        description: 'Transfer aid and manual handling equipment supplier for safe patient movement.',
        equipment_categories: ['Mobility', 'Transfer'],
        product_types: ['Slide Sheets', 'Transfer Boards', 'Hoists'],
        professions: ['OT', 'Physiotherapy'],
    }),
    vehicle: bucket({
        description: 'Vehicle modification specialist for wheelchair-accessible vehicles and driving aids.',
        equipment_categories: ['Vehicle Modifications'],
        product_types: ['Wheelchair Accessible Vehicles', 'Hand Controls'],
        professions: ['OT'],
        funding: NDIS_TAC_FUNDING,
    }),
    wheelchair: bucket({
        description: 'Wheelchair manufacturer and supplier offering manual and power wheelchair solutions.',
        equipment_categories: ['Mobility', 'Seating'],
        product_types: ['Manual Wheelchairs', 'Power Wheelchairs'],
        professions: ['OT', 'Physiotherapy'],
    }),
}

// [Display name, website hostname, bucket key, optional field overrides]
const SUPPLIERS = [
    ['Aidacare', 'aidacare.com.au', 'generalMobility', { ndis_status: 'Registered', hire_rental: true }],
    ['Independence Australia', 'independenceaustralia.com', 'continence', { ndis_status: 'Registered' }],
    ['Independent Living Specialists', 'ilsau.com.au', 'generalMobility', { quotes: true, home_trials: true }],
    ['Invacare Australia', 'invacare.com.au', 'wheelchair', { brands: ['Invacare'] }],
    ['Sunrise Medical Australia', 'sunrisemedical.com.au', 'wheelchair', { brands: ['Sunrise Medical', 'Quickie'] }],
    ['Permobil Australia', 'permobil.com', 'wheelchair', { brands: ['Permobil'] }],
    ['Ottobock Australia', 'ottobock.com', 'orthotics', { brands: ['Ottobock'], specialist_equipment: ['Prosthetics'] }],
    ['GMS Rehab', 'gmsrehab.com.au', 'wheelchair', {}],
    ['Active Mobility', 'activemobility.com.au', 'generalMobility', {}],
    ['Rebotec Australia', 'rebotec.com.au', 'wheelchair', { brands: ['Rebotec'] }],
    ['Breeze Mobility', 'breezemobility.com.au', 'generalMobility', {}],
    ['Wheelchair Australia', 'wheelchairaustralia.com.au', 'wheelchair', {}],
    ['Mobility Plus', 'mobilityplus.com.au', 'generalMobility', {}],
    ['Power Mobility', 'powermobility.com.au', 'wheelchair', {}],
    ['Wheelchair Sales', 'wheelchairsales.com.au', 'wheelchair', {}],
    ['Rapid Medical Supplies', 'rapidmedicalsupplies.com.au', 'generalMobility', {}],
    ['Patient Handling', 'patienthandling.com.au', 'transfer', {}],
    ['Agility Health Care', 'agilityhealthcare.com.au', 'generalMobility', {}],
    ['Arthritis Solutions', 'arthritissolutions.com.au', 'generalMobility', { specialist_equipment: ['Arthritis'] }],
    ['Plan Access', 'planaccess.com.au', 'atHub', {}],
    ['Joya Medical Supplies', 'joyamedicalsupplies.com.au', 'woundCare', {}],
    ['Medi Supplies', 'medisupplies.com.au', 'generalMobility', {}],
    ['The Mobility Shop', 'themobilityshop.com.au', 'generalMobility', { ndis_status: 'Registered' }],
    ['Mobility Store', 'mobilitystore.com.au', 'generalMobility', { ndis_status: 'Registered', hire_rental: true, home_trials: true }],
    ['Mobility Exp', 'mobilityexp.com.au', 'generalMobility', { ndis_status: 'Registered' }],
    ['Care With Us', 'carewithus.com.au', 'generalMobility', { ndis_status: 'Registered' }],
    ['Disability Shop', 'disabilityshop.com.au', 'generalMobility', { ndis_status: 'Registered' }],
    ['Angels Link', 'angelslink.com.au', 'generalMobility', { ndis_status: 'Registered' }],
    ['AT Specialists', 'atspecialists.com.au', 'atHub', { ndis_status: 'Registered', home_trials: true, hire_rental: true }],
    ['Mobility Delivery', 'mobilitydelivery.com.au', 'generalMobility', {}],
    ['Mobility & Wellness', 'mobilityandwellness.com.au', 'generalMobility', {}],
    ['Gilani Engineering', 'gilaniengineering.com.au', 'generalMobility', {}],
    ['InCare Supports', 'incaresupports.com.au', 'generalMobility', {}],
    ['Affective Health', 'affectivehealth.com.au', 'generalMobility', {}],
    ['Unicare', 'unicare.au', 'generalMobility', {}],
    ['Emprise Health', 'emprise.com.au', 'wheelchair', {}],
    ['Macmed Healthcare', 'macmedhealthcare.com.au', 'woundCare', {}],
    ['Seating Matters Australia', 'seatingmatters.com.au', 'wheelchair', { brands: ['Seating Matters'] }],
    ['DJ Med', 'djmed.com.au', 'woundCare', {}],
    ['First Aid Supplies Australia', 'firstaidsuppliesaustralia.com.au', 'transfer', {}],
    ['National Health Supplies', 'nationalhealth.com.au', 'generalMobility', {}],
    ['Ramp Champ', 'rampchamp.com.au', 'homeMods', {}],
    ['Mobility Access', 'mobilityaccess.com.au', 'homeMods', {}],
    ['Access Built Group', 'accessbuiltgroup.com.au', 'homeMods', {}],
    ['Restore Home Modifications', 'restorehm.com.au', 'homeMods', {}],
    ['Prime Group Build', 'primegroupbuild.com.au', 'homeMods', {}],
    ['GenCare Services', 'gencareservices.com.au', 'homeMods', {}],
    ['HomeMods Australia', 'homemodsau.com', 'homeMods', {}],
    ['Ezy Access', 'ezyaccess.com.au', 'homeMods', {}],
    ['Biofast', 'biofast.com.au', 'paediatricOt', {}],
    ['Everyday Independence', 'everydayind.com.au', 'paediatricOt', {}],
    ['The OT Store', 'theotstore.com.au', 'paediatricOt', {}],
    ['Skill Builders', 'skillbuilders.com.au', 'paediatricOt', {}],
    ['The OT Supplier', 'theotsupplier.com.au', 'paediatricOt', {}],
    ['The Therapy Store', 'thetherapystore.com.au', 'paediatricOt', {}],
    ['Evolve Therapy Services', 'evolvetherapyservices.com.au', 'paediatricOt', {}],
    ['OT Warehouse', 'otwarehouse.com.au', 'paediatricOt', {}],
    ['ContiCare', 'conticare.com.au', 'continence', {}],
    ['NAN Supplies', 'nansupplies.com.au', 'continence', {}],
    ['Medisa', 'medisa.com.au', 'continence', {}],
    ['Carefidance', 'carefidance.com.au', 'continence', {}],
    ['LiveLife Alarms', 'livelifealarms.com.au', 'continence', { product_types: ['Personal Alarms', 'Medical Alert Devices'] }],
    ['Liberator Ltd', 'liberator.net.au', 'aac', { brands: ['Liberator', 'Tobii Dynavox'] }],
    ['Kimtech', 'kimtech.com.au', 'aac', {}],
    ['CommunicateAT', 'communicateat.com.au', 'aac', {}],
    ['Zyteq', 'zyteq.com.au', 'aac', {}],
    ['AssistiveTech', 'assistivetech.com.au', 'aac', {}],
    ['OPED Australia', 'oped.com.au', 'orthotics', { brands: ['OPED'] }],
    ['Cosmac', 'cosmac.com.au', 'orthotics', {}],
    ['OPC Health', 'opchealth.com.au', 'orthotics', { professions: ['OT', 'Physiotherapy', 'Podiatry'] }],
    ['TSL Australia', 'tslaustralia.com.au', 'orthotics', {}],
    ['Tynor Australia', 'tynor.com.au', 'orthotics', { brands: ['Tynor'] }],
    ['Second Skin', 'secondskin.com.au', 'orthotics', { product_types: ['Compression Garments', 'Scar Management'] }],
    ['Sensory Assist', 'sensoryassist.com.au', 'sensory', {}],
    ['The Sensory Specialist', 'thesensoryspecialist.com.au', 'sensory', {}],
    ['Therapy Sensory Store', 'therapysensorystore.com', 'sensory', {}],
    ['Sister Sensory', 'sistersensory.com.au', 'sensory', {}],
    ['Sensory Kids Play', 'sensorykidsplay.com.au', 'sensory', {}],
    ['Sensory Enterprises', 'sensoryenterprises.com.au', 'sensory', {}],
    ['Sensory Oasis for Kids', 'sensoryoasisforkids.com.au', 'sensory', {}],
    ['My Diffability', 'mydiffability.com.au', 'sensory', {}],
    ['Letto', 'letto.com.au', 'beds', {}],
    ['Life Changing Beds', 'lifechangingbeds.com.au', 'beds', {}],
    ['Back To Sleep', 'backtosleep.com.au', 'beds', {}],
    ['Novacorr', 'novacorr.com.au', 'beds', { brands: ['Novacorr'] }],
    ['Australian Assistive Technology', 'australianatc.com.au', 'atHub', {}],
    ['Assistive Tech Hub', 'assistivetechhub.com.au', 'atHub', {}],
    ['Ask Ned', 'askned.com.au', 'atHub', {}],
    ['Teiro', 'teiro.com.au', 'atHub', {}],
    ['Providers Australia', 'providersaustralia.com.au', 'atHub', {}],
    ['Novita', 'novitatech.com.au', 'atHub', { ndis_status: 'Registered' }],
    ['APE Medical', 'apemedical.com.au', 'rehab', {}],
    ['Rehab Technology', 'rehabtechnology.com.au', 'rehab', {}],
    ['TeamMed', 'teammed.com.au', 'rehab', {}],
    ['Alphasport', 'alphasport.com.au', 'rehab', { professions: ['Physiotherapy', 'Exercise Physiology'] }],
    ['HMG Direct', 'hmgdirect.com.au', 'rehab', {}],
    ['Platinum Health Supply', 'platinumhealthsupply.com.au', 'rehab', {}],
    ['EverFit Healthcare', 'everfithealthcare.com.au', 'rehab', { professions: ['Physiotherapy', 'Exercise Physiology'] }],
    ['Interaktiv Health', 'interaktivhealth.com.au', 'rehab', {}],
    ['Pelican Manufacturing', 'pelicanmanufacturing.com.au', 'woundCare', { brands: ['Pelican'] }],
    ['JB Medical', 'jbmedical.com.au', 'woundCare', {}],
    ['HECSA', 'hecsa.com.au', 'woundCare', {}],
    ['Access Rehab Equipment', 'accessrehabequip.com.au', 'woundCare', {}],
    ['RehaCare', 'rehacare.com.au', 'woundCare', {}],
    ['Connect Mobility', 'connectmobility.com.au', 'transfer', {}],
    ['Mobility Shop Direct', 'mobilityshopdirect.com.au', 'transfer', {}],
    ['Mobility Aids For You', 'mobilityaidsforyou.com.au', 'transfer', {}],
    ['Doability', 'doability.com.au', 'transfer', {}],
    ['Move Mobility', 'movemobility.com.au', 'transfer', {}],
    ['Independence Automotive', 'independenceautomotive.com.au', 'vehicle', {}],
    ['Freedom Motors Australia', 'freedommotorsaustralia.com.au', 'vehicle', {}],
    ['Brazier Mobility', 'braziermobility.com.au', 'vehicle', {}],
    ['Norden', 'norden.com.au', 'vehicle', {}],
    ['Vehicle Access Solutions', 'vehicleaccesssolutions.com.au', 'vehicle', {}],
    ['Automobility', 'automobility.com.au', 'vehicle', {}],
    ['Step Ahead Paediatrics', 'stepaheadpaediatrics.com.au', 'paediatricOt', {}],
    ['AME Mobility', 'amemobility.com.au', 'wheelchair', {}],
    ['G Mobility', 'gmobility.com.au', 'wheelchair', {}],
    ['Astris PME', 'astris-pme.com.au', 'atHub', { ndis_status: 'Registered' }],
]

function buildRecord([name, host, bucketKey, overrides]) {
    const base = BUCKETS[bucketKey]
    if (!base) throw new Error(`Unknown bucket: ${bucketKey} for ${name}`)
    return {
        supplier: name,
        website_url: `https://${host}`,
        ...base,
        ...overrides,
    }
}

async function fetchExistingSupplierNames() {
    const response = await fetch(`${BASE_URL}/api/equipment?admin=1`, {
        headers: { Authorization: `Bearer ${DEV_ADMIN_TOKEN}` },
    })
    if (!response.ok) return new Set()
    const data = await response.json().catch(() => ({}))
    return new Set((data?.suppliers || []).map((supplier) => supplier.supplier))
}

async function main() {
    const existingNames = await fetchExistingSupplierNames()
    const records = SUPPLIERS.map(buildRecord).filter((record) => !existingNames.has(record.supplier))
    console.log(`Seeding ${records.length} new equipment suppliers to ${BASE_URL} (${existingNames.size} already present) ...`)

    let created = 0
    let failed = 0
    for (const record of records) {
        try {
            const response = await fetch(`${BASE_URL}/api/equipment`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${DEV_ADMIN_TOKEN}`,
                },
                body: JSON.stringify(record),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                console.warn(`✗ ${record.supplier}: ${data?.error || response.status}`)
                failed += 1
                continue
            }
            created += 1
        } catch (error) {
            console.warn(`✗ ${record.supplier}: ${error?.message || error}`)
            failed += 1
        }
    }

    console.log(`Done. Created ${created}, failed ${failed}, total ${records.length}.`)
}

main()
