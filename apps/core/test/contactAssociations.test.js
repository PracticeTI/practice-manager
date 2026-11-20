import test from 'node:test'
import assert from 'node:assert/strict'
import {
    ASSOCIATION_SOURCE_LABELS,
    buildAssociationOptions,
    describeAssociationSources,
} from '../src/lib/contactAssociations.js'

test('buildAssociationOptions merges every directory into one alphabetised list', () => {
    const options = buildAssociationOptions({
        providers: [{ provider: 'Northside Therapy' }],
        suppliers: [{ supplier: 'Adaptive Equipment Co' }],
        funders: [{ name: 'NDIS' }],
    })

    assert.deepEqual(options.map((option) => option.value), [
        'Adaptive Equipment Co',
        'NDIS',
        'Northside Therapy',
    ])
    assert.deepEqual(options[1].sources, ['funder'])
})

test('buildAssociationOptions folds names that differ only by case or whitespace', () => {
    const options = buildAssociationOptions({
        providers: [{ provider: '  Northside Clinic ' }],
        suppliers: [{ supplier: 'northside clinic' }],
        funders: [{ name: 'NORTHSIDE CLINIC' }],
    })

    assert.equal(options.length, 1)
    assert.equal(options[0].value, 'Northside Clinic')
    // Sources keep a stable presentation order regardless of input order.
    assert.deepEqual(options[0].sources, ['provider', 'supplier', 'funder'])
})

test('buildAssociationOptions offers a distinct funder full name', () => {
    const options = buildAssociationOptions({
        funders: [
            { name: 'NDIS', full_name: 'National Disability Insurance Scheme' },
            { name: 'TAC', full_name: 'tac' },
        ],
    })

    assert.deepEqual(options.map((option) => option.value), ['National Disability Insurance Scheme', 'NDIS', 'TAC'])
    assert.equal(options.filter((option) => option.value.toLowerCase() === 'tac').length, 1)
})

test('buildAssociationOptions skips blank and malformed records', () => {
    const options = buildAssociationOptions({
        providers: [{ provider: '   ' }, {}, null],
        suppliers: [undefined],
        funders: [{ name: '' }],
    })

    assert.deepEqual(options, [])
})

test('describeAssociationSources labels each directory', () => {
    assert.equal(describeAssociationSources(['provider', 'funder']), 'Provider · Funder')
    assert.equal(describeAssociationSources(['supplier']), 'Supplier')
    assert.equal(describeAssociationSources([]), '')
    assert.equal(describeAssociationSources(undefined), '')
    assert.equal(ASSOCIATION_SOURCE_LABELS.funder, 'Funder')
})
