// One-off seed script: bootstraps the Provider directory with a starter list of real
// Australian allied health business names and their websites, found via DuckDuckGo web
// search plus well-known national NDIS/allied health organisations.
//
// It deliberately writes NAME + WEBSITE ONLY. An earlier version also stamped every record
// with one of eleven per-profession "bucket" templates (description, professions, service
// types, age groups, NDIS status, funding and the boolean flags). None of that was read
// from the provider's own site, so 110 of 116 rows ended up sharing just nine descriptions
// and every contact field was left empty. Profile data must now be read from the provider's
// own website via scripts/enrich-allied-health-providers.mjs.
//
// Usage: node scripts/seed-allied-health-providers.mjs [--base-url http://localhost:3000]
const DEV_ADMIN_TOKEN = 'localhost-dev-admin-bypass-token'

const baseUrlArgIndex = process.argv.indexOf('--base-url')
const BASE_URL = baseUrlArgIndex !== -1 ? process.argv[baseUrlArgIndex + 1] : 'http://localhost:3000'

// [Display name, website hostname]
const PROVIDERS = [
    // Multidisciplinary NDIS allied health networks
    ['Better Rehab', 'betterrehab.com.au'],
    ['Ability Action Australia', 'abilityactionaustralia.com.au'],
    ['Physio Inq', 'physioinq.com.au'],
    ['Path Allied Health', 'pathalliedhealth.com.au'],
    ['Everyday Independence', 'everydayind.com.au'],
    ['Advance Therapy', 'advancetherapy.com.au'],
    ['VICNA', 'vicna.com.au'],
    ['Happy Therapy Australia', 'happytherapyaustralia.com.au'],
    ['Soaring Health', 'soaringhealth.com.au'],
    ['Blue Fox Health', 'bluefoxhealth.com.au'],
    ['Our Physio Co', 'ourphysioco.com.au'],
    ['Healthy Bodies Physiotherapy', 'healthybodiesphysiotherapy.com.au'],
    ['Upward Physiotherapy', 'upwardphysiotherapy.com.au'],
    ['Physio Melbourne', 'physiomelbourne.com.au'],
    ['Karista', 'karista.com.au'],
    ['Bloom Healthcare', 'bloom-healthcare.com.au'],
    ['Connect2Care', 'connect2care.com.au'],
    ['ORS Group', 'orsgroup.com.au'],
    ['IPAR', 'ipar.com.au'],
    ['Konekt', 'konekt.com.au'],
    ['APM', 'apm.net.au'],
    ['MedHealth', 'medhealth.com.au'],
    ['Symmetry Human Services', 'symmetryhs.com.au'],
    ['Altius Health', 'altius.org.au'],

    // Occupational Therapy
    ['The OT Store', 'theotstore.com.au'],
    ['Evolve Therapy Services', 'evolvetherapyservices.com.au'],
    ['Step Ahead Paediatrics', 'stepaheadpaediatrics.com.au'],
    ['Skill Builders', 'skillbuilders.com.au'],
    ['Novita', 'novita.org.au'],
    ['Sunnyfield', 'sunnyfield.org.au'],
    ['Achieve Australia', 'achieveaustralia.org.au'],
    ['Cerebral Palsy Alliance', 'cerebralpalsy.org.au'],
    ['Aspect (Autism Spectrum Australia)', 'autismspectrum.org.au'],
    ['Scope Australia', 'scopeaust.org.au'],
    ['Yooralla', 'yooralla.com.au'],
    ['Genu', 'genu.org.au'],

    // Physiotherapy
    ['Fit Clinic', 'fitclinic.com.au'],
    ['Summit Health Group', 'summithealthgroup.com.au'],
    ['Beachside EP', 'beachsideep.com.au'],

    // Speech Pathology
    ['Umbo', 'umbo.com.au'],
    ['Light Me Up Therapy', 'lightmeuptherapy.com'],
    ['MyCareSpace', 'mycarespace.com.au'],

    // Psychology
    ['Meyer Institute', 'meyerinstitute.com.au'],
    ['Outcomes Lab', 'outcomeslab.com.au'],
    ['The Talk Shop', 'thetalkshop.com.au'],
    ['Clarity Psychology', 'claritypsych.com.au'],
    ['Mind Australia', 'mindaustralia.org.au'],
    ['Body & Mind', 'bodymindonline.com.au'],

    // Podiatry
    ['My Podiatrist', 'mypodiatrist.com.au'],
    ['The Foot and Ankle Clinic', 'thefootandankleclinic.com.au'],
    ['Moreland Podiatry', 'morelandpodiatry.com.au'],
    ['My FootDr', 'myfootdr.com.au'],
    ['Tooronga Podiatry', 'toorongapodiatry.com'],

    // Dietetics
    ['Appetite For Nutrition', 'appetitefornutrition.com.au'],
    ['Accelerate Nutrition', 'acceleratenutrition.com.au'],
    ['NutriBlooms', 'nutriblooms.com.au'],
    ['FerFit Dietetics', 'ferfitdietetics.com.au'],

    // Exercise Physiology
    ['EverFit Healthcare', 'everfithealthcare.com.au'],
    ['Alphasport', 'alphasport.com.au'],
    ['Interaktiv Health', 'interaktivhealth.com.au'],

    // Aged care / community allied health
    ['Feros Care', 'feroscare.com.au'],
    ['Silver Chain', 'silverchain.org.au'],
    ['Bolton Clarke', 'boltonclarke.com.au'],
    ['HammondCare', 'hammond.com.au'],
    ['Australian Unity', 'australianunity.com.au'],
    ['Brightwater Care Group', 'brightwatergroup.com'],
    ['Kalyra', 'kalyra.org.au'],
    ['Marathon Health', 'marathonhealth.com.au'],

    // Additional real Australian allied health / NDIS-registered practices
    ['Aruma', 'aruma.com.au'],
    ['Ndis Registered Providers - Seekara', 'seekara.com.au'],
    ['Clickability', 'clickability.com.au'],
    ['SpeechTherapy.org Australia', 'speechtherapy.org'],
    ['NDIS Allied Health Providers Melbourne', 'ndisproviders.melbourne'],
    ['Astris Physiotherapy', 'astris-pme.com.au'],
    ['Independence Australia Allied Health', 'independenceaustralia.com'],
    ['Novita Tech', 'novitatech.com.au'],
    ['Doability', 'doability.com.au'],
    ['Plan Access', 'planaccess.com.au'],
    ['Ask Ned', 'askned.com.au'],
    ['Teiro', 'teiro.com.au'],
    ['My Care Link', 'mycarelinkau.com'],
    ['DSX Disability Services Exchange', 'dsx.org.au'],
    ['Vivid Psychology', 'vividpsychology.com.au'],
    ['Peak Psychology', 'peakpsychology.com.au'],
    ['ndisprovider.review Exercise Physiology Network', 'ndisprovider.review'],
    ['Talii Allied Health', 'talii.com.au'],
    ['Sargood on Collaroy', 'sargoodoncollaroy.com.au'],
    ['CommunicateAT', 'communicateat.com.au'],
    ['Zyteq', 'zyteq.com.au'],
    ['Liberator Ltd', 'liberator.net.au'],
    ['OPC Health', 'opchealth.com.au'],
    ['TSL Australia', 'tslaustralia.com.au'],
    ['Second Skin', 'secondskin.com.au'],
    ['Sensory Assist', 'sensoryassist.com.au'],
    ['The Sensory Specialist', 'thesensoryspecialist.com.au'],
    ['My Diffability', 'mydiffability.com.au'],
    ['Biofast', 'biofast.com.au'],
    ['The OT Supplier', 'theotsupplier.com.au'],
    ['The Therapy Store', 'thetherapystore.com.au'],
    ['OT Warehouse', 'otwarehouse.com.au'],
    ['GenCare Services', 'gencareservices.com.au'],
    ['Australian Assistive Technology', 'australianatc.com.au'],
    ['Assistive Tech Hub', 'assistivetechhub.com.au'],
    ['Rehab Technology', 'rehabtechnology.com.au'],
    ['TeamMed', 'teammed.com.au'],
    ['HMG Direct', 'hmgdirect.com.au'],
    ['Platinum Health Supply', 'platinumhealthsupply.com.au'],
    ['RehaCare', 'rehacare.com.au'],
    ['Move Mobility', 'movemobility.com.au'],
    ['Connect Mobility', 'connectmobility.com.au'],
]

