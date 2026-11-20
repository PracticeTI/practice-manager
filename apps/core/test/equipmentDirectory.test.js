import assert from 'node:assert/strict'
import test from 'node:test'
import {
    equipmentMatchReason,
    equipmentMatchScore,
    equipmentSearchScore,
    equipmentTermFrequency,
    getSupplierDomain,
    getSupplierLogoUrl,
    matchesEquipmentField,
    matchesEquipmentFilters,
    normalizeEquipmentSupplier,
    normalizeProfession,
} from '../src/lib/equipmentDirectory.js'

test('derives the supplier domain for favicons', () => {
    assert.equal(getSupplierDomain('https://www.gmsrehab.com.au/shop/'), 'gmsrehab.com.au')
    assert.equal(getSupplierDomain('gmsrehab.com.au'), 'gmsrehab.com.au')
    assert.equal(getSupplierDomain('http://therapystore.com.au'), 'therapystore.com.au')
    assert.equal(getSupplierDomain(''), '')
    assert.equal(getSupplierDomain('not a website'), '')
    assert.equal(
        getSupplierLogoUrl(getSupplierDomain('https://www.gmsrehab.com.au')),
        'https://www.google.com/s2/favicons?domain=gmsrehab.com.au&sz=128',
    )
})

test('normalizes comma-separated fields and profession aliases', () => {
    const supplier = normalizeEquipmentSupplier({
        supplier: 'Aidacare',
        professions: 'ot, physio',
        equipment_categories: 'Mobility, Bathroom, Mobility',
        home_trials: 1,
    })

    assert.deepEqual(supplier.professions, ['Occupational Therapy', 'Physiotherapy'])
    assert.deepEqual(supplier.equipment_categories, ['Mobility', 'Bathroom'])
    assert.equal(supplier.home_trials, true)
    assert.equal(normalizeProfession('speech'), 'Speech Pathology')
})

test('smart search requires every term and ranks specific fields higher', () => {
    const supplier = normalizeEquipmentSupplier({
        supplier: 'Aidacare',
        product_types: ['Shower commodes'],
        geography: ['Melbourne'],
    })

    assert.ok(equipmentSearchScore(supplier, 'aidacare commode') > 0)
    assert.equal(equipmentSearchScore(supplier, 'aidacare paediatric'), 0)
    assert.ok(equipmentSearchScore(supplier, 'Aidacare') > equipmentSearchScore(supplier, 'Melbourne'))
})

test('advanced filters match arrays and boolean values', () => {
    const supplier = normalizeEquipmentSupplier({ professions: ['OT'], hire_rental: true })
    assert.equal(matchesEquipmentFilters(supplier, { professions: 'Occupational Therapy', hire_rental: true }), true)
    assert.equal(matchesEquipmentFilters(supplier, { hire_rental: false }), false)
    assert.equal(matchesEquipmentField({ phone: '03 9000 1234' }, 'phone', '9000'), true)
})

test('sourcing matcher matches whole terms with plural tolerance, not substrings', () => {
    const supplier = normalizeEquipmentSupplier({ supplier: 'Demo', product_types: ['Shower Commodes'] })
    // "commode" ~ "commodes" via prefix, both terms distinctive in this small catalog.
    assert.ok(equipmentMatchScore(supplier, 'shower commode', { termFrequency: { shower: 1, commode: 1 }, total: 5 }) > 0)
    // "chair" is a substring of "wheelchairs" but not a whole term, so it must not match.
    const wheelchairSupplier = normalizeEquipmentSupplier({ supplier: 'Demo', product_types: ['Wheelchairs'] })
    assert.equal(equipmentMatchScore(wheelchairSupplier, 'chair', { termFrequency: { chair: 0 }, total: 10 }), 0)
})

