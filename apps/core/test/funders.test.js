import test from 'node:test'
import assert from 'node:assert/strict'
import {
    countFunderDocuments,
    describeFunderDocument,
    findFunderDocument,
    getFunderDocumentCategoryLabel,
    getFunderDocumentUrl,
    getFunderDocumentTypeLabel,
    groupFunderDocumentsByCategory,
    isValidExternalUrl,
    isValidFunderKey,
    normalizeFunder,
    normalizeFunderDocument,
    normalizeFunderKey,
    slugifyFunderKey,
    sortFunderDocuments,
    validateFunder,
    validateFunderDocument,
} from '../src/lib/funders.js'
import {
    BUILT_IN_FUNDER_SEEDS,
    NDIS_PRICING_ARRANGEMENTS_DOCUMENT_KEY,
    NDIS_PRICING_ARRANGEMENTS_URL,
    NDIS_SUPPORT_CATALOGUE_DOCUMENT_KEY,
    NDIS_SUPPORT_CATALOGUE_URL,
    TAC_FEE_SCHEDULES_DOCUMENT_KEY,
    TAC_FEE_SCHEDULES_URL,
    TAC_LEGISLATION_DOCUMENT_KEY,
    TAC_LEGISLATION_URL,
    TAC_OT_FEE_SCHEDULE_DOCUMENT_KEY,
    TAC_OT_FEE_SCHEDULE_URL,
    TAC_OT_REGISTRATION_DOCUMENT_KEY,
    getBuiltInFunderDocumentSeeds,
    getBuiltInFunderSeed,
} from '../src/lib/funderRegistry.js'

test('normalizeFunderKey slugifies anything into a stable key', () => {
    assert.equal(normalizeFunderKey('NDIS'), 'ndis')
    assert.equal(normalizeFunderKey('National Disability Insurance Scheme'), 'national-disability-insurance-scheme')
    assert.equal(normalizeFunderKey('  Work   Cover  '), 'work-cover')
    assert.equal(normalizeFunderKey('TAC/Transport Accident'), 'tac-transport-accident')
    assert.equal(slugifyFunderKey(''), '')
})

test('isValidFunderKey normalises before checking, and rejects what slugifies to nothing', () => {
    assert.equal(isValidFunderKey('ndis'), true)
    assert.equal(isValidFunderKey('aged-care-hcp'), true)
    assert.equal(isValidFunderKey('NDIS'), true, 'normalised to lowercase before checking')
    assert.equal(isValidFunderKey('-ndis'), true, 'leading dashes are stripped before checking')
    assert.equal(isValidFunderKey('Work Cover'), true, 'spaces slugify to dashes before checking')
    assert.equal(isValidFunderKey('---'), false)
    assert.equal(isValidFunderKey('   '), false)
    assert.equal(isValidFunderKey(''), false)
})

test('isValidExternalUrl only accepts absolute http(s) addresses', () => {
    assert.equal(isValidExternalUrl('https://www.ndis.gov.au/providers'), true)
    assert.equal(isValidExternalUrl('http://example.com'), true)
    assert.equal(isValidExternalUrl('ftp://example.com'), false)
    assert.equal(isValidExternalUrl('javascript:alert(1)'), false)
    assert.equal(isValidExternalUrl('/providers'), false)
    assert.equal(isValidExternalUrl('www.ndis.gov.au'), false)
    assert.equal(isValidExternalUrl(''), false)
})

test('normalizeFunder fills defaults and drops invalid links', () => {
    const funder = normalizeFunder({
        name: ' TAC ',
        websiteUrl: 'not-a-url',
        status: 'nonsense',
    })

    assert.equal(funder.key, 'tac')
    assert.equal(funder.name, 'TAC')
    assert.equal(funder.website_url, '')
    assert.equal(funder.status, 'published')
    assert.equal(funder.full_name, '')
    assert.deepEqual(funder.metadata, {})
})

