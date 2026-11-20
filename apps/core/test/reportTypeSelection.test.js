import test from 'node:test'
import assert from 'node:assert/strict'
import { isNdisFcaReportType, selectHsrReportType } from '../src/lib/reportTypeSelection.js'

const reportTypes = [
    {
        id: 'ndis-functional-capacity-assessment',
        name: 'NDIS - Functional Capacity Assessment',
    },
    {
        id: 'report-type-wlhb3vgo',
        name: 'TAC - OTF10 Home Services Review',
    },
]

test('selects OTF10 for HSR backfill when deleted report metadata is empty', () => {
    const selected = selectHsrReportType(reportTypes, {})

    assert.equal(selected?.id, 'report-type-wlhb3vgo')
})

test('does not reuse a deleted FCA report type for HSR backfill', () => {
    const selected = selectHsrReportType(reportTypes, {
        reportTypeId: 'ndis-functional-capacity-assessment',
        reportType: 'NDIS - Functional Capacity Assessment',
    })

    assert.equal(selected?.id, 'report-type-wlhb3vgo')
})

test('returns null instead of falling back to a non-HSR report type', () => {
    const selected = selectHsrReportType([reportTypes[0]], {})

    assert.equal(selected, null)
})

test('recognises the FCA report type from its configured id or its name', () => {
    assert.equal(isNdisFcaReportType('ndis-functional-capacity-assessment'), true)
    assert.equal(isNdisFcaReportType('NDIS - Functional Capacity Assessment'), true)
})

test('does not treat an OTF10 or OTF6 type as an FCA type', () => {
    assert.equal(isNdisFcaReportType('report-type-wlhb3vgo'), false)
    assert.equal(isNdisFcaReportType('TAC - OTF10 Home Services Review'), false)
    assert.equal(isNdisFcaReportType('otf6-initial-occupational-therapy-assessment'), false)
    assert.equal(isNdisFcaReportType(''), false)
    assert.equal(isNdisFcaReportType(undefined), false)
})

test('does not select an inactive OTF10 report type', () => {
    const selected = selectHsrReportType([
        reportTypes[0],
        { ...reportTypes[1], isActive: false },
    ], {})

    assert.equal(selected, null)
})