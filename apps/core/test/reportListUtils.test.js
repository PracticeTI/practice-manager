import test from 'node:test'
import assert from 'node:assert/strict'
import {
    filterPendingQueuedReports,
    getLatestReportPerPatient,
    getMostRecentReportPerPatient,
    getReportVersions,
} from '../src/lib/reportListUtils.js'

test('keeps only the newest report for each patient before applying the card limit', () => {
    const rows = [
        { id: 'latest-42', patientId: '42' },
        { id: 'older-42', patient_id: 42 },
        { id: 'latest-73', patientId: '73' },
    ]

    const selected = getMostRecentReportPerPatient(rows, 2)

    assert.deepEqual(selected.map((row) => row.id), ['latest-42', 'latest-73'])
})

test('does not collapse reports without a patient id', () => {
    const rows = [
        { id: 'unassigned-1' },
        { id: 'unassigned-2' },
    ]

    const selected = getMostRecentReportPerPatient(rows, 2)

    assert.deepEqual(selected.map((row) => row.id), ['unassigned-1', 'unassigned-2'])
})

test('keeps pending queued rows when the server response only has older rows for the same patient', () => {
    const pendingRows = [
        {
            id: 'queue-123',
            listKey: 'pending-queue:queue-123',
            patientId: '42',
            patientName: 'Jane Doe',
            status: 'queued',
            sourceMetadata: { queueId: 'queue-123' },
        },
    ]
    const serverRows = [
        {
            id: '7',
            patientId: '42',
            patientName: 'Jane Doe',
            sourceTable: 'patient_reports',
            status: 'ready',
            createdAt: '2026-08-01T00:00:00.000Z',
            updatedAt: '2026-08-01T00:00:00.000Z',
        },
    ]

    const filtered = filterPendingQueuedReports(pendingRows, serverRows)

    assert.equal(filtered.length, 1)
    assert.equal(filtered[0].id, 'queue-123')
})

test('removes pending queued rows when the server response contains the matching queue row', () => {
    const pendingRows = [
        {
            id: 'queue-123',
            listKey: 'pending-queue:queue-123',
            patientId: '42',
            patientName: 'Jane Doe',
            status: 'queued',
            sourceMetadata: { queueId: 'queue-123' },
        },
    ]
    const serverRows = [
        {
            id: 'queue-123',
            patientId: '42',
            patientName: 'Jane Doe',
            sourceTable: 'patient_report_jobs',
            status: 'queued',
            createdAt: '2026-08-04T00:00:00.000Z',
            updatedAt: '2026-08-04T00:00:00.000Z',
        },
    ]

    const filtered = filterPendingQueuedReports(pendingRows, serverRows)

    assert.equal(filtered.length, 0)
})

test('keeps the first (most recent) row for each patient', () => {
    const rows = [
        { id: 'latest-42', patientId: '42' },
        { id: 'older-42', patientId: '42' },
        { id: 'latest-73', patientId: '73' },
    ]

    const selected = getLatestReportPerPatient(rows)

    assert.deepEqual(selected.map((row) => row.id), ['latest-42', 'latest-73'])
})

test('lists report versions newest first and marks the published report current', () => {
    const rows = [
        {
            id: '474',
            patientId: '54',
            sourceTable: 'patient_reports',
            reportMarkdown: '# Current',
            updatedAt: '2026-10-18T10:06:51.322Z',
        },
        {
            id: '798',
            patientId: '54',
            sourceTable: 'patient_report_drafts',
            lastJobId: '299',
            reportMarkdown: '# Previous',
            updatedAt: '2026-10-08T15:25:27.842Z',
        },
        {
            id: '787',
            patientId: '54',
            sourceTable: 'patient_report_drafts',
            lastJobId: '296',
            reportMarkdown: '# Oldest',
            updatedAt: '2026-09-29T13:55:04.765Z',
        },
    ]

    const versions = getReportVersions(rows)

    assert.deepEqual(versions.map((row) => row.id), ['474', '798', '787'])
    assert.deepEqual(versions.map((row) => row.isCurrent), [true, false, false])
})

test('collapses a job draft into its canonical report row', () => {
    const rows = [
        {
            id: '798',
            patientId: '54',
            sourceTable: 'patient_report_drafts',
            lastJobId: '299',
            reportMarkdown: '# Previous',
            updatedAt: '2026-10-08T15:25:27.842Z',
        },
        {
            id: '474',
            patientId: '54',
            sourceTable: 'patient_reports',
            lastJobId: '299',
            reportMarkdown: '# Previous',
            updatedAt: '2026-10-09T10:06:51.322Z',
        },
    ]

    const versions = getReportVersions(rows)

    assert.equal(versions.length, 1)
    assert.equal(versions[0].id, '474')
    assert.equal(versions[0].isCurrent, true)
})

test('excludes working drafts and rows without report text from versions', () => {
    const rows = [
        {
            id: '786',
            patientId: '54',
            sourceTable: 'patient_report_drafts',
            lastJobId: null,
            reportMarkdown: '# Working draft',
            updatedAt: '2026-10-12T11:07:55.925Z',
        },
        {
            id: 'queue-1',
            patientId: '54',
            sourceTable: 'patient_report_jobs',
            reportMarkdown: '',
            updatedAt: '2026-10-13T11:07:55.925Z',
        },
        {
            id: '798',
            patientId: '54',
            sourceTable: 'patient_report_drafts',
            lastJobId: '299',
            reportMarkdown: '# Generated',
            updatedAt: '2026-10-08T15:25:27.842Z',
        },
    ]

    const versions = getReportVersions(rows)

    assert.deepEqual(versions.map((row) => row.id), ['798'])
    assert.equal(versions[0].isCurrent, true)
})