test('normalizeFunderDocument keeps a note without a URL but normalises the rest', () => {
    const document = normalizeFunderDocument({
        title: 'Pricing schedule 2026-27',
        url: 'https://www.ndis.gov.au/media/8841/download?attachment',
        doc_type: 'file',
        category: 'pricing',
        effectivePeriod: '2026-27',
        isPrimary: 'true',
    })

    assert.equal(document.key, 'pricing-schedule-2026-27')
    assert.equal(document.doc_type, 'file')
    assert.equal(document.effective_period, '2026-27')
    assert.equal(document.is_primary, true)
})

test('validateFunder requires a name and a usable website URL', () => {
    assert.deepEqual(validateFunder({ name: 'NDIS' }), [])
    assert.ok(validateFunder({ name: '' }).includes('A funder name is required'))
    assert.ok(validateFunder({ name: 'NDIS', website_url: 'ndis.gov.au' })
        .includes('The website URL must be an absolute http(s) address'))
})

test('validateFunderDocument requires a URL for links and files only', () => {
    assert.deepEqual(validateFunderDocument({ title: 'Pricing', url: 'https://ndis.gov.au/x' }), [])
    assert.deepEqual(validateFunderDocument({ title: 'Internal note', doc_type: 'note' }), [])
    assert.ok(validateFunderDocument({ title: 'Pricing' }).includes('A document URL is required'))
    assert.ok(validateFunderDocument({ title: 'Pricing', url: 'ndis.gov.au/x' })
        .includes('The document URL must be an absolute http(s) address'))
})

test('sortFunderDocuments puts the primary document first, then position, then newest period', () => {
    const sorted = sortFunderDocuments([
        { title: 'B', position: 2 },
        { title: 'A', position: 1 },
        { title: 'Primary', position: 9, is_primary: true },
        { title: 'Old period', position: 3, effective_period: '2025-26' },
        { title: 'New period', position: 3, effective_period: '2026-27' },
    ])

    assert.deepEqual(sorted.map((document) => document.title), [
        'Primary',
        'A',
        'B',
        'New period',
        'Old period',
    ])
})

test('groupFunderDocumentsByCategory follows the registry order and drops empty buckets', () => {
    const grouped = groupFunderDocumentsByCategory([
        { title: 'Policy doc', category: 'policy' },
        { title: 'Price doc', category: 'pricing' },
        { title: 'Catalogue doc', category: 'catalogue' },
    ])

    assert.deepEqual(grouped.map((group) => group.category), ['pricing', 'catalogue', 'policy'])
    assert.equal(grouped[0].label, 'Pricing & payments')
    assert.equal(grouped[0].documents.length, 1)
})

test('describeFunderDocument reads as a single line of provenance', () => {
    assert.equal(
        describeFunderDocument({ title: 'x', doc_type: 'file', effective_period: '2026-27', description: 'Effective 24 September 2026.' }),
        'Download · Effective 2026-27 · Effective 24 September 2026.'
    )
})

test('lookup helpers resolve a document by funder + document key', () => {
    const funders = [{
        key: 'ndis',
        name: 'NDIS',
        documents: [
            { key: 'pricing-arrangements', title: 'Pricing arrangements', url: 'https://example.com/pricing' },
            { key: 'other', title: 'Other', url: 'https://example.com/other' },
        ],
    }]

    assert.equal(getFunderDocumentUrl(funders, 'ndis', 'pricing-arrangements'), 'https://example.com/pricing')
    assert.equal(getFunderDocumentUrl(funders, 'NDIS', 'pricing-arrangements'), 'https://example.com/pricing')
    assert.equal(getFunderDocumentUrl(funders, 'tac', 'pricing-arrangements'), '')
    assert.equal(getFunderDocumentUrl(funders, 'ndis', 'missing'), '')
    assert.equal(findFunderDocument(funders[0], 'other').url, 'https://example.com/other')
    assert.equal(countFunderDocuments(funders[0]), 2)
    assert.equal(countFunderDocuments({ documents: [{ status: 'draft' }] }, { publishedOnly: true }), 0)
})