test('sourcing matcher matches common-but-real terms and ranks rarer ones higher', () => {
    const clone = normalizeEquipmentSupplier({
        supplier: 'Demo Mobility',
        product_types: ['Wheelchairs', 'Walkers', 'Shower Commodes'],
        equipment_categories: ['Mobility', 'Bathroom', 'Seating'],
    })
    // A supplier that genuinely sells shower commodes still matches even though the term is
    // shared by many suppliers (the distinctiveness gate was removed after the catalogue was
    // enriched with real, differentiated profiles).
    const commonScore = equipmentMatchScore(clone, 'shower commode chair', { termFrequency: { shower: 22, commode: 22, chair: 0 }, total: 119 })
    assert.ok(commonScore > 0)
    // idf still ranks a rarer (more specific) term above a term everyone shares.
    const rareScore = equipmentMatchScore(clone, 'shower commode chair', { termFrequency: { shower: 1, commode: 1, chair: 0 }, total: 119 })
    assert.ok(rareScore > commonScore)
    // A supplier name is a distinctive signal, so direct name lookups still work.
    const aidacare = normalizeEquipmentSupplier({ supplier: 'Aidacare' })
    assert.ok(equipmentMatchScore(aidacare, 'Aidacare', { termFrequency: { aidacare: 1 }, total: 119 }) > 0)
})

test('equipmentTermFrequency counts how many suppliers carry each term', () => {
    const suppliers = [
        normalizeEquipmentSupplier({ supplier: 'A', product_types: ['Shower Commodes'] }),
        normalizeEquipmentSupplier({ supplier: 'B', product_types: ['Wheelchairs'] }),
        normalizeEquipmentSupplier({ supplier: 'C', product_types: ['Shower Commodes', 'Walkers'] }),
    ]
    const frequency = equipmentTermFrequency(suppliers, 'shower commode chair')
    assert.equal(frequency.shower, 2)
    assert.equal(frequency.commode, 2)
    assert.equal(frequency.chair, 0)
})

test('sourcing matcher does not match proper nouns to a short shared stem', () => {
    // "aidacare" shares a stem with "aids", but the suffix difference is too large.
    const aidsSupplier = normalizeEquipmentSupplier({ supplier: 'Demo', product_types: ['Continence Aids'] })
    assert.equal(equipmentMatchScore(aidsSupplier, 'Aidacare', { termFrequency: { aidacare: 1 }, total: 10 }), 0)
})

test('sourcing matcher requires a specific stocking field, not just description prose', () => {
    const supplier = normalizeEquipmentSupplier({
        supplier: 'Demo',
        product_types: ['Cushions'],
        description: 'Pressure care products suitable for protecting skin integrity.',
    })
    // "skin" appears only in the description, which is too weak to surface a supplier alone.
    assert.equal(equipmentMatchScore(supplier, 'skin protection', { termFrequency: { skin: 1, protection: 1 }, total: 10 }), 0)
})

test('equipmentMatchReason explains which catalogue values a query term hit', () => {
    const supplier = normalizeEquipmentSupplier({
        supplier: 'Aidacare',
        product_types: ['Shower Commodes', 'Walking Frames'],
        equipment_categories: ['Bathroom', 'Mobility'],
        brands: ['Invacare'],
    })
    const reason = equipmentMatchReason(supplier, 'shower commode', {})
    assert.ok(reason)
    assert.deepEqual(reason.terms.sort(), ['commode', 'shower'])
    const stocks = reason.groups.find((group) => group.label === 'Stocks')
    assert.deepEqual(stocks.values, ['Shower Commodes'])
    // Non-matching values are not surfaced, so the reason stays a genuine "why".
    assert.ok(!reason.groups.some((group) => group.values.includes('Walking Frames')))
})

test('equipmentMatchReason returns null when nothing specific matches', () => {
    const supplier = normalizeEquipmentSupplier({
        supplier: 'Demo',
        product_types: ['Wheelchairs'],
        description: 'Specialists in pressure care seating to protect skin integrity.',
    })
    // "pressure"/"skin" only appear in prose, which can't surface a supplier on its own.
    assert.equal(equipmentMatchReason(supplier, 'pressure care skin', {}), null)
})

test('equipmentMatchReason caps each group and dedupes a name match', () => {
    const supplier = normalizeEquipmentSupplier({
        supplier: 'Aidacare',
        product_types: ['Shower Commodes', 'Shower Seats', 'Shower Stools', 'Commode Chairs', 'Bath Lifts'],
    })
    const reason = equipmentMatchReason(supplier, 'Aidacare shower', { maxValues: 2 })
    assert.ok(reason)
    assert.equal(reason.groups.find((group) => group.label === 'Name').values.join(','), 'Aidacare')
    const stocks = reason.groups.find((group) => group.label === 'Stocks')
    assert.ok(stocks.values.length <= 2)
})