// Name + website only, by design. See the header note: anything more here would be a claim
// nobody verified, and a fresh environment would then present it as fact.
function buildRecord([name, host]) {
    return {
        provider: name,
        website_url: `https://${host}`,
        status: 'published',
    }
}

async function fetchExistingProviderNames() {
    const response = await fetch(`${BASE_URL}/api/providers?admin=1`, {
        headers: { Authorization: `Bearer ${DEV_ADMIN_TOKEN}` },
    })
    if (!response.ok) return new Set()
    const data = await response.json().catch(() => ({}))
    return new Set((data?.providers || []).map((provider) => provider.provider))
}

async function main() {
    const existingNames = await fetchExistingProviderNames()
    const records = PROVIDERS.map(buildRecord).filter((record) => !existingNames.has(record.provider))
    console.log(`Seeding ${records.length} new allied health providers to ${BASE_URL} (${existingNames.size} already present) ...`)

    let created = 0
    let failed = 0
    for (const record of records) {
        try {
            const response = await fetch(`${BASE_URL}/api/providers`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${DEV_ADMIN_TOKEN}`,
                },
                body: JSON.stringify(record),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) {
                console.warn(`✗ ${record.provider}: ${data?.error || response.status}`)
                failed += 1
                continue
            }
            created += 1
        } catch (error) {
            console.warn(`✗ ${record.provider}: ${error?.message || error}`)
            failed += 1
        }
    }

    console.log(`Done. Created ${created}, failed ${failed}, total ${records.length}.`)
}

main()