test('category and type labels fall back instead of rendering nothing', () => {
    assert.equal(getFunderDocumentCategoryLabel('catalogue'), 'Support catalogue')
    assert.equal(getFunderDocumentCategoryLabel('unknown'), 'unknown')
    assert.equal(getFunderDocumentTypeLabel('file'), 'Download')
    assert.equal(getFunderDocumentTypeLabel(''), 'Web page')
})

test('the built-in NDIS funder exists and links the pricing arrangements page', () => {
    const ndis = getBuiltInFunderSeed('ndis')
    assert.ok(ndis, 'NDIS ships as a built-in funder')
    assert.equal(ndis.full_name, 'National Disability Insurance Scheme')

    const documents = getBuiltInFunderDocumentSeeds('ndis')
    assert.ok(documents.length >= 20, 'the NDIS funder carries the platform documentation set')

    const pricingArrangements = documents.find((document) => document.key === NDIS_PRICING_ARRANGEMENTS_DOCUMENT_KEY)
    assert.ok(pricingArrangements, 'pricing arrangements document is seeded')
    assert.equal(pricingArrangements.url, NDIS_PRICING_ARRANGEMENTS_URL)
    assert.equal(pricingArrangements.category, 'pricing')
    assert.equal(pricingArrangements.is_primary, true)

    const catalogue = documents.find((document) => document.key === NDIS_SUPPORT_CATALOGUE_DOCUMENT_KEY)
    assert.equal(catalogue.url, NDIS_SUPPORT_CATALOGUE_URL)
})

test('the built-in TAC funder exists and links the fee schedules and OT registration', () => {
    const tac = getBuiltInFunderSeed('tac')
    assert.ok(tac, 'TAC ships as a built-in funder')
    assert.equal(tac.full_name, 'Transport Accident Commission')

    const documents = getBuiltInFunderDocumentSeeds('tac')
    assert.ok(documents.length >= 30, 'the TAC funder carries the platform documentation set')

    const feeSchedules = documents.find((document) => document.key === TAC_FEE_SCHEDULES_DOCUMENT_KEY)
    assert.ok(feeSchedules, 'fee schedules document is seeded')
    assert.equal(feeSchedules.url, TAC_FEE_SCHEDULES_URL)
    assert.equal(feeSchedules.category, 'pricing')
    assert.equal(feeSchedules.is_primary, true)

    const otFeeSchedule = documents.find((document) => document.key === TAC_OT_FEE_SCHEDULE_DOCUMENT_KEY)
    assert.equal(otFeeSchedule.url, TAC_OT_FEE_SCHEDULE_URL)

    assert.ok(documents.some((document) => document.key === TAC_OT_REGISTRATION_DOCUMENT_KEY))
    assert.equal(documents.find((document) => document.key === TAC_LEGISLATION_DOCUMENT_KEY).url, TAC_LEGISLATION_URL)
})

test('every built-in funder and document is valid and has a unique key', () => {
    const funderKeys = new Set()
    const seenDocumentKeys = new Set()

    for (const seed of BUILT_IN_FUNDER_SEEDS) {
        assert.deepEqual(validateFunder(seed, { requireKey: true }), [], `${seed.key} funder payload is valid`)
        assert.equal(funderKeys.has(seed.key), false, `duplicate funder key ${seed.key}`)
        funderKeys.add(seed.key)

        for (const document of seed.documents || []) {
            assert.deepEqual(validateFunderDocument(document), [], `${seed.key}/${document.key} document payload is valid`)
            const scopedKey = `${seed.key}/${document.key}`
            assert.equal(seenDocumentKeys.has(scopedKey), false, `duplicate document key ${scopedKey}`)
            seenDocumentKeys.add(scopedKey)
        }

        const primaryCount = (seed.documents || []).filter((document) => document.is_primary).length
        assert.ok(primaryCount <= 1, `${seed.key} has at most one primary document`)
    }
})
