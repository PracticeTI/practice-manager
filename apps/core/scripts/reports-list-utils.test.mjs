import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeReportRows } from '../src/lib/reportListUtils.js'

test('mergeReportRows combines report and draft rows and keeps the newest first', () => {
    const reportRows = [
        { id: 1, updated_at: '2024-01-01T00:00:00Z' },
        { id: 2, updated_at: '2024-01-03T00:00:00Z' },
    ]
    const draftRows = [
        { id: 11, updated_at: '2024-01-02T00:00:00Z' },
        { id: 12, updated_at: '2024-01-04T00:00:00Z' },
    ]

    const merged = mergeReportRows(reportRows, draftRows, 10)

    assert.deepEqual(merged.map((row) => row.id), [12, 2, 11, 1])
    assert.equal(merged[0].sourceTable, 'patient_report_drafts')
    assert.equal(merged[1].sourceTable, 'patient_reports')
})
