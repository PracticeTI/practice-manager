import test from 'node:test'
import assert from 'node:assert/strict'
import { extractEquipmentSuggestions } from '../src/jobs/equipmentSourcerWorker.js'

test('extracts structured equipment rows from the OTF10 equipment section', () => {
    const report = [
        '<h2>Assistive technology or equipment</h2>',
        '<table><tbody>',
        '<tr><td><p>Equipment type</p></td><td><p>Supplier</p></td><td><p>Trial</p></td><td><p>Justification</p></td></tr>',
        '<tr><td><p>Shower chair &amp; backrest</p></td><td><p>SWEP</p></td><td><p>Trial before purchase</p></td><td><p>Reduce falls risk</p></td></tr>',
        '</tbody></table>',
        '<h2>Summary of plan</h2>',
        '<tr><td><p>Unrelated row</p></td><td></td><td></td><td></td></tr>',
    ].join('\n')

    assert.deepEqual(extractEquipmentSuggestions(report), [{
        equipmentType: 'Shower chair & backrest',
        supplier: 'SWEP',
        trialSummary: 'Trial before purchase',
        justification: 'Reduce falls risk',
        source: 'Latest TAC OTF10 report',
    }])
})

test('returns no suggestions when the OTF10 report has no equipment section', () => {
    assert.deepEqual(extractEquipmentSuggestions('## Summary of plan\nNo equipment documented.'), [])
})

test('extracts the Markdown equipment table used by stored OTF10 reports', () => {
    const report = [
        '## Assistive technology or equipment recommended',
        '| Equipment Type (make and model) | Equipment supplier name | Trial summary | Clinical Justification |',
        '| --- | --- | --- | --- |',
        '| Lightweight vacuum cleaner | Local supplier | Trial in store | Reduce fatigue during cleaning |',
        '| Shower chair | SWEP | Trial at home | Reduce falls risk |',
        '# SECTION 6',
        '## QUOTATION',
    ].join('\n')

    assert.equal(extractEquipmentSuggestions(report).length, 2)
    assert.equal(extractEquipmentSuggestions(report)[0].equipmentType, 'Lightweight vacuum cleaner')
    assert.equal(extractEquipmentSuggestions(report)[1].supplier, 'SWEP')
})