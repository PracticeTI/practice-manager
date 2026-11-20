import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveReportTypeArtwork } from '../src/lib/reportTypeArtwork.js'

test('public default reports do not assume private domain artwork', () => {
    assert.equal(resolveReportTypeArtwork({
        reportTypeId: 'ndis-functional-capacity-assessment',
        domain: 'default',
    }), null)
    assert.equal(resolveReportTypeArtwork({ agent: 'reporting', domain: 'default' }), null)
})

test('resolves shared artwork from the configured report type name', () => {
    const artwork = resolveReportTypeArtwork({
        reportTypeId: 'report-type-example',
        reportType: 'TAC - OTF10 Home Services Review',
        domain: 'default',
    })

    assert.equal(artwork?.src, '/allied-health/OT/OTF10-Preview.png')
    assert.equal(artwork?.label, 'OTF10 Home Services Review')
})

test('the row type wins over the associated agent', () => {
    const artwork = resolveReportTypeArtwork({
        reportTypeId: 'report-type-example',
        reportType: 'TAC - OTF10 Home Services Review',
        agent: 'reporting',
        domain: 'default',
    })

    assert.equal(artwork?.src, '/allied-health/OT/OTF10-Preview.png')
})

test('unknown report types and agents leave the text tile in place', () => {
    assert.equal(resolveReportTypeArtwork({ reportTypeId: 'unknown', domain: 'default' }), null)
    assert.equal(resolveReportTypeArtwork({ agent: 'unknown', domain: 'default' }), null)
    assert.equal(resolveReportTypeArtwork(), null)
})
