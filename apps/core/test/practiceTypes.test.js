import assert from 'node:assert/strict'
import test from 'node:test'
import {
    getEquipmentDirectoryUrl,
    normalizePracticeType,
} from '../src/lib/practiceTypes.js'

test('defaults a domain with no configured practice type to General', () => {
    assert.equal(normalizePracticeType('', 'default'), 'general')
    assert.equal(getEquipmentDirectoryUrl('', 'default'), '/allied-health/suppliers')
})

test('maps configured practice types to profession links', () => {
    assert.equal(getEquipmentDirectoryUrl('physiotherapy'), '/allied-health/suppliers?p=physio')
    assert.equal(getEquipmentDirectoryUrl('speech_pathology'), '/allied-health/suppliers?p=speech')
    assert.equal(getEquipmentDirectoryUrl('general'), '/allied-health/suppliers')
})